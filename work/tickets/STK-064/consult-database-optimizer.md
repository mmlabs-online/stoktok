## STK-064 DB consult: `ai_summaries`

I read the ticket, the news, signals, ai_usage and ai_keys migrations, the news and ai-usage repos, and the db-check cases. I did not read the financial_lines migration or the repos for signals, ai-keys or financials. Where I cite a rule or pattern, it comes from the files I did read.

### Findings (existing patterns to copy)
- File names are `supabase/migrations/<ts>_x.sql` with `supabase/rollback/<ts>_x.down.sql`. The next name would be `2026111x…_ai_summaries.sql`. Rollbacks are a plain `drop table if exists`.
- Each new table repeats RLS and grants, because the grants loop in `20261023000200` only covers tables that existed then. Pattern: `enable row level security; revoke all on … from public, anon, authenticated; grant select, insert, update, delete … to service_role;`. The signals table also grants identity-sequence rights. ai_usage and news skip that grant, since the identity column is implicit.
- Dates are `date` columns (`signal_date`, `trade_date`). No migration uses `Asia/Ho_Chi_Minh` in SQL. Day logic lives in `packages/core`.
- signals already does what you need for JSON and arrays:
  - `jsonb_typeof(x)='object' and pg_column_size(x) <= 32768`
  - array checks via `cardinality`, `array_position(...,null) is null` and a regex over `array_to_string`
- Tickers are checked as `^[A-Z0-9]{1,20}$`. ai_usage has `provider in ('anthropic','google')`, and `model` is length 1..100.
- ai_usage stores no prompt or output text. It is the cost and audit ledger.
- `checks.sql` has these things to extend:
  - The table-list assertion at line 34 is an exact sorted array. `ai_summaries` must be added, sorted before `ai_usage`, or db:check fails.
  - There are `*_columns` blocks, a `service_role_can_read_write_*` block and a `*_negatives` block per table.
  - The helpers are `pg_temp.assert_col` and `pg_temp.expect_fail(label, sql, array[sqlstate])`.
  - I did not read the anon/authenticated-denied checks. Look at how they are done for ai_usage and copy them.

### Recommendations

**Schema**
- **Subject.** Do not use a nullable `symbol` in a unique constraint. Use two columns instead:
  - `scope text not null check (scope in ('symbol','portfolio'))`
  - `symbol text not null default '' check ((scope='symbol' and symbol ~ '^[A-Z0-9]{1,20}$') or (scope='portfolio' and symbol=''))`
  - `unique (scope, symbol, summary_date)`
  - There are no NULLs, so uniqueness works on any PG version. It is also explicit to query.
  - Single-user v1 has one portfolio, so no portfolio_id is needed. Add a comment saying that.
  - The alternative, `symbol` nullable with `unique nulls not distinct`, needs PG15+. Skip it.
- **Date.** Use `summary_date date not null`. It is the VN trading or data date the summary is about, like `signal_date`. It is not the run date, so a late rerun after midnight still replaces the same row. The worker computes it in `packages/core` with the VN calendar. Document this in a column comment.
- **Provider and model.** Use `provider text not null check (provider in ('anthropic','google'))` and `model text not null check (char_length(model) between 1 and 100)`, the same as ai_usage. Provider is not part of the unique key, because one row is kept per symbol and date.
- **Body.** `body jsonb not null check (jsonb_typeof(body)='object' and pg_column_size(body) <= 32768)`.
  - Keep the cap tight, because the UI renders this. 16 KB is enough for a short Vietnamese summary. Match signals' 32768 for consistency, or pick 16384. Either is fine.
  - Enforce the shape in Zod in `packages/core`. Do not enforce it deeply in SQL.
  - Add `body_version smallint not null default 1` so the shape can evolve.
  - Cheap SQL guard: `body ? 'sentences'` and `jsonb_typeof(body->'sentences')='array'`, if that is the shape.
- **Input IDs.**
  - Use `input_ids jsonb not null` (an array of typed refs such as `{"t":"news","id":123}`, `{"t":"signal","id":…}`, `{"t":"statement","id":…}`, `{"t":"price","date":…}`) with `check (jsonb_typeof(input_ids)='array' and jsonb_array_length(input_ids) <= 200)`.
  - Reason: the citations cross several tables (news.id bigint, signals.id, financial_lines, prices keyed by symbol and date). A `text[]` of bare ids is ambiguous. If you prefer `text[]`, use namespaced strings like `news:123` with the same regex-over-`array_to_string` check as signals.
  - Ask the planner to pick one format. Whichever it is, each sentence's own IDs live in `body`.
  - The column-level `input_ids` is the union. It is used for audit and for "which summaries cite news X". Add a GIN index only if that query is actually needed. It is not in the ACs, so skip it.
- **Usage link.** Add `usage_id bigint references public.ai_usage(id) on delete set null`.
  - It is nullable because a "không có dữ liệu" summary may be built without a model call.
  - A rerun overwrites `usage_id` with the new ai_usage row. Older ai_usage rows remain, so spend accounting stays correct.
  - Index it (`ai_summaries_usage_id_idx`) per the index-FK rule, or drop the FK and keep a plain bigint if the planner wants zero coupling.
  - Do not copy token counts or cost into this table. Join through `usage_id`.
  - Rollback order: drop `ai_summaries` before ai_usage. A newer rollback never runs after an older one, so this is fine.
- **Timestamps.**
  - `generated_at timestamptz not null`, set by the worker.
  - `created_at timestamptz not null default now()`, which the ACs require.
  - A rerun that replaces the row also sets `generated_at`. Keep `created_at` as the first-insert time unless the planner wants it refreshed. Say which in a comment.
  - R4 style: if the summary lists the stale data it saw, put that in `body`. The `input_ids` and the signals' own `fetched_at` already cover provenance.
- **Comments.** Add `comment on column body` stating it is MODEL OUTPUT, plain text only, never HTML, schema-validated (R9). Add `comment on table` stating that no prompt or untrusted article text is stored here.

**Indexes**
- The unique `(scope, symbol, summary_date)` index serves "latest summary for symbol X". Query it with `where scope='symbol' and symbol=$1 order by summary_date desc limit 1`. It is a btree prefix scan, so no extra index is needed.
- "Today's summaries" is `where summary_date = $1`. Add `create index ai_summaries_date_idx on (summary_date desc)`. It also serves retention deletes.
- The volume is tiny (about 50 rows per day), so do not over-index.

**Idempotent upsert**
- Use `db.from('ai_summaries').upsert(row, { onConflict: 'scope,symbol,summary_date' }).select('id')`. This is the pattern `insertNews` uses, but without `ignoreDuplicates`, so a rerun replaces the row.
- PostgREST upsert overwrites all provided columns on conflict. Make sure the row sends every column, including `usage_id` (null if none), so no stale value survives.
- `id` and `created_at` stay, since they are not sent. If the planner wants `created_at` refreshed, send it.
- Add no trigger. Keep the policy in the repo and in comments.

**Retention**
- Keep 90 days by default. The rows are small and cheap. Nothing in the repo prunes ai_usage or news either.
- Do not add a cron in this ticket (R7). Put retention in follow-ups.
- Optionally add a repo `pruneAiSummaries(db, beforeDate)` based on `summary_date`, without scheduling it. If you skip it, state that history is unbounded in v1.

**db:check cases** (add to `checks.sql`)
- Add `ai_summaries` to the sorted table-list assertion at line 34.
- `ai_summaries_columns`: `assert_col` for each column and its NOT NULL state.
- `service_role_can_read_write_ai_summaries`: insert, select, delete.
- Anon/authenticated denied, plus RLS enabled, copied from the other tables' pattern.
- Negatives, each with its sqlstate. 23514 means check violation, 23505 unique violation, 23502 not null and 23503 FK violation:
  - bad scope, 23514
  - scope='symbol' with symbol '', 23514
  - scope='portfolio' with a non-empty symbol, 23514
  - lowercase symbol, 23514
  - bad provider, 23514
  - body that is an array or a string, 23514
  - oversize body (`repeat` into a jsonb string), 23514
  - input_ids not an array, 23514
  - input_ids with too many elements, 23514
  - null body, 23502
  - duplicate (scope, symbol, date), 23505
  - a duplicate portfolio row for the same date, 23505, which proves the sentinel works
  - nonexistent `usage_id`, 23503
- Behaviour: deleting the referenced ai_usage row sets `usage_id` to null and keeps the summary.
- Upsert: `insert … on conflict (scope,symbol,summary_date) do update` leaves exactly 1 row and keeps the new body.

**Repo functions** (`packages/db/src/repos/ai-summaries.ts`, plus `AiSummaryRow`/`AiSummaryInsert` in `rows.ts`, an export from `index.ts` and a test using `test/fake-client.ts`)
- `upsertAiSummary(db, row)` returns the id. It validates nothing itself, since Zod runs in core before the call.
- `getLatestAiSummary(db, symbol)` returns the newest row or null.
- `getLatestPortfolioSummary(db)`.
- `listAiSummariesForDate(db, date)` returns the symbol rows and the portfolio row. This is cheap and fits under the PostgREST 1000-row cap.
- Optionally `pruneAiSummaries(db, beforeDate)`.
- Map `bigint` and `jsonb` through `toSafeInt` and validate the body shape on read. The UI must not trust a stored body blindly, because it renders model text.
- Selects should be explicit, not `*`.
- Check `r3-guard.test.ts`, which probably restricts which service-role clients may be imported where. The web side should read through its server-only service-role client.

### Risks
- A shape drift between the Zod schema in core and the SQL checks. Keep the SQL checks coarse.
- `ai_keys` revokes all from service_role and grants only select. Do not copy that pattern here. The ACs say service_role only, so use the full ai_usage grants.
- `unique(scope,symbol,summary_date)` with a PostgREST `onConflict` column list requires that exact unique constraint to exist. Check this in db:check by running the upsert.
- A summary row without an ai_usage link breaks cost audit. Make the worker always set `usage_id` when a model call happened.
- Reading old rows after the body schema changes needs `body_version`.

### Open questions for the planner
1. `input_ids`: jsonb typed refs, or namespaced `text[]`? I recommend jsonb.
2. Should a "no data" summary row be stored without a model call (`usage_id` null), or skipped? Storing it lets the UI show "không có dữ liệu" with a date.
3. Is `summary_date` the newest trade date or the run date? I recommend the newest trade date, with the run date in `generated_at`.
4. Retention: is a 90-day prune in scope, or a follow-up?
5. Does `created_at` stay at first insert, or refresh on rerun? I recommend keeping first insert and using `generated_at` as the refresh time.
6. The body cap: 16 KB or 32 KB.
7. A holding or watchlist symbol later removed from both: does its old summary row stay? I recommend it does, with no FK to symbols, as signals does.

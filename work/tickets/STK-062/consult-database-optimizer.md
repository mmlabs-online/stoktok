## Findings

I read the ticket, 20261108000100_financial_lines.sql and its rollback, and scripts/db-check/checks.sql. No `news` table exists yet, and nothing in supabase/ mentions it.

**Spec divergence.** docs/spec-v1.md §5 (line 176) defines `news` with a single `symbol` column. The ticket asks for multiple linked symbols, and one article often mentions several tickers or none (market-wide news). Treat the ticket as the newer decision and flag the divergence in the plan. The spec's `suggestions.news_ids` (line 178) will reference `news.id`, so ids must be stable and rows must not be silently deleted.

**Existing pattern to copy.** Each new table's migration does four things itself, because the grants loop in 20261023000200 only covers tables that existed then:
- `enable row level security`
- `revoke all ... from public, anon, authenticated`
- `grant select, insert, update, delete ... to service_role`
- no policies

checks.sql enforces this globally. It checks RLS on every table, no policies, no anon or authenticated grants, and that anon and authenticated are denied select and insert on every table. Those loops cover `news` automatically, but the `tables_exist` list must be updated.

## Recommendations

**1. Symbol links: use a `text[]` column plus a GIN index, not a join table** (AC 2, 3).
- The links are derived data, written once with the article by deterministic code. An atomic single-row upsert is simpler than a two-table write, and a partial failure can't leave an article half-linked.
- Reads are "news for symbols X since T". That is `symbols && array['FPT','VNM']`, which PostgREST exposes as `.overlaps('symbols', [...])` (the `ov` operator), and GIN supports it.
- A join table's only advantage is an FK to `symbols`. We don't want it, because articles may mention tickers not in `symbols`, and a link should not fail on that.
- Column definition: `symbols text[] not null default '{}'`, so market-wide news is an empty array and never NULL.
- Check constraints:
  - `cardinality(symbols) <= 20`
  - `array_to_string(symbols, ',') ~ '^([A-Z0-9]{1,20}(,[A-Z0-9]{1,20})*)?$'`, which matches the `symbol` regex used elsewhere. A CHECK can't contain a subquery, which is why it goes through `array_to_string`.
- Uniqueness of elements within the array is enforced in packages/core, not in the database.
- Re-linking after the alias list changes is a separate backfill, not part of the upsert.

**2. Columns**
- `id bigint generated always as identity primary key`, so `suggestions.news_ids` can reference it later.
- `title text not null`, with `char_length(title) between 1 and 500`.
- `url text not null unique`, with `url ~ '^https?://'` and `char_length(url) <= 2048`.
- `source text not null check (source <> '')` (R4). It holds the adapter id, e.g. `cafef`, `vietstock`, `vnexpress`.
- `credibility text not null check (credibility in ('official','established'))`. Ranking `official > established` lives in packages/core. A text enum matches the existing style, and adding a value later is an easy constraint swap.
- `published_at timestamptz not null`.
  - Items with no parseable date should be skipped by the adapter and counted or recorded as a gap, rather than guessing a date.
  - Add `check (published_at <= fetched_at + interval '1 day')` to guard against bad future dates, which would otherwise pin an article to the top of "latest".
- `fetched_at timestamptz not null` (R4).
- `excerpt text not null default ''`, plain text only. The database cap is a coarse backstop (`char_length(excerpt) <= 10000`). The real cap is a config value in packages/core or worker config (R5), default about 2000 characters, the same as the lottery `raw_text` cap. Truncate on a code-point boundary, and normalize to NFC before storing.
- Comments on the table and columns, like `financial_lines`. Say explicitly that the text is untrusted, plain text, and never rendered as HTML (AC 5).

**3. URL uniqueness and normalization** (AC 4)
- Normalize in packages/core as a pure function with unit tests, and store only the canonical form. The unique constraint is on that canonical `url`.
- Rules:
  - Lowercase scheme and host.
  - Upgrade to https only where the source serves it (decide per adapter).
  - Strip the fragment.
  - Drop tracking parameters: `utm_*`, `fbclid`, `gclid`, and RSS-specific ones such as `ref` or `source`.
  - Sort the remaining query parameters.
  - Strip a trailing slash on non-root paths.
  - Resolve relative URLs against the feed URL.
- Insert with `on conflict (url) do nothing`. Keep the first `fetched_at` and `published_at`. Don't update on conflict, because the ledger-style "first seen" is useful and re-fetching hourly would otherwise churn rows.
- Cross-source syndication (the same story at two URLs) is out of scope. Don't add a content hash in v1.

**4. Indexes** (query paths: "symbols X since T", "latest N", FTS)
- `create index news_published_at_idx on public.news (published_at desc, id desc)`. This supports "latest" and keyset pagination.
- `create index news_symbols_gin on public.news using gin (symbols)`.
- The unique index on `url` comes with the constraint.
- At a few hundred rows per day, the planner can use either index for "symbols X since T". No composite index is needed.

**5. Full-text search for Vietnamese** (for the later chat tool)
- Postgres has no Vietnamese dictionary. Vietnamese is space-delimited by syllable, so the `'simple'` configuration tokenizes acceptably, and `phraseto_tsquery('simple', ...)` handles multi-syllable terms.
- Recommended minimal option: a generated stored column `fts tsvector generated always as (to_tsvector('simple', title || ' ' || excerpt)) stored`, plus a GIN index. It needs no extension and `to_tsvector` with an explicit regconfig is immutable, so it is allowed in a generated column.
- Accent-insensitive search, so a user typing "co phieu" finds "cổ phiếu", needs `unaccent`. `unaccent` is not immutable, so it needs an immutable wrapper function and the extension, which on Supabase usually sits in the `extensions` schema. That adds migration risk and a rollback dependency.
- My recommendation is to ship the plain `'simple'` tsvector and GIN index in STK-062, and leave accent folding or `pg_trgm` for the chat-agent ticket. If the planner wants zero FTS work now, deferring the whole column is also acceptable. It can be added later as a nullable-free generated column, but that causes a table rewrite, which is trivial at this size.
- The chat tool should query through the service role from server code only (R3). It should always pass an explicit `limit` and `order`.

**6. Retention**
- Size estimate: 3 sources at roughly 100 items a day with about 2.5 KB a row is about 100 MB a year. That is meaningful against the Supabase free tier of 500 MB, shared with prices and everything else.
- Proposal: a config value `news_retention_days`, default 365. A worker step, not `pg_cron`, deletes old rows in bounded batches.
- Rows referenced by suggestions must survive (the spec's `news_ids`). When that ticket lands, either prune only unreferenced rows or null out the `excerpt` and keep the row. Because `news_ids` is probably an array with no FK, deletion would silently orphan the ids.
- Pruning is not required for this ticket's acceptance criteria. Log it as a `debt` issue (workspace rule §8) if the plan defers it.

**7. Avoiding the PostgREST 1000-row cap seen in STK-061**
- Never read all stored urls to de-duplicate. Write with `upsert(rows, { onConflict: 'url', ignoreDuplicates: true })` and `.select('id,url')`. This returns only the newly inserted rows and needs no read-then-write.
- Batch writes at about 200 rows per request. Don't use `.in('url', [...])` with long URLs, because they go into the GET query string and hit length limits.
- Any read helper (for the AI layer, the summary job, or a retention count) must page. Use keyset pagination on `(published_at, id)` with an explicit `order`, and loop in chunks under 1000 until a short page comes back. Alternatively, apply a deliberate `limit` that is documented as a cap, and never rely on the default.
- A per-symbol "since T" read with `overlaps` is bounded by T. The helper should still assert that the returned count is below the page size, or paginate.
- Add a unit test with a fake client that returns exactly 1000 rows, so the pagination loop is exercised. That was the STK-061 failure mode.

**8. Migration and rollback files**
- Migration: supabase/migrations/20261108000200_news.sql, or any timestamp later than 20261108000100. It has a header comment with the ticket id and the RLS-in-file note, then table, comments, indexes, `enable row level security`, `revoke all`, `grant ... to service_role`.
- Rollback: supabase/rollback/<same name>.down.sql containing `drop table if exists public.news;`. Indexes and the generated column drop with the table. If you add an immutable `unaccent` wrapper later, drop it explicitly in the same file.
- Note that DB migrations are a High path in the PR risk tiers (CLAUDE.md §7), so Ming reviews this PR.

**9. scripts/db-check/checks.sql updates**
- `tables_exist`: add `'news'` to the sorted array, between `lottery_tickets` and `prices_daily`.
- Add a `news_columns` block with `assert_col` for:
  - `title`, `url`, `source`, `credibility`, `excerpt` as text, not null
  - `published_at` and `fetched_at` as `timestamp with time zone`, not null
  - `symbols` as `ARRAY`, not null
  - `id` as `bigint`
- Add `service_role_can_read_write_news`:
  - Insert a row.
  - Do an `on conflict (url) do nothing` insert and check the count stays 1.
  - Query with `symbols && array['FPT']`.
  - Delete the row.
- Add a `news_negatives` block in the style of `financial_lines_negatives`. Each case should fail with 23514 unless noted:
  - empty title
  - title over 500 characters
  - url without a scheme
  - url over 2048 characters
  - empty source
  - bad credibility
  - excerpt over 10000 characters
  - lowercase symbol in the array
  - 21 symbols
  - `published_at` more than a day after `fetched_at`
  - null symbols (23502)
  - null url (23502)
  - duplicate url (23505)
- If you keep the GIN and FTS indexes, optionally assert their existence through `pg_indexes`. The existing checks don't do this for other tables, so it is not required.
- `no_numeric_or_float_columns` stays satisfied, since `news` has no money columns.

**10. Security, untrusted text** (AC 5)
- HTML stripping lives in packages/core, not in SQL. It decodes entities once, removes tags, `<script>` and `<style>` content, and control characters, collapses whitespace, and applies the length cap.
- The database stores only the already-stripped plain text.
- Fixtures should include a `<script>` payload and an HTML entity-encoded tag, to prove that nothing survives as markup.
- The R9 constraint for the later AI use: article text is data, never instructions. The AI layer must not follow instructions embedded in the excerpt. Mention this in the schema comment so the next ticket sees it.

## Risks
- **Free-tier storage** if retention is skipped and the excerpt cap is raised.
- **Array-column links can go stale** when the alias list changes. A re-link backfill job is needed eventually.
- **Missing or wrong `pubDate`** in RSS feeds would break "since T" queries. The `published_at <= fetched_at + 1 day` guard helps, but the adapter should also log skipped items.
- **A `url` normalization bug** that over-strips could merge distinct articles. Under-stripping creates duplicates. Fixtures should include real tracking-parameter URLs.
- **Vietnamese FTS quality** with `'simple'` is only fair. It has no stemming, but Vietnamese needs little stemming. Accent folding is the main gap.
- **Orphaned `suggestions.news_ids`** if retention is added later without a reference rule.
- **The PostgREST 1000-row cap** recurs in any unpaginated news reader.

## Open questions
1. Should items with no parseable date be dropped and recorded as a gap, or stored with `published_at = fetched_at`? Proposed default: drop and record.
2. What default should `news_retention_days` have, and should retention land in this ticket or as a `debt` issue? Proposed default: 365 days, as a `debt` issue.
3. Is the FTS column in scope here, or deferred to the chat-agent ticket? Proposed default: add the plain `'simple'` tsvector with a GIN index now, and defer `unaccent`.
4. What is the final excerpt cap in characters? Proposed default: 2000 in config, with a 10000 backstop in the database.
5. Should the spec §5 `news` row be updated to say `symbols` is an array? Per CLAUDE.md the spec wins on scope conflicts, so this needs Ming's confirmation, or a note in the plan that the ticket supersedes it.

Files read:
- D:\mmlabs\spaceM\projects\stoktok\work\tickets\STK-062\ticket.md
- D:\mmlabs\spaceM\projects\stoktok\supabase\migrations\20261108000100_financial_lines.sql
- D:\mmlabs\spaceM\projects\stoktok\supabase\rollback\20261108000100_financial_lines.down.sql
- D:\mmlabs\spaceM\projects\stoktok\scripts\db-check\checks.sql
- D:\mmlabs\spaceM\projects\stoktok\docs\spec-v1.md (the news lines)

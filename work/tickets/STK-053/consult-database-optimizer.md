STK-053 consult (database-optimizer), read-only. Nothing was edited.

## Findings

**Conventions in this repo**
- Every table is single-user, with no owner or user column.
  - RLS is enabled, there are NO policies, and anon, authenticated and PUBLIC are revoked.
  - Only `service_role` gets select/insert/update/delete (`20261023000200_v1_rls_grants.sql`).
- The grants loop in that file covers only the tables that existed then. Later migrations (`signals`, `prices_intraday`) repeat `enable row level security`, `revoke all ... from anon, authenticated` and the service_role grant. Identity sequences get explicit revoke and grant lines (see `signals_id_seq`).
- Money columns are `bigint`, counts and prices are `integer`, and no numeric or float columns are allowed. Checks use `check (x >= 0)`, and text enums use `check (col in (...))`.
- Every migration `supabase/migrations/<ts>_<name>.sql` has a matching `supabase/rollback/<ts>_<name>.down.sql`. The down file is just `drop table if exists public.<t>;`.
- `scripts/db-check/checks.sql` is the schema test, run by `pnpm db:check`. Adding the new tables requires editing it:
  - The `tables_exist` list is an exact array, so it will fail until `lottery_draws` and `lottery_tickets` are added.
  - The anon/authenticated denial loop, the "RLS on" check and the "no policies" check pick the new tables up automatically.
  - Each new table needs a `service_role_can_read_write_*` block, new `assert_col` lines for bigint money columns, and `expect_fail` lines in `rejects_bad_rows`.
- Data layer: `packages/db/src/repos/<table>.ts` takes a `Db` first argument. It uses `unwrap`/`unwrapFound`/`mapRow` from `errors.ts` and `rows.ts`/`mappers.ts` for row types.
  - `23505` becomes `CONFLICT`. `23502`, `23514` and `22P02` become `VALIDATION`.
  - Bigints come back from PostgREST as strings, so the mapper converts them to numbers. `prices-intraday.test.ts` asserts this with `volume: '2400'`.
  - Tests are `repos/<x>.test.ts` using `createFake()` from `packages/db/test/fake-client`. They assert the call chain (`eq`, `order`, `limit`, `onConflict`).
- `requireUser()` is NOT called inside `packages/db` repos or `apps/web/server/*/handlers.ts`.
  - Handlers and loaders carry the comment "Callers must call requireUser() first (R6)".
  - `requireUser()` runs in pages and actions, and `apps/web/test/entrypoints.test.ts` enforces that.
  - The AC line "Server data functions call `requireUser()`" therefore differs from existing practice. It is satisfiable by the web-layer handlers plus the entrypoints test.
- Spec F8 lists channels `sms` / `momo`; the ticket AC adds `manual`. The spec wins on scope, so flag it to Ming. It is harmless to allow `manual` in the check constraint and note it.

**Core types the schema must hold** (`packages/core/src/lottery/types.ts`)
- `GameId` is `'mega645' | 'power655'`, and `drawId` is a string.
- A ticket has `lines: number[][]` with mixed sizes: a regular line has 6 numbers and a system ("bao") line has `systemSizes`. `config.ts` shows the only pool tiers are `jackpot` for Mega and `jackpot1` and `jackpot2` for Power. The other tiers are fixed amounts that come from config (R5).
- `DrawResult` has `numbers`, optional `bonus` and `pools[tier] = {amountVnd, winnerCount}`.
- A check result has `costVnd`, `grossVnd`, `taxVnd`, `netVnd`, `status` won/lost, `topTier`, and per-tier `tierCounts`.

## Recommendations

### 1. Ticket lines: use `jsonb`, not `int[][]` and not a child table
- Postgres multidimensional arrays must be rectangular, so a ticket mixing a 6-number line and a 7-number bao line cannot be stored as `int[][]`. Use `lines jsonb not null`.
- Add a check for the shape:
  - `jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and <cap, e.g. 50>`.
  - `pg_column_size(lines) <= 8192`, as `signals` does for its snapshot.
  - Do not check the content in SQL. Core (`check.ts` / `validateTicket`) owns the number range, count, duplicate and allowed-size rules, and R5 keeps those out of the DB.
- A child table is not worth it. No query filters by a number inside a ticket, because statistics come from `lottery_draws`. It would add a second table, a transaction on insert, and more RLS and grants work.
- Canonicalise before insert in core or the repo, because the duplicate rule below depends on it:
  - Sort the numbers inside each line ascending.
  - Sort the lines.
  - Keep the original input in `raw_text`.

### 2. `lottery_draws`
Use a composite primary key and no surrogate id. This matches `prices_daily` and `prices_intraday`.

```
game        text not null check (game in ('mega645','power655')),
draw_no     integer not null check (draw_no > 0),
draw_date   date not null,
numbers     smallint[] not null,
bonus       smallint,
jackpot_vnd       bigint check (>= 0),   -- tier 'jackpot' (mega) / 'jackpot1' (power)
jackpot_winners   integer check (>= 0),
jackpot2_vnd      bigint check (>= 0),   -- power 'jackpot2' only
jackpot2_winners  integer check (>= 0),
source      text not null check (source <> ''),
fetched_at  timestamptz not null,
created_at  timestamptz not null default now(),
primary key (game, draw_no)
```
- Checks:
  - `cardinality(numbers) = 6`.
  - `array_position(numbers, null) is null`.
  - Each number is between 1 and the game's maximum (45 or 55). Range is a game rule, but it equals the lottery config, so either put it in SQL with a comment or leave it to core. Prefer a loose `numbers <@ array[1..55]` check and let core be strict.
  - Bonus: `(game = 'power655') = (bonus is not null)`, and bonus is between 1 and 55 when present.
  - `jackpot2_vnd` and `jackpot2_winners` are null unless `game = 'power655'`.
  - Each `*_vnd` is null together with its `*_winners` (both set or both null). Rows created before the pool is published must be allowed, so don't force NOT NULL.
- Explicit columns beat a `pools jsonb` here. They are bigint-checkable by `assert_col` and visible to the "no numeric/float" check. The pool tiers are fixed by the game, so the jsonb flexibility isn't needed. A mapper builds `pools: Partial<Record<TierId, PoolPrize>>` from them (the column-to-tier mapping lives in `mappers.ts`).
- `draw_no` as integer sorts correctly. The mapper formats `drawId` as a string. Decide the string form once (`String(n)` vs zero-padded `00123`) and keep it in one function, so ticket lookups don't miss on leading zeros.
- R4: source and fetched_at are NOT NULL, as in `prices_daily`.
- Index: the PK `(game, draw_no)` serves "latest draw for a game" through a backward scan. Add `lottery_draws_game_date_idx (game, draw_date desc)` for history and date range queries, only if date-ordered queries are real. The PK already gives draw_no order, so it is optional.

### 3. `lottery_tickets`
```
id            uuid primary key default gen_random_uuid(),
game          text not null check (game in (...)),
draw_no       integer not null check (draw_no > 0),
lines         jsonb not null (shape check above),
cost_vnd      bigint not null check (cost_vnd >= 0),
channel       text not null check (channel in ('sms','momo','manual')),
purchased_at  timestamptz not null,
status        text not null default 'pending' check (status in ('pending','won','lost')),
prize_tier    text check (prize_tier in ('jackpot','jackpot1','jackpot2','first','second','third')),
gross_vnd     bigint check (>= 0),
tax_vnd       bigint check (>= 0),
net_vnd       bigint check (>= 0),
checked_at    timestamptz,
raw_text      text,
external_ref  text,                  -- see "open questions"
created_at    timestamptz not null default now()
```
- Use a uuid id, like `transactions`, `assets` and `corporate_actions`. A reference to a draw is the logical key `(game, draw_no)`.
- Do NOT add a foreign key to `lottery_draws`. A ticket is entered before the draw row exists. A FK would force fake draws, or reject the ticket.
- `prize_tier` stores the top tier (`topTier`).
- `lottery_tickets` stores the check result in columns, so the history queries need no recomputation:
  - Per-tier counts (`tierCounts`) are not needed as columns. Add a `result jsonb` (object, size-capped) for the per-line breakdown only if the UI needs it. Otherwise recompute from `lines` and the draw with core when displaying.
  - `gross_vnd` and `tax_vnd` are in the spec's history summary. Whether to store `tax_vnd` or recompute it is a design choice. The tax rule is configuration with an effective-date cutoff (10M before 2026-07-01, 20M after), so storing it freezes the tax at check time. Recomputing is more flexible (R1/R5). I recommend storing gross only, and computing tax and net in core, because tax is per ticket per draw and rules change.
- Status shape check, in the style of `signals`:
  - `status = 'pending'`: prize_tier, gross_vnd and checked_at are all null.
  - `status = 'lost'`: prize_tier is null, gross_vnd = 0 (or null), checked_at is not null.
  - `status = 'won'`: prize_tier and gross_vnd (> 0) are not null.
- `raw_text` cap: `check (raw_text is null or char_length(raw_text) <= 2000)`.
- `channel = 'sms'` implies raw_text is present is probably right, but "manual" rows may have no raw text. Do not force it for momo or manual.

### 4. Duplicate-import rule (AC: same raw text OR same game + draw + numbers + purchased_at)
Two partial unique indexes, since each condition needs its own key:
```
create unique index lottery_tickets_raw_text_uidx
  on public.lottery_tickets (md5(raw_text)) where raw_text is not null;
create unique index lottery_tickets_identity_uidx
  on public.lottery_tickets (game, draw_no, purchased_at, lines);
```
- Use `md5(raw_text)` (or a stored `raw_text_hash`), so the index entry stays small for pasted SMS text. A plain unique index on a long text column works but bloats.
- Normalise `raw_text` before hashing (trim, collapse whitespace) in core or the repo, so a re-paste with different spacing is still caught.
- `lines` is jsonb and jsonb has a btree equality operator, so the unique index works. It relies on canonical order (see section 1). If you want a small key, store `lines_hash`, but the plain version is fine at personal scale.
- `purchased_at` must be the time parsed from the SMS. If the manual form defaults it to `now()`, the identity key never matches, so the same ticket pasted twice is not caught. Raw-text uniqueness covers the SMS case.
- A manual ticket can legitimately repeat (same numbers bought twice in the same minute). Consider applying the identity index only to `channel = 'sms'` imports, or accept the collision for manual and surface `CONFLICT`. Needs Ming's call, see questions.
- Repo behaviour: map `23505` to `CONFLICT` through `unwrap`. Provide `createLotteryTicket` returning a DataError CONFLICT on duplicates, as `transactions` does for imports.
- Add a `rejects_bad_rows` case for each unique index in `checks.sql` (`23505`), plus the null-raw_text no-collision case (like `manual_rows_nulls_dont_collide`).

### 5. Indexes
- Pending tickets for a draw: `create index lottery_tickets_pending_idx on public.lottery_tickets (game, draw_no) where status = 'pending';` This is a small partial index. The worker query is `where status='pending' and game=$1 and draw_no=$2` (or `draw_no <= latest` to catch tickets for draws that were skipped).
- History per game ordered by purchase: `lottery_tickets_game_purchased_idx (game, purchased_at desc)`. The history summary sums over game, so an index including `(game, status)` isn't necessary at this size.
- The identity unique index leads with `(game, draw_no, ...)`, so lookups by draw already use it. Check whether the pending partial index is redundant with it. It is not, because the partial index is much smaller and excludes settled rows.
- Do not index `lines`.

### 6. RLS and grants
- Follow `20261105000200_prices_intraday.sql` exactly, inside the new migration:
  - `alter table public.lottery_draws enable row level security;` and the same for `lottery_tickets`.
  - `revoke all on public.<t> from public, anon, authenticated;`
  - `grant select, insert, update, delete on public.<t> to service_role;`
  - No policies. The `no_policies` check in `checks.sql` requires zero.
- The new tables use uuid and composite keys, so no sequence grants are needed. If you choose an identity id, add the `signals_id_seq` revoke and grant lines.
- Add the migration with a timestamp after `20261105000200` (e.g. `20261106000100_lottery.sql`) and a rollback `20261106000100_lottery.down.sql` dropping `lottery_tickets` then `lottery_draws`.

### 7. Data layer and tests
- Add `packages/db/src/repos/lottery.ts` with `createTicket`, `listTickets` (by game, status, draw), `updateTicket` (for the result of a check or edits), `getDraw`/`upsertDraw`, `listPendingTickets(game, drawNo)`. Add the row types to `rows.ts` and the mappers (bigint string to number, `drawId` string, pools) to `mappers.ts`.
- `upsertDraw` should use `onConflict: 'game,draw_no'`. If a draw is re-fetched, last-write-wins as in `prices-intraday`.
- Tests: `repos/lottery.test.ts` with `createFake()`. Assert the table name, `onConflict`, the filters, the `order` and the bigint-string mapping. Cover the CONFLICT case by responding with `{ error: { code: '23505' } }`.
- Web layer: a `apps/web/server/lottery/handlers.ts` following `assets/handlers.ts`, with "Callers must call requireUser() first". Add entrypoints to `entrypoints.test.ts` if pages or actions are created in this ticket. If no web entrypoint is added, the AC about `requireUser()` has nothing to test. Raise this with the planner.
- Input validation for tickets (R1) belongs in core (STK-052 already has `check.ts`). The repo should not recompute prizes.

## Risks
- `int[][]` for lines would reject mixed-size tickets at insert time. Avoid it.
- Unique key on `jsonb lines` only works with canonical ordering. If any code path stores un-sorted lines, duplicates slip through silently.
- `purchased_at` defaulting to `now()` in manual entry defeats the identity key.
- A FK from tickets to draws would block entering a ticket before its draw exists.
- Storing `tax_vnd` freezes a tax rule that is configuration (threshold change 2026-07-01). If the rule is later corrected, stored values are wrong.
- `checks.sql` has an exact `tables_exist` array. Forgetting to update it fails `pnpm db:check` (which is not part of `pnpm test`, so it could slip through CI).
- No backfill concerns: these are new tables.
- Draw results have no official API (spec open question 8). The `source` string must be non-empty, but any scraped source's reliability is an R4 matter for the worker ticket, not this one.

## Open questions
1. Channel: spec says `sms`/`momo`, the ticket adds `manual`. Keep `manual`? (Recommended: yes, and update the spec.)
2. Should manual tickets be exempt from the identity unique key (same numbers legitimately bought twice)? Recommended: apply the identity key to `channel = 'sms'` only, or accept CONFLICT on both and let Ming add a note.
3. Store `tax_vnd`/`net_vnd` on the ticket or recompute from `gross_vnd` with the effective-dated tax rule in core? Recommended: store gross only.
4. `drawId` string format: plain number or zero-padded? (The SMS sample format is still unknown, spec open question 8.)
5. Do you want a `result jsonb` with the per-line wins, or recompute on display?
6. AC wording on `requireUser()` in "server data functions": existing practice is the caller (page/action/handler) calls it, not the repo. Confirm the AC means the web-layer handlers.

Files read: `/home/user/stoktok/work/tickets/STK-053/ticket.md`, `/home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql`, `/home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql`, `/home/user/stoktok/supabase/migrations/20261026000200_signals.sql`, `/home/user/stoktok/supabase/migrations/20261105000200_prices_intraday.sql`, `/home/user/stoktok/supabase/rollback/20261105000200_prices_intraday.down.sql`, `/home/user/stoktok/scripts/db-check/checks.sql`, `/home/user/stoktok/packages/core/src/lottery/types.ts`, `/home/user/stoktok/packages/core/src/lottery/config.ts`, `/home/user/stoktok/packages/db/src/errors.ts`, `/home/user/stoktok/packages/db/src/repos/prices-intraday.ts`, `/home/user/stoktok/packages/db/src/repos/prices-intraday.test.ts`, `/home/user/stoktok/apps/web/server/assets/handlers.ts`.

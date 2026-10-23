Status: READY

# Plan — STK-003: Supabase schema and migrations for v1.0 data

## Spec summary
- §5 Data Model (initial), the rows in scope:
  > `transactions` | id, date, symbol, side, quantity, price, fee, tax, source (`manual`/`import`), import_batch_id
  > `corporate_actions` | id, symbol, type, record_date, ratio/amount, applied
  > `lots` | id, symbol, buy_transaction_id, quantity_remaining, cost_per_share, sellable_from
  > `assets` | id, type (`cash`/`other`), name, value, as_of
  > `watchlist` | symbol, group, added_at
  > `prices_daily` | symbol, date, open, high, low, close, volume, foreign_net, source
  > `data_gaps` | symbol, from_ts, to_ts, detected_at
  > `settings` | fee_rate, tax_rate, concentration_threshold, rule configs
  >
  > Holdings and P&L are **derived** from `transactions` + `corporate_actions` + `lots`, never stored as editable balances.
- §2.1: "All values below are **configuration, not hard-coded**" (settlement, price limits, board lot, selling tax, brokerage fee "user setting").
- §2.2 / §4.3: "Every price carries a `fetched_at` timestamp and a source." "Every record stores `source` and `fetched_at`." "Gaps must be detected, not silently interpolated."
- §4.2: "App data lives in a **separate Supabase project**". CLAUDE.md R3: "The browser never talks to the DB directly."
- Out of scope per the ticket: `prices_intraday`, `financials`, `news`, `signals`, `suggestions`, `suggestion_scores`.

### ⚠ Divergence from spec, flagged for Ming: no `lots` table
Spec §5 lists `lots`. This plan **does not create it**. Reasons:
1. STK-002 derives lots in core (`buildLedger` → `Lot[]`). Lot `status` and `sellableFrom` depend on the as-of date.
2. The spec's own line 174 says derived data is "never stored as editable balances".
3. The spec's shape (`buy_transaction_id`, `cost_per_share`) cannot hold stock-dividend lots (`source: 'stock_dividend'`) or WAC per-symbol cost.

If a snapshot is needed later, it should be a rebuildable cache in its own ticket. The ticket AC table list already leaves out `lots`. The spec's `corporate_actions.applied` is also dropped, because application is derived. `settings.tax_rate` becomes `sell_tax_rate_ppm`.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Migrations under `supabase/migrations/` create `transactions`, `corporate_actions`, `assets`, `watchlist`, `settings`, `prices_daily`, `data_gaps` | `pnpm db:check` passes. `checks.sql` section "tables exist" asserts that exactly these 7 tables exist in `public` (no more, no fewer). |
| 2 | Money columns are `bigint`, quantity/price are integer types, no `numeric`/float | `checks.sql` section "column types": (a) scans `information_schema.columns` in `public` for `numeric`, `real`, `double precision` and `money`, and expects 0 rows; (b) asserts the exact `data_type` for each money/qty/price column listed in Approach step 2. |
| 3 | `corporate_actions` has `ex_date, record_date, pay_date, listing_date, amount_per_share, ratio_num, ratio_den`; `transactions` has a stable same-day ordering key | `checks.sql` asserts these columns exist with the right types. It also asserts `transactions.seq` is `bigint`, identity and unique. Mapper tests cover `ratio_den`↔`held` and `ratio_num`↔`received`. |
| 4 | `prices_daily` and `data_gaps` carry `source` and `fetched_at` (NOT NULL); `settings` stores ppm rates and `cash_dividend_treatment` | `checks.sql` asserts `source text NOT NULL` and `fetched_at timestamptz NOT NULL` on both tables, and asserts that the `settings` columns `fee_rate_ppm`, `sell_tax_rate_ppm`, `dividend_withholding_rate_ppm` (integer) and `cash_dividend_treatment` (text, with a check constraint) exist. Mapper test `settingsFromRow › maps ppm fields 1:1`. |
| 5 | RLS on every table, no policies, anon/authenticated have no access; a check verifies it | `checks.sql` section "security": (1) 0 public tables with `relrowsecurity = false`; (2) 0 rows in `pg_policies` for `public`; (3) 0 rows in `role_table_grants` / `role_usage_grants` (sequences) for `anon`, `authenticated`, `PUBLIC`; (4) behavioural: `set role anon` / `authenticated`, then `select` and `insert` on every table raises `42501`; (5) RLS layer alone: in a rolled-back sub-block, temporarily `grant select` to `anon`, insert a row as owner, and `set role anon` must see 0 rows; (6) `set role service_role` can insert and select. |
| 6 | Migrations apply cleanly from empty; the check runs through a documented `pnpm` script | `pnpm db:check` (primary, see "Verification paths") exits 0. It applies all migrations to a fresh throwaway Postgres 16 with `ON_ERROR_STOP=1`, runs the checks, applies the rollback scripts and expects 0 tables, then re-applies the migrations and checks again. Documented in `supabase/README.md`. |
| 7 | Row ↔ core mappers (snake_case ↔ core types, safe `bigint`) with unit tests | `pnpm test` runs `packages/core/src/db/mappers.test.ts` (tests listed below). `pnpm typecheck` and `pnpm lint` are green (R8). |

### Verification paths (primary vs optional)
- **Primary: `pnpm db:check`** runs `scripts/db-check.sh` against a throwaway local Postgres 16. Binaries come from `PG_BIN` (default `/usr/lib/postgresql/16/bin`, which exists in this sandbox; otherwise `pg_config --bindir`). The script:
  1. `initdb` in a `mktemp -d` dir with `--auth=trust -U postgres`.
  2. `pg_ctl start` with `-c listen_addresses='' -k <tmpdir>` (unix socket only, no port conflicts).
  3. Runs `bootstrap-roles.sql`, applies the migrations, runs the checks, does the rollback/re-apply, and runs the checks again.
  4. Stops the server and removes the dir in a `trap` (EXIT).

  If the user is root (the sandbox is), `initdb`/`pg_ctl` refuse to run. The script then runs them via `runuser -u postgres --` and `chown`s the tmp dir to `postgres`.
- **Alternative within the same script:** if `DB_CHECK_URL` is set (e.g. a CI Postgres service container or a local Supabase at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`), the script skips `initdb` and runs the same SQL against that URL. Bootstrap is idempotent, so this is safe on a real Supabase stack. It **refuses** unless the URL host is `localhost`/`127.0.0.1`, so a check never runs drop/rollback against a remote DB.
- **Optional, not required for PASS:** `supabase db reset` with the CLI. It needs Docker plus about 10 image pulls through the proxy, and the repo has no `supabase/config.toml` yet. It is documented in `supabase/README.md` as optional, not used by the reviewer.
- If no Postgres binaries are found and `DB_CHECK_URL` is unset, the script exits **non-zero** with a clear message. It never silently passes.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261023000100_v1_tables.sql` | create | AC1–4: the 7 tables, constraints, indexes, column comments |
| `supabase/migrations/20261023000200_v1_rls_grants.sql` | create | AC5: enable RLS, revoke anon/authenticated, grant service_role, default privileges. Kept separate so a future table that forgets RLS fails the check |
| `supabase/rollback/20261023000100_v1_tables.down.sql` | create | AC6 reversibility: drops the 7 tables in reverse order |
| `supabase/rollback/20261023000200_v1_rls_grants.down.sql` | create | AC6: intentionally a no-op with a comment, because reverting revokes would reopen access. Dropping the tables removes RLS with them |
| `supabase/.gitkeep` | delete | Directory is now non-empty |
| `supabase/README.md` | create | AC6 "documented": layout, naming convention, `pnpm db:check`, optional CLI path, no-`lots` note |
| `scripts/db-check.sh` | create | AC6 primary verification runner |
| `scripts/db-check/bootstrap-roles.sql` | create | Test-only: idempotently creates `anon`, `authenticated` (nologin) and `service_role` (nologin bypassrls), and mimics Supabase default grants so the revoke is actually tested. **Never** a migration |
| `scripts/db-check/checks.sql` | create | AC1–5 assertions (each failure `raise exception`s; run with `ON_ERROR_STOP=1`) |
| `package.json` (root) | modify | Add `"db:check": "bash scripts/db-check.sh"` |
| `packages/core/src/db/rows.ts` | create | AC7: hand-written row/insert types (`TransactionRow`, `TransactionInsert`, `CorporateActionRow`, `SettingsRow`) |
| `packages/core/src/db/mappers.ts` | create | AC7: `toSafeInt`, `RowMappingError`, and the from/to mappers |
| `packages/core/src/db/mappers.test.ts` | create | AC7 unit tests (R8) |
| `packages/core/src/index.ts` | modify | Export the mappers and row types |

No changes to `apps/*` or to the existing ledger code.

## Tests to write
SQL checks (`scripts/db-check/checks.sql`; each is a named `do $$ … $$` block that raises `'CHECK FAILED: <name>'`):
| Check name | Covers |
|---|---|
| `tables_exist` | AC1, exact set of 7 |
| `no_numeric_or_float_columns` | AC2 |
| `money_columns_bigint` (`transactions.fee/tax`, `corporate_actions.amount_per_share`, `assets.value`, `prices_daily.volume/foreign_net`, `transactions.seq`) | AC2/3 |
| `qty_price_columns_integer` (`transactions.quantity/price`, `prices_daily.open/high/low/close`, `corporate_actions.ratio_num/ratio_den`, settings `*_ppm`) | AC2/4 |
| `corporate_action_columns` | AC3 |
| `transactions_seq_identity_unique` | AC3 |
| `source_fetched_at_not_null` (prices_daily, data_gaps) | AC4 (R4) |
| `settings_columns` | AC4 |
| `rls_enabled_all_tables` | AC5 |
| `no_policies` | AC5 |
| `no_grants_anon_authenticated_public` (tables + sequences) | AC5 (R3) |
| `anon_denied_select_insert` / `authenticated_denied_select_insert` (loop over all public tables; expect SQLSTATE 42501) | AC5 |
| `rls_blocks_even_with_grant` (sub-block, rolled back) | AC5 second layer |
| `service_role_can_read_write` | Server access works |
| `rejects_bad_rows`: quantity ≤ 0; side `'hold'`; negative fee; cash dividend with ratio; stock dividend with amount / zero ratio; duplicate `(symbol,type,ex_date)`; `prices_daily` low > high; lowercase symbol; `settings.id = 2`; `cost_method = 'FIFO'`; `data_gaps` to_ts < from_ts (expect 23514/23505) | Constraints |
| `manual_rows_nulls_dont_collide` (two manual txns with null batch/ref insert fine; duplicate import `(source,batch,ref)` → 23505) | Import idempotency |
| `settings_fee_unset_allowed` (insert with `fee_rate_ppm` null succeeds) | Fee stays visibly unset |

Script-level: after rollback, `select count(*)` of public tables = 0; after re-apply, all checks pass again.

Unit tests (`packages/core/src/db/mappers.test.ts`):
| Test (file › name) | Covers |
|---|---|
| `toSafeInt › accepts number, bigint and digit string` | pg returns int8 as string |
| `toSafeInt › rejects '9007199254740993', 1.5, '1e3', '', NaN, null` | R2 safe-int guard |
| `toSafeInt › accepts negative string '-5000'` (foreign_net style) | Signed bigint |
| `transactionFromRow › maps snake_case to core, fee/tax null → undefined (not 0)` | Core `fee?` semantics |
| `transactionFromRow › seq/fee given as strings become numbers (no string concat)` | bigint-as-string risk |
| `transactionFromRow › rejects invalid trade_date / Date object / bad side` | Driver misconfig surfaced |
| `transactionToInsert › omits seq, maps meta (source, import_batch_id, external_ref), undefined fee → null` | Write path |
| `transaction round trip › core → insert → (+id, seq) → core is deep-equal` | Round trip |
| `corporateActionFromRow › cash: amount_per_share, pay_date; null pay_date → no payDate key` | Cash variant |
| `corporateActionFromRow › stock: ratio_den→held, ratio_num→received (100:20)` | Pinned direction |
| `corporateActionFromRow › rejects cash row with null amount / stock row with null ratio` | Variant integrity |
| `corporateAction round trip (cash and stock)` | Round trip |
| `settingsFromRow › maps ppm fields 1:1, holidays string[] kept, settlement_days number` | AC4 |
| `settingsFromRow › fee_rate_ppm null throws RowMappingError(field 'fee_rate_ppm')` | Unset fee is visible, never 0 |
| `settingsToRow › DEFAULT_MARKET_SETTINGS + feeRatePpm null → row with id 1` | Seeding path for a later ticket |
| `settings round trip` | Round trip |

## Approach
1. **Tables migration** (`…000100_v1_tables.sql`), all in `public`. Dates are `date`, timestamps are `timestamptz`. Every `symbol` column has `check (symbol ~ '^[A-Z0-9]{1,20}$')` so 'vnm' and 'VNM' can't split a holding.
   - `transactions`
     - `id uuid pk default gen_random_uuid()`
     - `seq bigint generated always as identity unique`, with comment "same-day ordering key; insert imports in file order"
     - `trade_date date not null`, `symbol text not null`, `side text not null check in ('buy','sell')`
     - `quantity integer not null check (>0)`, `price integer not null check (>=0)` (both match core validation)
     - `fee bigint null check (>=0)`, `tax bigint null check (>=0)`, with comment "NULL = use settings estimate"
     - `source text not null default 'manual' check in ('manual','import')`, `import_batch_id text null`, `external_ref text null`
     - `created_at timestamptz not null default now()`
     - `unique (source, import_batch_id, external_ref)`, keeping the default NULLS DISTINCT
     - index `(symbol, trade_date, seq)`
   - `corporate_actions`
     - `id uuid pk default gen_random_uuid()`, `symbol`
     - `type text not null check in ('cash_dividend','stock_dividend')`
     - `ex_date date not null`, `record_date`, `pay_date`, `listing_date` (nullable dates)
     - `amount_per_share bigint`, `ratio_num integer`, `ratio_den integer`
     - Named check `corporate_actions_type_shape`:
       - cash requires `amount_per_share >= 0` (core allows 0) and both ratios null
       - stock requires `ratio_num > 0` and `ratio_den > 0` and amount null
     - Comment: "100:20 = ratio_den 100 held, ratio_num 20 received"
     - `created_at`, `unique (symbol, type, ex_date)`, index `(symbol, ex_date)`
   - `assets`
     - `id uuid pk`, `type text not null check in ('cash','other')`, `name text not null`
     - `value bigint not null check (>=0)`, `as_of date not null`, `created_at`
     - index `(type, as_of desc)`
   - `watchlist`: `symbol text pk`, `group_name text not null default 'watching'` (spec `group` is a reserved word; only the manual "Watching" group is stored, Holdings is derived), `added_at timestamptz not null default now()`
   - `settings`
     - Single row: `id smallint pk default 1 check (id = 1)`
     - `fee_rate_ppm integer null check (>=0)`, with **no default** (user setting, stays visibly unset)
     - `sell_tax_rate_ppm integer not null check (>=0)`, `dividend_withholding_rate_ppm integer not null check (>=0)`
     - `settlement_days smallint not null check (>=0)`
     - `holidays date[] not null default '{}'`
     - `cash_dividend_treatment text not null check in ('reduceCost','income')`
     - `cost_method text not null check (= 'WAC')`
     - `concentration_threshold_ppm integer null check (between 0 and 1000000)`
     - `rule_configs jsonb not null default '{}' check (jsonb_typeof = 'object')`, with comment "R5 per-exchange price limits, lot size, signal rule params; no money values (R2)"
     - `updated_at timestamptz not null default now()`
     - **No seed row and no market defaults in SQL.** Defaults live once in core `DEFAULT_MARKET_SETTINGS`, and a later ticket inserts the row through `settingsToRow`.
   - `prices_daily`
     - `symbol`, `trade_date date`, `open/high/low/close integer not null`
     - `volume bigint not null check (>=0)` (shares)
     - `foreign_net bigint null`, with comment "signed net foreign buy−sell value, VND"
     - `source text not null`, `fetched_at timestamptz not null`
     - `primary key (symbol, trade_date)`, holding one canonical row with its source recorded
     - Checks: `low >= 0`, `low <= high`, `open` and `close` between `low` and `high`
   - `data_gaps`
     - `id bigint generated always as identity pk`, `symbol text null` (null = market-wide), `data_type text not null`
     - `from_ts timestamptz not null`, `to_ts timestamptz not null check (to_ts >= from_ts)`
     - `detected_at timestamptz not null default now()`, `source text not null`, `fetched_at timestamptz not null`
     - `resolved_at timestamptz null`
     - index `(symbol, from_ts)`
   - No foreign keys (free-text symbols, as consult recommends).
2. **RLS/grants migration** (`…000200_v1_rls_grants.sql`), applied to each of the 7 tables:
   - `enable row level security`
   - `revoke all … from anon, authenticated`
   - `grant select, insert, update, delete … to service_role`. This is needed because BYPASSRLS skips policies but not GRANTs.
   - Sequences: `revoke all on all sequences in schema public from anon, authenticated` and `grant usage, select on all sequences … to service_role`.
   - Default privileges: `alter default privileges in schema public revoke all on tables / sequences / functions from anon, authenticated`.
   - No policies at all. → R3, R6 (all access goes through server code that verifies the JWT and allowlist).
3. **Rollback scripts**: tables down = `drop table if exists …` in reverse dependency order. RLS down = comment-only no-op (see Files).
4. **`scripts/db-check.sh`** (`set -euo pipefail`, plus `trap` cleanup). For each SQL file: `psql -X -v ON_ERROR_STOP=1 --single-transaction -f`. Migrations are applied in `ls | sort` order and rollbacks in reverse order. Each step prints its name, and the script ends by printing `db:check OK`.
5. **Mappers in `packages/core/src/db/`.** Core stays the single shared package for web and worker, and no new package is needed.
   - `toSafeInt(value: unknown, field: string): number`
     - accepts a safe-integer `number`, a `bigint`, or a string matching `/^-?\d+$/`
     - checks the range with `BigInt` and `Number.isSafeInteger`
     - otherwise throws `RowMappingError { table, field }` (extends `Error`)
   - Dates must be `'YYYY-MM-DD'` strings (use `isValidDate` from `calendar.ts`). A `Date` object is rejected with the message "configure the driver to return DATE as string (pg type 1082)".
   - Functions:
     - `transactionFromRow`
     - `transactionToInsert(tx: Omit<Transaction,'id'|'seq'> & { id?: string }, meta: { source: 'manual'|'import'; importBatchId?: string; externalRef?: string })`
     - `corporateActionFromRow`
     - `corporateActionToRow(action, meta?: { recordDate?: string })`
     - `settingsFromRow`, which throws on null `fee_rate_ppm`
     - `settingsToRow(s: Omit<LedgerSettings,'feeRatePpm'> & { feeRatePpm: number | null })`, which writes ledger columns only
   - Optional keys are **omitted**, not set to `undefined`, so round-trip `toEqual` holds.
   - Mappers do no financial calculation, only conversion (R1, R2).
6. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check`. Paste the outputs into impl-log (R8).

Rules: R2 (bigint/integer, check 2, `toSafeInt`), R3/R6 (no policies, revokes, behavioural check), R4 (`source`/`fetched_at` NOT NULL), R5 (rates in `settings`, limits and lot size in `rule_configs`, no market values hard-coded in SQL), R7 (no tables beyond the 7, no app wiring), R10 (no brokerage tables).

## Specialist input used
From `consult-database-optimizer.md`:
- **Adopted:**
  - no `lots` table (flagged above)
  - DDL shapes and indexes
  - `seq` identity as the ordering key
  - NULLS DISTINCT import uniqueness
  - `ratio_den/num` ↔ `held/received`, pinned in comment and test
  - dropping `applied`
  - `unique (symbol,type,ex_date)`
  - single-row settings with nullable fee
  - two migrations (tables, then RLS)
  - revoke + RLS double layer
  - SQL checks 1–6
  - test-only role bootstrap
  - Option A (throwaway Postgres) as primary and the CLI as optional
  - rollback scripts with down→up in the check
  - `toSafeInt` and the listed mapper tests
- **Adapted:**
  - Bootstrap also *grants* Supabase-like defaults first, so the revoke is really exercised.
  - Added the "RLS blocks even with grant" check to test the second layer independently.
  - Cash `amount_per_share >= 0` instead of `> 0`, to match core validation.
- **Rejected:**
  - `force row level security`: with no policies it would lock out the table owner (`postgres`, dashboard/migrations) and adds nothing for `service_role`.
  - `alter default privileges for role supabase_admin`: on hosted Supabase `postgres` is not a member of `supabase_admin`, so the migration would fail. The grants check catches any drift instead.
  - Seeding `settings` in the migration: defaults stay single-sourced in core.

## Assumptions
Non-blocking. Each is a documented default; **flag to Ming in the PR/impl-log**.
1. `prices_daily` keeps one row per `(symbol, trade_date)`, with the winning source recorded. Fallback sources overwrite and don't coexist. Changing to a per-source PK later is a small migration. (Consult Q1)
2. `foreign_net` is **signed VND value** (bigint), not shares. (Q2)
3. `settings` gets no seed row. The app creates it from `DEFAULT_MARKET_SETTINGS` and the fee stays null until Ming enters it, so `settingsFromRow` throws instead of defaulting to 0. (Q3)
4. Per-exchange price limits and lot size live in `settings.rule_configs` jsonb until the signals ticket gives them a typed shape. (Q4)
5. No `exchange` column yet. Symbols are free text, uppercase-checked. Exchange metadata is a follow-up for the signals and price-limit work. (Q5)
6. `pnpm db:check` on a throwaway Postgres 16 counts as "`supabase db reset` or equivalent". No `supabase/config.toml` is added in this ticket. (Q6)
7. Rollback scripts are delivered and exercised. The RLS rollback is deliberately a no-op. (Q7)
8. `pnpm db:check` is **not** part of `pnpm test`, because it needs Postgres binaries. The reviewer runs it explicitly. No CI workflow exists yet, so adding it to CI is a follow-up.
9. Rights issue is out of the `corporate_actions.type` check for v1.0, consistent with STK-002 core. Adding it later is a constraint change.
10. Size: about 650 changed lines, roughly 45% of them declarative SQL and SQL checks and about 35% tests. That is over the ~400-line guide, but it is one spec feature (§5) and the mappers depend on the final column names, so it stays one slice (see Split proposal for the fallback).

## Blocking questions
None.

## Split proposal
None. Fallback if rework shows the size is unmanageable: slice A = ACs 1–6 (migrations, rollback, `db:check`); slice B = AC 7 (mappers in `packages/core/src/db/`) as a follow-up ticket.

# consult-database-optimizer — STK-003

## Findings
- `supabase/` only has `.gitkeep`; nothing exists to conflict with. Core `Transaction` has `seq`, optional `fee`/`tax`, and `tradeDate` as a string. `CorporateAction` is a union: cash (`amountPerShare`, `payDate`) and stock (`ratio` held/received, `listingDate`). `LedgerSettings` uses ppm rates, `settlementDays`, `holidays`, `dividendWithholdingRatePpm`, `cashDividendTreatment` and `costMethod='WAC'`.
- Core `Lot` uses WAC with `source` buy|stock_dividend and `quantityRemaining`. It is a pure function of transactions, actions, settings and an as-of date. The `status` and `sellableFrom` values depend on the as-of date.
- Spec §5 lists `lots` with `buy_transaction_id`, `quantity_remaining` and `cost_per_share`. That shape no longer fits core: lots can come from stock dividends, and cost is tracked per symbol (WAC), not per lot.

## Recommendations

**Divergence for Ming (flag explicitly): do NOT create `lots` in v1.0.** Lots are derived in core (AC 3 of STK-002; spec line 174 says "never stored as editable balances"). A stored table would duplicate `quantity_remaining`, which drifts on any backdated edit, and its columns can't represent stock-dividend lots or WAC. If a snapshot is wanted later, add it in a separate ticket as a rebuildable cache. The AC table list already omits `lots`, so this matches the ticket.

**DDL shape per AC** (all in `public`; dates are `date`, timestamps are `timestamptz`):
- `transactions`
  - `id uuid pk default gen_random_uuid()`
  - `seq bigint generated always as identity`, unique. It is the stable same-day ordering key, and core reads it as a number.
  - `trade_date date not null`
  - `symbol text not null`
  - `side text check (side in ('buy','sell'))`
  - `quantity integer check (>0)`
  - `price integer check (>=0)`
  - `fee bigint null check (>=0)`, `tax bigint null check (>=0)`. Null means "use the settings estimate", matching core's `fee?`/`tax?`.
  - `source text check in ('manual','import')`
  - `import_batch_id text`, `external_ref text`
  - `created_at timestamptz`
  - `unique (source, import_batch_id, external_ref)` for import idempotency. Use `nulls not distinct` carefully: manual rows have nulls and must not collide, so keep the default null-distinct behavior.
  - Index `(symbol, trade_date, seq)`.
- `corporate_actions`
  - `id uuid pk`
  - `symbol text`
  - `type text check in ('cash_dividend','stock_dividend')`. Rights issue is excluded from v1.0 and can be added via a constraint change later.
  - `ex_date date not null`, `record_date date`, `pay_date date`, `listing_date date`
  - `amount_per_share bigint`, `ratio_num integer`, `ratio_den integer`
  - Type check constraint: cash requires `amount_per_share > 0` and null ratio. Stock requires `ratio_num > 0` and `ratio_den > 0` and null amount.
  - Core's `held`/`received` map to `ratio_den`/`ratio_num`. Pin the direction in a column comment (100:20 means `den`=100 held, `num`=20 received) and in the mapper test.
  - Drop the spec's `applied` (see consult-002). Add `unique (symbol, type, ex_date)` to prevent double entry.
  - Index `(symbol, ex_date)`.
- `assets`
  - `id uuid pk`
  - `type text check in ('cash','other')`
  - `name text`
  - `value bigint check (>=0)`
  - `as_of date`
  - Index `(type, as_of desc)`.
- `watchlist`
  - `symbol text pk` (single user)
  - `"group" text` (reserved word, so name it `group_name`)
  - `added_at timestamptz default now()`
- `settings`
  - Single-row table: `id smallint pk default 1 check (id = 1)`
  - `fee_rate_ppm integer not null check (>=0)`
  - `sell_tax_rate_ppm integer default 1000`
  - `dividend_withholding_rate_ppm integer default 50000`
  - `settlement_days smallint default 2`
  - `holidays date[] not null default '{}'`
  - `cash_dividend_treatment text check in ('reduceCost','income') default 'reduceCost'`
  - `cost_method text check (= 'WAC') default 'WAC'`
  - `concentration_threshold_ppm integer`
  - `rule_configs jsonb not null default '{}'`
  - `updated_at timestamptz`
  - The fee rate has no market default (user setting). Make it nullable with no default, or insert no row in the migration, so an unset fee is visible. The migration may seed market defaults only if R5 config is intentional; otherwise seeding is the app's job.
  - Price limits per exchange and lot size (R5) go in `rule_configs` jsonb, or in typed columns if the plan wants them now. This is a plan decision.
- `prices_daily`
  - `symbol text`, `trade_date date`
  - `open integer`, `high integer`, `low integer`, `close integer`
  - `volume bigint`, `foreign_net bigint` (signed VND or shares, document which)
  - `source text not null`, `fetched_at timestamptz not null`
  - `pk (symbol, trade_date)`. Decide whether to keep one row per source. Simplest is a single primary row with `source` recorded; if fallback sources should coexist, use `pk (symbol, trade_date, source)`.
  - `check (low <= high)` and basic OHLC sanity checks.
- `data_gaps`
  - `id bigint identity pk`
  - `symbol text`, `data_type text`
  - `from_ts timestamptz`, `to_ts timestamptz`
  - `detected_at timestamptz`
  - `source text not null`, `fetched_at timestamptz not null` (the AC requires both)
  - `resolved_at timestamptz null`
  - `check (to_ts >= from_ts)`
  - Index `(symbol, from_ts)`.
- Money is `bigint` and shares/prices are `integer`. No `numeric`, `real` or `double` anywhere. A script check that scans `information_schema.columns` for those types is worthwhile.
- Foreign keys: none are required between these tables. Use a free-text `symbol`, and consider an `assets` or `symbols` table later. Index any FK that is added (rule 2).

**RLS and grants** (one migration, repeated per table):
```sql
alter table public.X enable row level security;
alter table public.X force row level security;   -- optional; the service role bypasses via BYPASSRLS regardless
revoke all on public.X from anon, authenticated;
```
Also add this once, so future tables are covered:
```sql
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
```
Note that default privileges only apply to objects created by the role that runs the `alter default privileges` statement (the migration role `postgres`). Also run the same statement `for role supabase_admin` if that role exists. Add `revoke all on all sequences in schema public from anon, authenticated` for the identity sequences. Without the revokes, Supabase default grants would give anon/authenticated table privileges that RLS then blocks, which makes RLS-with-no-policy the only defense. Revoking the grants adds a second layer. The service role needs no grants (it is a superuser-like BYPASSRLS role), but grant explicitly to `service_role` for clarity.

**Verifying RLS in a SQL check** (`supabase/tests/rls.sql` or a script run with psql, `ON_ERROR_STOP=1`):
1. `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity` must return 0 rows.
2. `select * from pg_policies where schemaname='public'` must return 0 rows (a policy for any role, not only anon/authenticated).
3. `select ... from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')` must return 0 rows.
4. Behavioral test: `set role anon; select 1 from transactions;` must raise `42501` (insufficient privilege). Repeat for `authenticated`, then `reset role`. Wrap each in `do $$ begin ... exception when insufficient_privilege then null; end $$` and raise if it didn't fail. Also check an insert is denied.
5. Optionally insert a row as the owner and confirm `service_role` can read it.
6. Constraint checks: negative quantity rejected, `check` on type/ratio rejected, and a column-type scan (no `numeric`/`real`/`double precision`).

Plain Postgres has no `anon`/`authenticated`/`service_role` roles. The check bootstrap must create them (`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`) before applying migrations, only in the local test script and not in a migration. The `supabase/` real stack already has them, so make the bootstrap idempotent (`do $$ ... if not exists`).

**Local migration verification** (no CLI binary):
- **Option A (recommended, fast, no network)**: a script `scripts/db-check.sh` run by `pnpm db:check`. It starts a throwaway Postgres 16 (`pg_ctl` in a temp dir, or `docker run postgres:16` on a random port), runs the role bootstrap, applies `supabase/migrations/*.sql` in filename order with `psql -v ON_ERROR_STOP=1 --single-transaction -f`, then runs `supabase/tests/*.sql`, and tears down. This works in CI with the Postgres service as well. Catch: the server-package `pg_ctl` binaries sit under `/usr/lib/postgresql/16/bin` and are not on PATH.
- **Option B**: `npx supabase db reset` / `supabase start` needs Docker pulling about 10 images through the proxy, so it is slow and may fail; use it as an optional documented path only. `supabase db lint` and `supabase test db` (pgTAP) are also CLI-bound.
- Also check reversibility (rule 5): Supabase migrations are forward-only. Ship a `down` script per migration or a documented `drop` section (for example `supabase/rollback/`), and in the check apply down and then up again on the throwaway DB. This is cheap and covers the "reversible" rule.
- File naming: `supabase/migrations/<14-digit timestamp>_<name>.sql`. Use one migration for tables and one for RLS/grants, so a future table forgetting RLS fails the check. Add `supabase/config.toml` only if the CLI is wanted (low value now).

**Row <-> core mappers** (in `packages/core` or a shared package; the ticket asks for unit tests):
- Supabase JS returns `bigint` columns as JS `number` by default (JSON), or as strings through some drivers such as `pg` (int8 is returned as a string). The mapper should accept `number | string | bigint`, convert with `Number()` after a regex/BigInt check, and throw if `!Number.isSafeInteger` (R2). Use a single `toSafeInt` helper.
- Test: null `fee` maps to undefined (not 0); date strings stay `YYYY-MM-DD`; `ratio_num`/`ratio_den` map to `received`/`held`; nulls on cash vs stock rows; unsafe value (`'9007199254740993'`) throws; and round trip core -> row -> core.
- `seq` is identity `bigint`. Same safe-int conversion.

## Risks
- `lots` divergence from spec: an unflagged omission would surprise Ming. The report must call it out (see above).
- `bigint` via `pg` is a string: a naive `row.fee + 1` becomes string concatenation. Mapper tests must cover this.
- Default Supabase grants: if the revokes are skipped, anon and authenticated retain table privileges and only RLS protects data. The public anon key is exposed in browsers if ever used, which is why the double layer matters (R3).
- `alter default privileges` applies only for the role running it; objects created later by `supabase_admin` (dashboard) may still get default grants. The RLS check (grants and relrowsecurity) catches this.
- Identity `seq` is not gapless and not reused after delete; ordering stays stable but not contiguous. Fine for tie-breaking. Bulk imports should insert in file order so `seq` reflects it.
- `holidays date[]` in `settings` is simple, but a separate `market_holidays` table may be better when exchanges differ. Acceptable for v1 single-user.
- `rule_configs jsonb` bypasses column typing; keep money out of it (R2).
- Spec `data_gaps` has no `source`/`fetched_at`, but the AC adds them; keep.

## Open questions
1. `prices_daily` key: one row per (symbol, date), or one per (symbol, date, source) to hold fallback sources?
2. `foreign_net` unit: shares or VND? Pick one and document it.
3. Should `settings` be seeded with market defaults in the migration, or created by the app on first run? The fee rate must stay unset until Ming enters it.
4. Where do R5 per-exchange price limits and lot size live: typed columns now, or `rule_configs` jsonb until the signals ticket?
5. Is `symbol` free text, or should an `exchange` column (HOSE/HNX/UPCoM) go on `watchlist`/`prices_daily` now, given price limits differ by exchange?
6. Accept `Option A` (throwaway Postgres + psql script) as the AC's "equivalent" to `supabase db reset`, with the CLI path documented as optional?
7. Should down migrations be required deliverables for this ticket (recommended, a small `rollback` script per migration)?

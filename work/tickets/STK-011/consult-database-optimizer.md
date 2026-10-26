# consult-database-optimizer — STK-011

STK-011 `symbols` table consult (read-only). I read the two migrations, both rollbacks, `checks.sql`, the `packages/db` repos, the fake client, and `EXCHANGES` in core. I did not look at `README.md`, `bootstrap-roles.sql` or `apps/web`.

## Findings
- The existing migrations are `20261023000100_v1_tables.sql` and `20261023000200_v1_rls_grants.sql`. The grants migration holds a hard-coded table array in a DO loop that enables RLS, revokes anon/authenticated and grants service_role. It does not cover new tables, and the default privileges only revoke from anon/authenticated. A new migration must therefore do its own enable-RLS, revoke and grant.
- Rollbacks live in `supabase/rollback/<ts>_<name>.down.sql`. The tables rollback is a plain `drop table if exists`. The RLS rollback is an intentional no-op.
- `checks.sql` pins the exact table set in `tables_exist` (line 34). It would fail as soon as `symbols` exists.
- Other `checks.sql` loops are generic and will cover `symbols` automatically:
  - `rls_enabled_all_tables`
  - `no_policies`
  - `no_grants_anon_authenticated_public`
  - `anon_denied` / `authenticated_denied`, which run `insert ... default values` and need SQLSTATE 42501. The permission check fires before NOT NULL, so this is fine.
- `EXCHANGES = ['HOSE','HNX','UPCOM']` is in `packages/core/src/settings/market-rules.ts`. The DB check list must match it exactly. Note it is `UPCOM`, not `UPCoM`.
- The `watchlist` table and `addToWatchlist` insert only `{symbol}`. `addToWatchlist` maps a duplicate to CONFLICT.
- The worker's EOD sync set is the watchlist union held symbols. It comes from `listWatchlist` in `apps/worker/src/store.ts`. Adding a watchlist row already satisfies the "part of EOD sync" criterion. `symbols` does not need to drive the sync.
- The fake client's `METHODS` are `select, eq, gte, lte, order, limit, range, insert, update, upsert, delete, single, maybeSingle`. There is no `in`, `neq` or `or`. Calling `.in()` would throw "not a function" in tests.
- `getLatestCloses` already works around this with one query per symbol through `Promise.all`.

## Recommendations
1. **Migration** `supabase/migrations/20261025000100_symbols.sql`:
   ```sql
   create table public.symbols (
     symbol text primary key check (symbol ~ '^[A-Z0-9]{1,20}$'),
     exchange text check (exchange in ('HOSE','HNX','UPCOM')),
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   comment on column public.symbols.exchange is 'NULL = unknown; never default to HOSE (R5). Values mirror core EXCHANGES';
   alter table public.symbols enable row level security;
   revoke all on public.symbols from anon, authenticated;
   grant select, insert, update, delete on public.symbols to service_role;
   ```
   - There is no extra index, because the PK covers lookups.
   - No FK to `watchlist` or `transactions`. A symbol can be held without being watched, and the other tables carry no FKs.
   - Keep the `updated_at` column, since the settings table has one. The repo must set it on upsert, because there is no trigger.
   - Put the RLS and grants in the same file, or in a second file `20261025000200_symbols_rls_grants.sql`. Either is acceptable. I prefer the same file, because it can't be applied half-done.
2. **Rollback** `supabase/rollback/20261025000100_symbols.down.sql`: `drop table if exists public.symbols;`. It needs no no-op companion, because dropping the table removes its RLS and grants.
3. **`checks.sql`**
   - Add `'symbols'` to the `tables_exist` array. Keep it sorted: `...,'prices_daily','settings','symbols','transactions','watchlist'`.
   - Add a `symbols_columns` block:
     - `assert_col('symbols','exchange','text')`, nullable.
     - `assert_col('symbols','symbol','text',true)`.
   - Add `expect_fail` cases to `rejects_bad_rows`, all expecting 23514:
     - an `insert into public.symbols (symbol, exchange)` with `'vnm'`;
     - one with exchange `'HSX'`;
     - one with exchange `'hose'`.
   - Add a positive check that inserting `('VNM', null)` succeeds.
   - Add a service_role check that insert, select and delete on `symbols` all work.
   - The generic anon/authenticated/RLS/grant loops need no change.
4. **Repo** `packages/db/src/repos/symbols.ts`:
   - `SymbolRow { symbol; exchange: string | null; ... }` in `rows.ts`.
   - Add a mapper that validates the exchange against core `EXCHANGES`. Unknown or invalid non-null values should throw a mapping error through `mapRow`, not be silently coerced. The result type is `Exchange | null`.
   - `getSymbolExchanges(db, symbols: readonly string[]): Promise<Record<string, Exchange | null>>`:
     - Return early with `{}` for an empty input.
     - Use one query: `select('symbol,exchange').in('symbol', list)`.
     - Symbols with no row are omitted. The caller treats an omitted symbol as unknown, which gives "—".
   - `upsertSymbolExchange(db, symbol, exchange: Exchange | null)`:
     - Use `.upsert({symbol, exchange, updated_at}, {onConflict:'symbol'})` with no `.select()`. This follows the `upsertPricesDaily` pattern, where supabase returns `data: null`.
     - Run it through `unwrap` on error.
     - Re-adding a symbol with a blank exchange must not wipe an already-known exchange. Either skip the upsert when the exchange is null, or use `insert ... on conflict do nothing` via `ignoreDuplicates: true` for the blank case. Ming's explicit choice should overwrite.
   - Export both from `index.ts`.
5. **Fake client**: add `'in'` to `METHODS` in `packages/db/test/fake-client.ts`. It is a one-word, test-only change and the real supabase builder has `.in`.
6. **Watchlist add handler**
   - Yes, upsert into `symbols` in the same server action. Order it as `upsertSymbolExchange` first, then `addToWatchlist`.
   - If the symbols upsert succeeds and the watchlist insert hits CONFLICT, the exchange update is still harmless and idempotent.
   - Supabase has no cross-table transaction via supabase-js. Don't build an RPC for this.
   - Put a thin composed function `addWatchedSymbol(db, symbol, exchange)` in `packages/db` so the web action stays one call.
   - Removing from the watchlist should not delete from `symbols`. The symbol may be held, and the exchange is cheap to keep.
   - Held symbols get no `symbols` row unless Ming sets one. The UI needs a way to set the exchange for a held symbol, so that ceiling and floor aren't always "—" for holdings. This means an "edit exchange" action calling `upsertSymbolExchange`. Confirm it is in scope.
7. **Last two closes for many symbols**
   - Do not use `.in()` with `order` and `limit(2)`. `limit` applies to the whole result, not per symbol.
   - Option A, matching the existing pattern: per symbol, `Promise.all` over `select(COLS).eq('symbol', s).order('trade_date', {ascending:false}).limit(2)`. This is an N-query fan-out. It is fine for a personal watchlist of tens of symbols, and it works with the current fake client.
   - Option B: a single query with `.in('symbol', list).gte('trade_date', cutoff).order(...)`, grouped in code. Pick `cutoff` generously, for example 14 calendar days back, to cover weekends and holidays. Pick two per symbol in the repo. This needs `in`. If a symbol has fewer than two rows in the window, report it as "no previous close" rather than widening silently.
   - I recommend Option A for correctness and consistency, and noting Option B as a later optimisation. Return `Record<string, PriceQuote[]>` (newest first, length 0 to 2). Compute change and % in core, not in the repo or UI (R1).
   - The change is `close - prev_close` per symbol. Reference, ceiling and floor must use the previous session's close, which is the last two closes, with the limit rate chosen from the symbol's exchange. Keep the arithmetic and rounding in core (R1, R2, R5). The ceiling and floor must also respect tick or rounding rules defined in core. Check this against the existing core helper.

## Risks
- Not updating the `tables_exist` list fails db:check immediately.
- Without the `'in'` fake method, the many-symbols query can't be unit-tested.
- A blank-exchange upsert overwriting a known exchange silently turns ceiling/floor into "—".
- A hard-coded exchange list in SQL can drift from core `EXCHANGES`. Add a comment in the migration and a `checks.sql` assertion. Adding an exchange later needs a migration.
- The check constraint is case-sensitive. The UI must submit uppercase values from the `EXCHANGES` constants only.
- Option B's cutoff window can return fewer than two rows after long holidays or for newly listed symbols. The UI must show "—" and not fabricate a reference price. Reference price should come from the last stored close, flagged for staleness (R4), and never produce a limit from stale or gapped data without a freshness flag.
- R6 is suspended, so the action has no auth. Keep it going through server-only code with the service role, so R3 holds.
- `anon_denied` runs `insert default values` on every table. This is fine for `symbols`, but it is the reason RLS and grants must be in place before db:check runs.

## Open questions
1. Should `updated_at` exist, or only `created_at`? I recommend both, for traceability.
2. Is the held-symbol exchange edit UI in this ticket's scope? Otherwise Holdings rows always show "—" for ceiling and floor until Ming sets the exchange via the watchlist add form.
3. Should re-adding an already-watched symbol be a no-op CONFLICT (today's behaviour), or a way to edit its exchange? I recommend a separate edit action, and keeping CONFLICT.
4. Should the migration backfill `symbols` rows with a null exchange for existing watchlist and transaction symbols? It is not needed, because missing rows are treated as unknown.

## Files
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql
- /home/user/stoktok/supabase/rollback/20261023000100_v1_tables.down.sql
- /home/user/stoktok/supabase/rollback/20261023000200_v1_rls_grants.down.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/packages/db/test/fake-client.ts
- /home/user/stoktok/packages/db/src/repos/watchlist.ts
- /home/user/stoktok/packages/db/src/repos/prices-daily.ts
- /home/user/stoktok/packages/core/src/settings/market-rules.ts
- /home/user/stoktok/apps/worker/src/store.ts

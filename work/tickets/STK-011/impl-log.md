## Attempt 1 — 2026-10-25

Built in plan slice order 1 (db + core), 2 (read-only board), 3 (actions). No commit, no push (per caller). No auth code (R6 suspended).

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261025000100_symbols.sql | new `symbols` table with RLS + grants in one file (Ming's decision) |
| supabase/rollback/20261025000100_symbols.down.sql | db:check rollback step |
| scripts/db-check/checks.sql | `symbols` in tables_exist, column checks, 3 bad-row cases, service_role + null-exchange inserts |
| packages/core/src/market/config.ts | `TickBand`, `DEFAULT_TICK_BANDS` (UNVERIFIED, R5) |
| packages/core/src/market/price-board.ts | tickSize, isOnTick, priceLimits, buildPriceBoardRow, splitWatchlistGroups |
| packages/core/src/market/price-board.test.ts | unit tests for the above |
| packages/core/src/entry/validate-watchlist.ts (+ .test.ts) | add/edit validation in core |
| packages/core/src/entry/messages-vi.ts | EXCHANGE_INVALID, WATCHLIST_DUPLICATE |
| packages/core/src/index.ts | exports |
| packages/db/src/rows.ts, mappers.ts | SymbolRow, PriceCloseRow, symbolExchangeFromRow, storedCloseFromRow |
| packages/db/src/repos/symbols.ts (+ .test.ts) | getSymbolExchanges, setSymbolExchange |
| packages/db/src/repos/prices-daily.ts (+ .test.ts) | getRecentCloses |
| packages/db/test/fake-client.ts | `'in'` method |
| packages/db/src/index.ts | exports |
| apps/web/server/watchlist/load-watchlist.ts (+ .test.ts) | loader, R1/R3 |
| apps/web/components/watchlist/price-board.tsx | table + cards, format only |
| apps/web/components/watchlist/watchlist.test.tsx | render tests (board + forms) |
| apps/web/app/(app)/watchlist/page.tsx | page, then wired with forms in slice 3 |
| apps/worker/src/store.test.ts | AC5 store wiring test |
| apps/web/server/watchlist/handlers.ts (+ .test.ts) | add / remove / set exchange |
| apps/web/app/(app)/watchlist/actions.ts | server actions |
| apps/web/components/watchlist/add-symbol-form.tsx, row-forms.tsx | client forms |

### Tests added / changed
- core: price-board.test.ts (tickSize, bands guard, priceLimits cases, buildPriceBoardRow cases, splitWatchlistGroups), validate-watchlist.test.ts
- db: symbols.test.ts, prices-daily.test.ts › getRecentCloses
- web: load-watchlist.test.ts, handlers.test.ts, watchlist.test.tsx
- worker: store.test.ts
- db:check: new symbols assertions in checks.sql

### Checks (actual output summary)
- pnpm install: lockfile up to date
- typecheck: core, db, web, worker all Done
- lint: core, db, web, worker all Done
- test: core 268 passed, db 75 passed + 1 todo, worker 27 passed, web 148 passed (18 files); no-calc-in-ui passes unchanged
- build: ok, /watchlist is dynamic (ƒ)
- check:service-key: "OK: no service key material in client bundle"
- db:check: apply, checks, rollback to 0 tables, re-apply, checks again: "db:check OK"

### Out-of-plan files
- packages/core/src/entry/messages-vi.test.ts: its CODES list must include the two new codes (one-line addition).

### Follow-ups (noticed, not done)
- Make `tickBands` configurable through rule_configs and settings UI.
- Theoretical ex-date reference from corporate_actions (ex-date sessions show no reference for now).
- OR open `data_gaps` rows into the gapped flag (STK-031).
- Go-live verification items: tick table, ceiling-down/floor-up rounding, raw vs adjusted prices.
- `getRecentCloses` is N queries; switch to one `.in()` query if symbol count grows.
- `exchangeUnknown` flag is set for every row with exchange null, including rows with no price yet (UI shows "Chưa rõ sàn" only when data exists).

### Scope self-check
- Could the diff be smaller? No; every file is in the plan except the one-line messages test update.
- Diff size: ~1,500 lines including tests (plan estimate), 12 modified and 12+ new files; not committed.

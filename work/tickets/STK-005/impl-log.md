## Attempt 1 — 2026-10-24

Slice 1 only (AC1, AC2, AC3, AC5, AC6). AC4 (gap detection) is STK-031 and not built.

### Files touched
| File | Required because |
|---|---|
| packages/core/src/calendar.ts, calendar.test.ts | `subtractTradingDays` for the fetch window start |
| packages/core/src/market/config.ts (new) | R5 plausibility bounds |
| packages/core/src/market/daily-bar.ts, daily-bar.test.ts (new) | `toVnd` / `normalizeDailyBar` (R2, AC3) |
| packages/core/src/index.ts | export the new API |
| packages/db/src/repos/prices-daily.ts, prices-daily.test.ts | `upsertPricesDaily` (AC2) |
| packages/db/src/rows.ts | `PriceDailyInsert` type |
| packages/db/src/holdings.ts, holdings.test.ts (new) | `listHeldSymbols` (symbol scope) |
| packages/db/src/index.ts | export `upsertPricesDaily`, `listHeldSymbols`, type `PriceDailyInsert` |
| apps/worker/package.json, pnpm-lock.yaml | deps, vitest, scripts |
| apps/worker/tsup.config.ts, tsconfig.json, vitest.config.ts | bundle db + cli, typecheck tests, test setup |
| apps/worker/test/no-network.ts, test/fixtures/tcbs/* (new) | AC5; fixtures labelled SYNTHETIC |
| apps/worker/src/config.ts, store.ts, cli.ts, cli.test.ts (new) | R5 config, db wiring, CLI (AC6) |
| apps/worker/src/sources/price-source.ts, http.ts, http.test.ts, tcbs.ts, tcbs.test.ts (new) | AC1, AC3 |
| apps/worker/src/jobs/eod-sync.ts, eod-sync.test.ts (new) | AC2 job |
| package.json (root) | `worker:eod` script |
| apps/worker/README.md, docs/adr/0001-eod-price-source.md (new) | AC6 docs, ADR requested by Ming |

### Tests added / changed
- core: calendar.test.ts (subtractTradingDays), market/daily-bar.test.ts (toVnd, normalizeDailyBar, unit and jump guards)
- db: prices-daily.test.ts (upsert), holdings.test.ts
- worker: http.test.ts, tcbs.test.ts, eod-sync.test.ts, cli.test.ts

### Checks (actual output summary)
- typecheck: all 4 workspace projects pass
- lint: all pass
- test: core 192, db 57 (+1 todo), worker 26, web 106 passed
- build: pass (worker bundles dist/cli.js)
- check:service-key: OK, no service key material in client bundle
- Dry run: no live DB or source is available. Ran `runEodSync` with `dryRun: true` through a scratch script using the real `TcbsPriceSource` with stubbed fetch returning `bars-ok.json` and an in-memory store: ok true, 2 symbols (watchlist VNM + held FPT), 6 bars, 0 upserts, 0 rejected. `node dist/cli.js bogus` exits 2; `pnpm worker:eod --dry-run` without env fails with "Missing env SUPABASE_URL" (args pass through correctly).

### Out-of-plan files
None. (`export type { PriceDailyInsert }` in packages/db/src/index.ts is an addition to a listed file.)

### Follow-ups (noticed, not done)
- Plan did not say whether rejected bars affect `ok`; I made any rejection set `ok: false` (exit 1) so a unit error is never silent.
- Partial unique index on data_gaps and a single-run lock; `Retry-After` support; env overrides for config; backfill flag; fallback source; replace synthetic fixtures with recorded captures; adjusted-series decision (STK-015).

### Scope self-check
- Could the diff be smaller? No; the worker had no db dep, test runner or env loading.
- Diff size: ~1,200 added lines including tests, fixtures and docs (not committed, per instruction).

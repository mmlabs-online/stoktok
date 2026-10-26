# Implementation log — STK-015 (slice A)

## Attempt 1 — 2026-10-26

Slice A only. The Settings-screen section is STK-033 and is not built. Not committed, not pushed.

### Files touched
| File | Required because |
|---|---|
| `packages/core/src/signals/types.ts` (new) | shared result shape, reason codes and `REASON_ORDER`, `RULE_IDS`, input types |
| `packages/core/src/signals/config.ts` (new) | `SignalRules`, defaults, `SIGNAL_RULE_BOUNDS`, `parseSignalRules` (R5, AC2) |
| `packages/core/src/signals/inputs.ts` (new) | freshness, gap, EPS-basis and integer helpers, `finalizeResult` (AC3, R4) |
| `packages/core/src/signals/valuation.ts` (new) | `peVsSector`, `pbVsSector` |
| `packages/core/src/signals/growth.ts` (new) | `earningsGrowthTrend` |
| `packages/core/src/signals/moving-average.ts` (new) | `priceVsMa` |
| `packages/core/src/signals/evaluate.ts` (new) | `evaluateMediumSignals` for the whole universe |
| `packages/core/src/signals/{config,inputs,valuation,growth,moving-average,evaluate}.test.ts` (new) | R8 |
| `packages/core/src/market/config.ts` | `DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS = 45` (one shared value) |
| `packages/core/src/index.ts` | export the signals API and the constant |
| `supabase/migrations/20261026000200_signals.sql` (new) | `signals` table, constraints, RLS, revoke, grants (AC4) |
| `supabase/rollback/20261026000200_signals.down.sql` (new) | db:check applies rollbacks |
| `scripts/db-check/checks.sql` | `tables_exist`, `signals_columns`, `service_role_can_read_write_signals`, `rejects_bad_rows` cases |
| `packages/db/src/rows.ts` | `SignalInsert`, `SymbolSectorRow` |
| `packages/db/src/mappers.ts` | `symbolSectorFromRow` (sector must carry provenance) |
| `packages/db/src/repos/signals.ts` (+ `.test.ts`, new) | `upsertSignals` |
| `packages/db/src/repos/symbols.ts` (+ `.test.ts`) | `listSymbolSectors` |
| `packages/db/src/repos/data-gaps.ts` (+ `.test.ts`) | `listOpenMarketGaps` (symbol IS NULL) |
| `packages/db/src/repos/settings.ts` (+ `.test.ts`) | `getSignalRules` |
| `packages/db/src/index.ts` | exports |
| `apps/worker/src/jobs/medium-signals.ts` (+ `.test.ts`, new) | `runMediumSignals`, `SignalsStore`, `PRICES_GAP_TYPE` |
| `apps/worker/src/store.ts` (+ `.test.ts`) | `createDbSignalsStore` (financials read in symbol chunks) |
| `apps/worker/src/cli.ts` (+ `.test.ts`) | job `signals` |
| `apps/worker/src/config.ts` | `publishLagDays` from the core constant; `SIGNALS_JOB_CONFIG` |
| `apps/worker/src/sources/tcbs-financials.ts` | `TCBS_FINANCIALS_SOURCE_NAME`, `TCBS_FINANCIALS_EPS_BASIS = 'unverified'` |
| `apps/worker/README.md` | signals section, schedule, EPS-basis flip |
| `package.json` | `worker:signals` script |

### Tests added / changed
- core: `signals/*.test.ts` (config, inputs, valuation, growth, moving-average, evaluate): every case in the plan, including missing middle quarter, negative EPS/base, min 5 peers, 20 bars with N=200, stale price plus stale financials in `REASON_ORDER`.
- db: `signals.test.ts`, plus new cases in `symbols`, `data-gaps`, `settings` tests.
- worker: `medium-signals.test.ts`, `store.test.ts` (chunked financials), `cli.test.ts`.
- db:check: `signals_columns`, `service_role_can_read_write_signals` (upsert keeps the id), 14 `rejects_bad_rows` cases.

### Checks (actual output summary)
- typecheck: green (core, db, worker, web).
- lint: green.
- test: core 347 passed; db 100 passed, 1 todo; worker 65 passed; web 148 passed.
- build: green.
- check:service-key: OK, no service key material in client bundle.
- db:check: OK (apply, checks, rollback leaves 0 tables, re-apply, checks).
- Literal grep for `200000|20000|50|200` in `signals/*.ts` other than `config.ts` and tests: no hits.
- Job run on a fake in-memory store (scratch script outside the repo: `/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/run-signals.mts`, run with the worker's `tsx`): 8 symbols (6 banks, 1 steel, 1 with no data), `now` = Monday 12:00 VN so signalDate = Friday 2026-10-23.
  - Production basis (`unverified`): ok true, 40 results, 22 ok, 18 suppressed; by reason: eps_basis_unverified 7, peers_insufficient 8, insufficient_history 7, financials_missing 3, price_missing 4, sector_missing 2; 40 rows upserted.
  - Basis flipped to `quarterly` (illustration only): 28 ok, 12 suppressed (insufficient_history 7, peers_insufficient 2, financials_missing 3, price_missing 4, sector_missing 2).
  - Sample: ACB pe ok/neutral/55555 ppm, pb ok/neutral/-166667, growth ok/bullish/+4, MA50 ok/neutral, MA200 ok/neutral; VCB MA200 suppressed insufficient_history; HPG (only steel symbol) peers_insufficient; XXX price_missing, financials_missing, sector_missing.

### Out-of-plan files
- `packages/core/src/signals/fixtures.ts` (new): shared test helpers for the six core test files (not exported from the package).

### Deviations from the plan
- `runMediumSignals` deps have no `config`: the job needs no tuning value; `SIGNALS_JOB_CONFIG` goes to `createDbSignalsStore` in the CLI.
- Recorded-gap refs in the snapshot (`data_gaps:<id>`) carry `fromTs`/`toTs`, not `source`/`fetchedAt`: `OpenGapRecord` has neither, and changing `listOpenGaps` would touch the STK-014 path. The id cites the stored row.
- The plan's reference `GapRef` is the existing `OpenGapRecord` shape (structural match), no mapping needed.

### Follow-ups (noticed, not done)
- Plan completion vs annual target (AC6): no data source stores a plan or target.
- Raw-price guards (corporate action in window, jump beyond limit) before or with STK-032, when MA rules start giving `ok` rows (A6).
- Flip `TCBS_FINANCIALS_EPS_BASIS` after the financials dry-run, and update ADR 0002.
- STK-031 should reuse `PRICES_GAP_TYPE` from `medium-signals.ts`.
- Peer-universe setting; `pe_vs_own_history`; scorecard scoring on label change; immutable cited `ok` rows; a `signals` reader and date index for STK-016; bounded concurrency for per-symbol close reads; limit-hit session flag.
- Settings-screen section: STK-033 (uses `SIGNAL_RULE_BOUNDS`, `parseSignalRules`).
- Per-symbol `getRecentCloses(200)` is one query per symbol in parallel; fine for a small universe.

### Scope self-check
- Could the diff be smaller? No; each file is in the plan's list (plus the one test helper above).
- Diff size: +2,205 / -26 across 40 files (tracked: 20 files +349 / -26; the rest are new files, mostly tests).

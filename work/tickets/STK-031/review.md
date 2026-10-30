## Attempt 1 — 2026-10-29
Verdict: PASS

### Checks (run by reviewer)
- typecheck: pass (core, db, worker, web; `pnpm typecheck` exit 0)
- lint: pass (all 4 workspace projects)
- test: core 32 files / 365 passed; db 14 files / 105 passed + 1 todo; worker 8 files / 74 passed; web 20 files / 176 passed. Matches impl-log.md exactly.

### Acceptance criteria
- [x] Missing trading days written to `data_gaps` (data_type `prices_daily`); weekends and holidays are not gaps. Evidence: `price-gaps.test.ts` › "records missing trading days; weekends and holidays are not gaps"; `eod-sync.test.ts` › "records a prices_daily gap per missing trading day after the upsert", "configured holiday inside the window is not a gap"; `calendar.test.ts` › tradingDaysBetween (3 tests). Row built at `apps/worker/src/jobs/eod-sync.ts:158-159` with `data_type: PRICES_GAP_TYPE`, `vnDayBoundsUtc` bounds, `source: source.name`, `fetched_at` (R4). Store wiring uses `'prices_daily'` (`apps/worker/src/store.ts:41`, `store.test.ts` › "wires the gap reads and writes with prices_daily").
- [x] Re-runs don't duplicate open gaps, and instants are compared rather than strings. Evidence: `packages/core/src/market/price-gaps.ts:58-60` compares epoch ms via `Date.parse`. Tests: "an open gap stored as +00:00 matches a day computed as Z", "differs only in ms formatting still matches", "second plan over the same state is empty"; `eod-sync.test.ts` › "re-run inserts no new gaps", "existing open gap with +00:00 timestamps is not duplicated".
- [x] Gaps get `resolved_at` when the data arrives and are never deleted. Evidence: `price-gaps.test.ts` › "resolves an open gap once its day is stored", "resolves a gap whose day became a holiday", "multi-day open gap resolves only when every trading day is stored"; `eod-sync.test.ts` › "resolves a gap when the bar arrives; the gap row is kept with resolved_at = fetchedAt". `resolveGaps` now guards `.is('resolved_at', null)` (`packages/db/src/repos/data-gaps.ts:43`, asserted in `data-gaps.test.ts`). No `.delete(` in `data-gaps.ts`.
- [x] The expected range never starts before the first stored date or the lookback. Evidence: `price-gaps.ts:54-55` (null first date → nothing; start = max(windowStart, firstStoredDate)). Tests: "no stored data -> no gaps", "start clamps to first stored date", "start clamps to windowStart"; `eod-sync.test.ts` › "symbol first stored mid-window gets no earlier gaps; symbol with no stored rows gets none".
- [x] Core helpers and planner have unit tests; repos have fake-client tests; no live network. Evidence: `calendar.test.ts` (5 new), `price-gaps.test.ts` (12), `prices-daily.test.ts` › listPriceDates (3, including pagination) and getFirstPriceDates (2), `data-gaps.test.ts`. The worker tests use the in-memory store and fake source only.

### Issues
None.

### Scope
Every changed product and test file is in the plan's file list. The remaining changes are workflow bookkeeping: `work/backlog.md`, `ticket.md` state, plan, consults and impl-log. There are no out-of-plan changes. No migration.

### Rules R1–R10
No violations found.
- R1: all date and gap logic is in `packages/core` (`calendar.ts`, `market/price-gaps.ts`). The worker only loops and wires.
- R2: no money is involved.
- R3: worker-only code paths.
- R4: gap rows carry `source` and `fetched_at`.
- R5: holidays come from settings, the lookback from config and the cutoff from the core default.
- R6: suspended, not assessed.
- R8: green checks, and the new core logic has tests.

### Nits (do not block)
- `eod-sync.ts:149` calls `store.listPriceDates` sequentially inside the symbol loop. That is fine for a personal watchlist, but `Promise.all` would cut latency if the list grows.
- An open gap for a symbol that has since left the watchlist and holdings is never re-checked, so it stays open. This is harmless today because signals are not computed for such symbols.
- `tradingDaysBetween` calls `toUtc(to)` only to validate. A short comment would make the intent clearer.

### Follow-ups (out of scope)
- As in plan.md: a partial unique index on open gaps, a single-run lock, market-wide (`symbol IS NULL`) gaps, `insertGaps` chunking for STK-032 and intraday gap detection.
- Ming should confirm decisions D1–D6 from plan.md, especially D2 (failed symbols still record gaps) and D6 (the holiday list must be complete before go-live).

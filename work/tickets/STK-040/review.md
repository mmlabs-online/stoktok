## Attempt 1 — 2026-11-01
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` (Node 22) — core, db, web, worker all `Done`, no errors
- lint: `pnpm lint` — all four workspaces `Done`, no errors
- test: `pnpm test` — core 484 passed (40 files), db 117 passed + 1 todo, worker 139 passed (11 files), web 214 passed. Matches impl-log.md.

### Acceptance criteria
- [x] Bars on or before the latest fractional bar are rejected with a dedicated reason, integer bars included. Evidence: `vci.ts` computes `effective` before the loop and rejects `tradeDate <= effective` with `ADJUSTED_HISTORY_REASON` (`adjusted_price_history`). Tests: `vci.test.ts › VciPriceSource adjusted history › mixed response rejects every bar on or before the latest fractional bar` and `› integer-valued bar older than the latest fractional bar is rejected too`. Core rule tests are in `adjusted-history.test.ts` (7 tests, 10 cases).
- [x] Bars after the cut-off still go through core normalization unchanged. Evidence: `› bars after the cut-off are normalized as before` (a post-cut-off bar off the price step still gets `price_off_step`). All existing `vci.test.ts` tests still pass.
- [x] Backfill: the cut-off carries to older chunks. Evidence: `eod-sync.ts` keeps `cutoff` per symbol and passes it as `ctx.rejectOnOrBefore`. Tests: `eod-sync.test.ts › runEodSync adjusted history › backfill: adjusted cut-off from the newest chunk is passed as rejectOnOrBefore to older chunks`, and `› with VciPriceSource, backfill: fractional bars in the newest chunk reject the all-integer older chunk`, which uses the real adapter with a fake fetch.
- [x] Rejected bars are never written and stored rows stay unchanged; nothing is filled in. Evidence: the VCI backfill test checks `rowsUpserted` = 1 and that only `newest.to` is written. Prior rows on older dates keep `source` undefined. The gap step (`eod-sync.ts` around line 216) still uses stored dates only and was not changed.
- [x] ADR 0004 records the 2026-11-01 finding and the guard. Evidence: the "Raw vs adjusted" section is rewritten, with the TCB/AGR finding, the guard, the `ok` rule and known limits. The checklist item 3 and the UNVERIFIED list are also updated.
- [x] Tests use fixtures or a fake fetch only, and cover the three required cases. Evidence: the mixed-response fixture `chart-adjusted-mixed.json`, the integer-coincidence test, and the cross-chunk backfill test. All checks are green.

### Issues
None.

### Rules R1–R10
No violations found. The detection rule lives in `packages/core` and has unit tests (R1, R8). No money math changed. Prices still reach storage only through `normalizeDailyBar` (R2). Market rules are untouched (R5). The diff matches the plan's file list, `tcbs.ts` is unchanged, and there are no out-of-plan files (R7). R6 is suspended.

### Nits (do not block)
- `eod-sync.ts`: `newest`/`isNewest` could be replaced by the chunk index (`chunks.indexOf` or a `for…entries()` loop). It reads fine as is.
- The test in `vci.test.ts` named "fractional bar with an invalid t" asserts `adjustedCutoff` = `toDate`. A short comment explaining the fail-safe would help readers.

### Follow-ups (out of scope)
- A cut-off found in an older chunk does not apply back to newer chunks that were already accepted. This is correct as long as VCI's "adjusted only before the latest action" pattern holds. Checklist item 4 (compare against stored TCBS closes) remains the real validation.
- A wrong-unit feed with fractional values now reports `adjusted_price_history` instead of `invalid_*`. This is documented in the ADR, and the newest-window rule still fails the run. Consider a dedicated unit-sanity log if this ever confuses diagnostics.

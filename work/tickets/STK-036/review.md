Verdict: PASS
## Attempt 1 — 2026-10-30

### Checks (run by reviewer)
- typecheck: pass — core, db, web, worker (`pnpm typecheck`, 4 workspaces)
- lint: pass — all 4 workspaces (`pnpm lint`)
- test: pass — core 389/389 (33 files), db 106 passed + 1 todo, worker 78/78, web 176/176. Matches impl-log.md.

### Acceptance criteria
- [x] AC1 pure core guard returning `corporate_action_in_window` / `price_jump_beyond_limit` — evidence: `packages/core/src/signals/raw-price-guard.ts` `checkRawPriceWindow` (no I/O, no clock; inputs are the close window, exchange, `priceLimitPpm`, actions, holidays). Tests in `raw-price-guard.test.ts` › "stock dividend strictly inside triggers and cites its id", "exDate == first bar does not trigger; == last bar triggers", "HOSE exactly +7% does not trigger; one tick more triggers". Rights issues can't be stored yet (plan A3); the `type !== 'cash_dividend'` predicate covers them once they can.
- [x] AC2 limits from config, null exchange → widest + flagged — evidence: grepping `raw-price-guard.ts` for the limit literals and exchange names finds nothing. `resolveLimitPpm` uses `Math.max(...EXCHANGES.map(...))`. Tests "null exchange: +12% passes, +16% triggers, widest limit used and flagged" and "null exchange follows a changed config max" (HNX 200,000 → limitPpmUsed 200,000). Worker reads `getMarketRules()` (`apps/worker/src/jobs/medium-signals.ts`) and "symbol absent from getSymbolExchanges -> guard.exchangeUnknown true".
- [x] AC3 MA rules call the guard and store a suppressed row; reasons added with defined order — evidence: `moving-average.ts` pushes the guard reasons before the value gate. `types.ts` `RULE_REASONS` ends with `'value_out_of_range', 'corporate_action_in_window', 'price_jump_beyond_limit'`, and `REASON_ORDER` derives from it. Tests: moving-average.test › "stock dividend inside window -> suppressed …, dataFresh true", "jump beyond the limit inside window -> suppressed price_jump_beyond_limit"; evaluate.test › per-symbol routing; medium-signals.test › "stock dividend within the MA50 window -> row suppressed with reason, data_fresh true" (stored row and `suppressedByReason`).
- [x] AC4 unit tests (corporate action in window, limit + one tick, null exchange, exact-limit day passes) — evidence: raw-price-guard.test › the ±7% exact/one-tick tests, the snapped ceiling 25,400→27,150/27,200 test, the null-exchange tests and the corporate-action tests. All pass.
- [x] AC5 typecheck, lint and test pass — evidence: reviewer run above.

### Issues
None.

### Rules R1–R10
No violations found.
- R1: all the logic is in `packages/core`. The worker and db changes only orchestrate and filter.
- R2: integer and BigInt comparison in `isBeyondDailyLimit`. `movePpm` comes from `mulDiv` and is only recorded.
- R5: no literals (see AC2).
- R7: every changed file is in the plan's file list. The only other diff is `work/` bookkeeping.
- R8: the new core logic is fully tested.
- Fail-safe: errors reading corporate actions, exchanges or market rules propagate before any upsert (tested).
- R6 is suspended and not applicable. R3, R4, R9 and R10 are not affected.

### Nits (do not block)
- `moving-average.test.ts`: the plan's "price_gap → guard not run" case is not asserted directly (`inputs.guard` null). It holds by construction, because `checkPriceWindow` returns an empty window on `price_gap`.
- The test "prevClose <= 0 is skipped; an off-tick prevClose does not throw" uses 25,433 → 27,200 (+6.95%). That is inside the limit, so it only proves the code doesn't throw, not how an off-tick value beyond the limit behaves. That is fine for the stated purpose.
- The guard runs when the window has a recorded gap (`price_gap_recorded`) but no missing dates. Its reasons are added next to the gap reason. This matches the plan ("report all reasons").

### Follow-ups (out of scope)
- Plan follow-ups (a)–(g) as listed in plan.md.

## Attempt 1 — 2026-10-31

### Files touched
| File | Required because |
|---|---|
| packages/core/src/signals/types.ts | `parseMaRuleId`, `isReasonCode`, `StoredSignal` (plan 1) |
| packages/core/src/signals/visibility.ts (new) | `expectedRuleIds`, `parseSignalSnapshot`, `signalVisibility`: AC2 in core |
| packages/core/src/signals/visibility.test.ts (new) | AC2, R8 |
| packages/core/src/signals/labels-vi.ts (new) | Exhaustive Vietnamese label maps: AC1, AC3 |
| packages/core/src/signals/labels-vi.test.ts (new) | Exhaustiveness, fallback, banned-word scan |
| packages/core/src/signals/present.ts (new) | `presentMediumSignals` view model (R1) |
| packages/core/src/signals/present.test.ts (new) | AC1-AC3 |
| packages/core/src/market/quarters.ts | `FINANCIALS_GAP_TYPE` moved into core |
| packages/core/src/index.ts | Public exports |
| apps/worker/src/jobs/financials-sync.ts | Imports and re-exports `FINANCIALS_GAP_TYPE` (one definition) |
| packages/db/src/rows.ts | `SignalRow` |
| packages/db/src/mappers.ts | `signalFromRow` |
| packages/db/src/repos/signals.ts | `listLatestSignals` |
| packages/db/src/repos/signals.test.ts | Tests for the read and mapper |
| packages/db/src/index.ts | Export `listLatestSignals` |
| apps/web/server/symbols/load-symbol.ts | Reads rules, both gap types and signals; adds `signals` to `SymbolView` |
| apps/web/server/symbols/load-symbol.test.ts | Mocks for the new reads and wiring tests |
| apps/web/components/symbol/signals-section.tsx (new) | Presentational section |
| apps/web/components/symbol/signals-section.test.tsx (new) | Render tests |
| apps/web/app/(app)/symbols/[symbol]/page.tsx | Renders the section between chart and grid |

### Tests added / changed
- core `visibility.test.ts` (expectedRuleIds, staleness incl. cutoff and holiday, price and financials gap windows, rule version, malformed snapshots, provenance, precedence, cause order), `labels-vi.test.ts` (exhaustiveness, fallback, ruleName, parseMaRuleId, tokenised banned-word scan), `present.test.ts` (value texts, inputs, window line, gap/corporate-action refs, suppressed, hidden, empty, no_signal, order, summary).
- db `signals.test.ts` › `listLatestSignals` (query shape, omitted rules, empty ids, string bigint, mapping errors, passthrough snapshot, DB error).
- web `load-symbol.test.ts` › `loadSymbol signals` (wiring, empty, list, outdated, financials gap, shared price gap reads); `signals-section.test.tsx` (ok, hidden, suppressed, empty, disclaimer in every state, no action words, no table).

### Checks (actual output summary)
- typecheck: green in core, db, web, worker.
- lint: green in core, db, web, worker.
- test: core 474 passed, db 117 passed (1 todo), worker 94 passed, web 214 passed (includes no-calc-in-ui and no-hardcoded-rules).

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Plan follow-ups stand: peer-gap check (D4), ratio and median display (D9), corporate-action ref provenance (D3), softer "waiting" wording (D1).
- `SignalRowVM` variants carry an extra `ruleId` (React key); not in the plan's field list.

### Scope self-check
- Could the diff be smaller? No; product code is about 600 lines (core ~490 incl. types, db ~75, web ~190), under the 750 stop line.
- Diff size: not measured (workspace is not a git repository here); new files listed above.

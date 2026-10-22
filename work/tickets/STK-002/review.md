## Attempt 1 — 2026-10-22
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: pass (`pnpm typecheck`: packages/core, apps/web, apps/worker all Done)
- lint: pass (`pnpm lint`: eslint clean in all 3 projects)
- test: pass (`pnpm test`: 5 files, 33 tests passed). Matches impl-log.md.

Reviewer hand-computed scenarios (scratch tests run against the branch source, not committed). All matched except the overflow case:
- Two buys (1000@20,000 and 500@23,000, fee 0.15%), cash dividend 1,000/share on exDate 03-09 (net 1,425,000 after 5% WHT), sell 600@25,000 on 03-10. Expected costRemoved 12,048,900, proceedsNet 14,962,500, realized 2,913,600, remaining totalCost 18,073,350, avg 20,082. **Matched.**
- reduceCost vs income on the same multi-sell ledger: realized + unrealized are identical (7,500,875 both). **Matched.**
- Sell of 150 with 100 sellable and 100 pending → OVERSELL `sellable: 100`. A sell of exactly 100 consumes the sellable lot and leaves the pending lot (sellableQuantity 0). **Matched.**
- Stock dividend 100:20, then a full exit of 1,200@18,000 → realized 1,600,000, totalCost 0. **Matched.**
- Full exit, dividend while flat (no effect), then a re-buy → fresh avg 12,000 and no leftover cost. **Matched.**
- Accumulator overflow → **silently wrong**, see Issue 1.

### Acceptance criteria
- [x] Lots with `sellableFrom` and `pending`/`sellable` status as of a date, from transactions + settings: `build-ledger.test.ts` › "T+2 pending lot", "T+2 across weekend and holiday", "missing fee/tax filled from settings"; `build-ledger.ts:115,135,227`.
- [x] Holdings show quantity, sellable quantity, average cost and realized P&L, plus unrealized P&L from a price map: "single buy then sell", "multiple lots with partial sell"; `valuation.test.ts` (both tests); reviewer's hand-computed case.
- [x] Sell method is documented: JSDoc at `build-ledger.ts:245-262` (WAC cost, FIFO quantity from sellable lots); Flag 1 in plan.md. Tests: "multiple lots with partial sell" (lots `[400, 500]`), "selling entire position removes all cost".
- [x] Cash and stock dividends work as documented: the cash-dividend tests (reduceCost, income, pending entitlement, clamp) and the stock-dividend tests (zero-cost lot, fractional, listingDate and fallback).
- [x] Oversell returns a typed error: the "oversell" tests (all 3) assert `{ code: 'OVERSELL', … }`.
- [ ] All money is integer VND, rounding is defined once. Rounding is defined once (`money.ts:22`; grep finds no `Math.round`/`toFixed`/float rates in `packages/core/src`). **But** the plan promises that "Exported number values are always checked with Number.isSafeInteger", and the test "overflow-sized values stay exact or are rejected, never silently wrong" claims the same. Both are false for accumulated sums. See Issue 1.
- [x] Unit tests cover every required scenario (see above).

### Issues
#### Issue 1 — 🔴 blocker — integer-VND safety (R2, plan Approach §1)
- **Where**: `packages/core/src/ledger/build-ledger.ts:125` (`value + fee`), `:137-138` (`state.quantity +=`, `state.totalCost +=`), `:143` (sellable reduce), `:161` (`value - fee - tax`), `:172-174`, `:191-197` (dividend accumulators), `:200-202,215` (`Number(newShares)` and `quantity +=`), `:237` (`Number(roundDiv(...))`).
- **Expected**: every number the ledger produces is a safe integer. Otherwise `buildLedger` returns `{ ok: false, error: { code: 'INVALID_INPUT', … } }`. This is what the plan promises and what the existing overflow test claims.
- **Actual**: these sums use plain `number` arithmetic with no check. Repro: two buys of symbol X, `quantity 1, price Number.MAX_SAFE_INTEGER, fee 0` and `quantity 1, price 2, fee 0`, asOf 2026-03-04. The result is `ok: true` with `totalCost 9007199254740992`. The exact value is 9007199254740993, and `Number.isSafeInteger` is false. The existing overflow test passes only because its single `qty·price` goes through `mulDiv`.
- **Fix instruction**: add a checked helper to `money.ts`, e.g. `addVnd(...xs: number[]): number`. It should sum via BigInt and throw `RangeError` through `toSafe`. A `subVnd` is optional; it can be `addVnd(a, -b)`. Use it for every accumulation and subtraction listed above. Also pass `Number(newShares)` and the average-cost `Number(roundDiv(...))` through `toSafe` (export it or wrap it). The existing `buildLedger` try/catch already converts the `RangeError` into `INVALID_INPUT`. Add a test in `build-ledger.test.ts` with the repro above (two buys whose sum exceeds MAX_SAFE_INTEGER) and assert `ok: false`. Add a unit test for `addVnd` in `money.test.ts`.

#### Issue 2 — 🟡 should-fix — settings enums not validated
- **Where**: `packages/core/src/ledger/build-ledger.ts:43-53` (validate), `:192` (`=== 'reduceCost' ? … : income`).
- **Expected**: an unknown `cashDividendTreatment` or `costMethod` is rejected with INVALID_INPUT. Settings will later come from DB or user config, where TypeScript types give no protection.
- **Actual**: `cashDividendTreatment: 'foo'` is silently treated as `income`. The reviewer's repro gave realizedPnl 47,500 and ok: true.
- **Fix instruction**: in `validate`, return `bad('settings', 'cashDividendTreatment', …)` unless the value is `'reduceCost'` or `'income'`. Return `bad('settings', 'costMethod', …)` unless it is `'WAC'`. Add one test.

#### Issue 3 — 🟡 should-fix — duplicate ids produce duplicate lot ids
- **Where**: `packages/core/src/ledger/build-ledger.ts:54-82, 127, 205`.
- **Expected**: transaction ids and corporate-action ids are unique across both inputs, because lot ids `lot:<id>` must be unique keys for the future `lots` table. A duplicate returns INVALID_INPUT.
- **Actual**: two transactions with id `x` give `ok: true` with two lots both `lot:x`.
- **Fix instruction**: in `validate`, keep a `Set` of the ids seen across transactions and actions. On a repeat, return `bad(id, 'id', 'duplicate')`. Add one test.

### Rules R1–R10
No violations found apart from Issue 1 (R2 exactness). R1: all logic is in `packages/core`. R5: settlement days, tax, fee, withholding, holidays and dividend treatment are all settings (`settings.ts:5-12`). R7: changed files match the plan's file list; the workflow files (backlog, ticket, consult, plan, impl-log) are expected. R3, R4, R6, R9 and R10 are not touched.

### Nits (do not block)
- `build-ledger.test.ts:161`: the second assertion is effectively a tautology. Assert `v.lots[0].status === 'pending'` instead.
- `valuation.test.ts:9`: the fixture uses `totalCost / quantity` (a float) for `averageCost`. This is harmless but sets a bad example. Use an integer.
- `build-ledger.ts:273`: the caught RangeError is always reported as `field: 'amount'`. Consider passing the field through.
- `valuation.ts:300`: accepts a negative market price.
- Validation does not check that `listingDate` is on or after `exDate`.

### Follow-ups (out of scope)
- Rights issue; deferred 5% PIT on bonus shares (already listed in the plan).
- Reconcile Flags 1–3 (WAC, cash-dividend treatment, rounding) against a real TCBS statement.
- Exchange holiday calendar data source.

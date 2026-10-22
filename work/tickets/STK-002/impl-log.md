
## Attempt 1 — 2026-10-22

### Files touched
| File | Required because |
|---|---|
| packages/core/src/money.ts | single rounding rule, BigInt mulDiv, ppm rates (AC6) |
| packages/core/src/money.test.ts | tests for rounding |
| packages/core/src/calendar.ts | trading-day arithmetic for T+2 (AC1) |
| packages/core/src/calendar.test.ts | calendar tests |
| packages/core/src/ledger/types.ts | public types |
| packages/core/src/ledger/settings.ts | default market settings, estimateFees |
| packages/core/src/ledger/build-ledger.ts | replay into lots, holdings, realizations, typed errors (AC1-5) |
| packages/core/src/ledger/build-ledger.test.ts | scenario tests |
| packages/core/src/ledger/valuation.ts | unrealized P&L from price map |
| packages/core/src/ledger/valuation.test.ts | valuation tests |
| packages/core/src/index.ts | re-export public API (describeCore kept) |

### Tests added / changed
- money.test.ts: roundDiv half-up, applyRatePpm, mulDiv beyond 2^53, assertVnd
- calendar.test.ts: addTradingDays weekdays, holiday, malformed date
- build-ledger.test.ts: single buy/sell; multiple lots partial sell; entire position removes all cost; T+2 pending; weekend and holiday; fee/tax from settings and overrides; events after asOf; cash dividend (reduceCost, income, pending lot entitlement, clamp); stock dividend (zero-cost lot, fractional, listingDate and fallback); oversell (plain, T+1, same-day); non-integer money; overflow rejected; same-date ordering; no input mutation
- valuation.test.ts: unrealized P&L; missing price gives null

### Checks (actual output summary)
- typecheck: pass (core, web, worker)
- lint: pass
- test: 5 files, 33 tests passed
- build: pass (apps/web)

### Out-of-plan files
None. One deviation within plan files: `buildLedger` wraps an internal `replay` and converts RangeError (overflow) to an INVALID_INPUT result (id 'ledger').

### Follow-ups (noticed, not done)
- Rights issue support; deferred 5% PIT on bonus shares at sale
- Holiday calendar data source; DB schema notes from the database consult
- Reconcile with a real TCBS statement (cost method, dividend treatment, rounding)

### Scope self-check
- Could the diff be smaller? No; tests are most of it.
- Diff size: 11 files, about +900 / -0 lines (index.ts modified)

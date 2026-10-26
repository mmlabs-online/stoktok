## Attempt 1 — 2026-10-26 (slice 1: AC1, AC3, AC5, AC6)

### Files touched
| File | Required because |
|---|---|
| apps/web/server/symbols/load-symbol.ts | New loader: reads stored data, delegates to core (AC1, 3, 5, 6) |
| apps/web/server/symbols/load-symbol.test.ts | Loader tests (R8) |
| apps/web/app/(app)/symbols/[symbol]/page.tsx | Calls loader, null -> notFound(), renders sections, force-dynamic |
| apps/web/components/symbol/symbol-header.tsx | AC1 header |
| apps/web/components/symbol/position-card.tsx | AC3 position card |
| apps/web/components/symbol/lots-table.tsx | AC3 lots table |
| apps/web/components/symbol/symbol-detail.test.tsx | Component tests |
| apps/web/components/watchlist/price-board.tsx | `export` on LimitValue, Close, Status only |
| apps/web/components/portfolio/holdings-table.tsx | `export` on Price, Pnl only |

### Tests added / changed
- load-symbol.test.ts: unknown -> null; five single-source known cases; header/limits; ex-date; stale; UPCOM refEstimated; position equals core; lots + T+2 pending; partial sell/multiple lots; stock dividend; cash dividend; closed; none; no price; ledgerError; transactions (symbol only, newest first, capped, ledgerHref).
- symbol-detail.test.tsx: header (tones, Phiên, source), stale/ex-date/UPCoM note, position card (labels, note, stale badge), closed, ledger error, none, lots table, transaction list link.

### Checks (actual output summary)
- typecheck: green (all workspaces)
- lint: green (all workspaces)
- test: core 347 passed, db 100 passed (1 todo), worker 65 passed, web 176 passed (20 files)
- build: green (`/symbols/[symbol]` is dynamic)

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- The plan's "transactions section links to /transactions?symbol=FPT" component test is not a component test: the link is inline in page.tsx; the href is pinned in the loader test (`ledgerHref`). The component test only checks the TransactionList symbol link.
- Threshold for the single-holding portfolio uses `resolveConcentrationThreshold(null)` (weights are ignored; avoids an extra DB read and the R5 scan on the default constant).
- Plan follow-ups (UPCoM average-price reference, special price limits, ex-dates of watched symbols, watch toggle) still open.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +640 / -4 lines including tests.

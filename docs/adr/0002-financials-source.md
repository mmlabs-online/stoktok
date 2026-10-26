# ADR 0002: Quarterly financials source

Status: accepted (Ming, 2026-10-25)

## Context
Spec §3 F4 (medium-term signals) needs quarterly EPS, BVPS, revenue and net income plus a sector label. Spec §9 Q4 asks for a source after a license/terms check. The `FinancialsSource` interface (spec §4.3) keeps the source swappable.

## Decision
Source: the TCBS public API, source id `tcbs-public`, the same host and posture as ADR 0001. **Risk accepted by Ming, 2026-10-25**: the endpoint is unofficial and unlicensed for automated use and may change or block without notice. No terms page was read on 2026-10-26 because the sandbox cannot reach Vietnamese hosts.

## Constraints
- About 3 requests per symbol per day (ratio, income statement, overview), sequential, 1 s delay between requests, 15 s timeout.
- Honest User-Agent (`stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)`); no header spoofing.
- Retries only on network errors, 429 and 5xx, with backoff; the run stops after 5 consecutive failing symbols.
- Read-only public data (R10).

## Units and rounding (R2)
| Field | Source field | Unit assumed | Stored |
|---|---|---|---|
| EPS | `earningPerShare` | VND per share | integer VND |
| BVPS | `bookValuePerShare` | VND per share | integer VND |
| Revenue | `revenue` | billions of VND | integer VND (x 1e9) |
| Net income | `shareHolderIncome` (attributable to parent) | billions of VND | integer VND (x 1e9) |

Conversion is `toVndAmount` in `packages/core/src/market/financials.ts`: rounded half away from zero to integer VND. Billions x 1e9 may differ from the published figure by a few VND because of float precision (accepted). Constants are in `TCBS_FINANCIALS_UNITS`; plausibility bounds in `DEFAULT_FINANCIALS_SANITY` reject a period instead of storing a wrong-unit value.

## Policies
- **Partial quarter:** all four values must be valid or the whole period is rejected and recorded as a gap. No value is derived from another (no `postTaxProfit` fallback) and nothing is filled with zero. A quarter with only one missing metric (for example a bank layout) is therefore not stored.
- **Missing quarters:** recorded in `data_gaps` (`data_type 'financials'`, Vietnam-time quarter bounds) between the symbol's first known quarter and the latest expected quarter (last day + 45 days). Resolved when the quarter arrives; never filled; never deleted.
- **Overwrite:** a re-sync overwrites stored values and `fetched_at`. Restatements are logged and listed in the run summary. No history table.
- **No-data symbols (ETFs, fund certificates):** an empty or 404 response is reported in `symbolsWithoutData`, with no gaps and no failure.
- **Sector:** the TCBS `industry` label as published (stored on `symbols` with `sector_source` and `sector_fetched_at`). A missing label never wipes a known sector.

## UNVERIFIED items (check on the first `--dry-run`)
- The paths and parameters (`/tcanalysis/v1/finance/{symbol}/financialratio|incomestatement?yearly=0&isAll=true`, `/tcanalysis/v1/ticker/{symbol}/overview`).
- The field names (`year`, `quarter`, `earningPerShare`, `bookValuePerShare`, `revenue`, `shareHolderIncome`, `industry`).
- The units (see table above).
- **The EPS basis: quarterly vs trailing-twelve-month** (recalled values look TTM-like), basic vs diluted, consolidated vs parent.
- `shareHolderIncome` vs `postTaxProfit` as net income.
- The response order and shape (a top-level array).
- Bank and securities-firm revenue fields.
- The language of the `industry` label.
- What TCBS returns for ETFs (404 vs `[]`).
- Throttling.

**STK-015 must read the recorded EPS basis once it is verified and must not assume one.**

## P/E vs sector caveat
Sector comparisons use only the symbols Ming tracks. With a small watchlist a sector may have one or two peers, so "P/E vs sector" is weak evidence there.

## Swapping the source
Implement `FinancialsSource` (`apps/worker/src/sources/financials-source.ts`), declare its units in one constant, and construct it in `apps/worker/src/cli.ts`. `runFinancialsSync` does not change.

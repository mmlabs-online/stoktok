# STK-014: Quarterly financials adapter

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P2 |
| Areas | data, db |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
The worker stores quarterly EPS, BVPS, revenue and net income plus a sector for each watchlist symbol from a swappable data source, so medium-term valuation signals have inputs.

## Spec reference
docs/spec-v1.md §3 F4 (medium-term data), §4.3 Data source adapters, §4.4 Financials sync, §5 `financials`, §9 Q4. CLAUDE.md R2, R4.

## Acceptance criteria
- [ ] A `FinancialsSource` interface with one implementation returning per-quarter EPS, BVPS, revenue and net income; adding a source needs no caller changes.
- [ ] Migration adds `financials` (symbol, period, eps, bvps, revenue, net_income, source, fetched_at) and a symbol→sector mapping; RLS on with no anon/authenticated policies; money in integer VND (R2).
- [ ] Worker job (daily check) upserts idempotently with `source` and `fetched_at` (R4); missing periods are recorded, not filled.
- [ ] Unit tests use recorded fixtures only, no live network.
- [ ] Job runnable once via a documented `pnpm` script.

## Notes / answers from Ming
- **Answer to §9 Q4 for financials (Ming, 2026-10-25):** use the **TCBS public API** (unofficial, no registration), same posture as STK-005: risk accepted, low request volume, honest User-Agent, keep the `FinancialsSource` interface swappable, record it in an ADR. The sandbox cannot reach Vietnamese hosts, so fixtures will be synthetic and labelled; units must be guarded.
- Depends on: STK-003 (schema), STK-005 (adapter pattern).
- **Input needed (⛔ blocking):** data source after a license/terms check for personal use (spec §9 Q4). Planner: propose a source with the license finding, or return BLOCKED.

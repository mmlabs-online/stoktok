# STK-038: VietCap (VCI) public endpoint as end-of-day price source

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P1 |
| Areas | data, architecture |
| Attempts | 0 |
| Created | 2026-11-01 |
| PR | — |

## Goal
Add a VietCap (VCI) public-endpoint implementation of `PriceSource` and make it the primary end-of-day price source, because the TCBS public endpoint now sits behind a Cloudflare bot challenge and every request fails (HTTP 403/404, 2026-11-01).

## Spec reference
docs/spec-v1.md §2.2 (data constraints: public sources are unofficial, check terms), §4.3 (data source adapters: swappable, primary + fallback), §9 Risks ("Unofficial data source breaks") and Open question 4. CLAUDE.md R2, R4, R5. ADR 0001 (EOD price source), STK-005, STK-032.

## Acceptance criteria
- [ ] A new `PriceSource` for the VietCap public endpoint returns daily OHLCV through the existing normalization and plausibility guards; every stored row carries `source` (new id, e.g. `vci-public`) and `fetched_at` (R4).
- [ ] The active price source is selected by configuration, not hard-coded (R5). TCBS stays available as an alternative source; no fallback chaining logic beyond what §4.3 requires is added.
- [ ] The adapter is a polite, low-volume client: honest User-Agent, existing delays/retries/circuit breaker; no bot-check circumvention (no browser impersonation, no challenge solving).
- [ ] `pnpm worker:eod`, `--dry-run` and `--backfill` work unchanged with the new source (same idempotency, delays, retries, circuit breaker, request cap).
- [ ] Price unit, date encoding, raw vs adjusted prices and known terms of the VCI endpoint are documented in a new ADR (amending ADR 0001); wrong units are rejected by the existing guards, not stored.
- [ ] Tests use fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass.

## Notes / answers from Ming
- Split from "Thay nguồn giá EOD và financials (SSI FastConnect)" (Ming, 2026-11-01): prices here, financials in STK-039. Priority P1.
- **Source changed to VietCap (Ming, 2026-11-01).** SSI FastConnect was dropped: it needs an SSI brokerage account and in-person registration, and Ming only wants price data. TCBS iFlash Open API was considered but needs checking (keys may carry trading rights; token exchange may need OTP). The SSI consults and plan are kept as `*-ssi-superseded.md` for reference.
- Risk accepted by Ming, as with TCBS: the VCI endpoint is unofficial and may change or block without notice. The source-selection seam keeps the next swap to one adapter.
- Plan gate: P1, so workspace CLAUDE.md §8 requires Ming's PLAN approval before IMPLEMENT.
- **Plan approved (Ming, 2026-11-01).** Future P1/High tickets: workspace §8 gate applies (stop after PLAN for approval); project CLAUDE.md to be aligned separately.

# STK-038: SSI FastConnect Data adapter for end-of-day prices

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P1 |
| Areas | data, architecture, security |
| Attempts | 0 |
| Created | 2026-11-01 |
| PR | — |

## Goal
Add an SSI FastConnect Data implementation of `PriceSource` and make it the primary end-of-day price source, because the TCBS public endpoint now sits behind a Cloudflare bot challenge and every request fails (HTTP 403/404, 2026-11-01).

## Spec reference
docs/spec-v1.md §2.2 (data constraints), §4.3 (data source adapters: swappable, primary + fallback), §9 Risks ("Unofficial data source breaks") and Open question 4. CLAUDE.md R2, R3, R4, R5. ADR 0001 (EOD price source), STK-005, STK-032.

## Acceptance criteria
- [ ] A new `PriceSource` for SSI FastConnect Data returns daily OHLCV through the existing normalization and plausibility guards; every stored row carries `source` (new id, e.g. `ssi-fastconnect`) and `fetched_at` (R4).
- [ ] The active price source is selected by configuration, not hard-coded (R5). TCBS stays available as an alternative source; no fallback chaining logic beyond what §4.3 requires is added.
- [ ] SSI credentials are read from env by name only, server/worker-side only (R3); names are added to `.env.example` with no values. No credential appears in code, tests, logs or fixtures.
- [ ] `pnpm worker:eod`, `--dry-run` and `--backfill` work unchanged with the new source (same idempotency, delays, retries, circuit breaker, request cap).
- [ ] Price unit and date encoding of the SSI response are documented in a new or updated ADR; wrong units are rejected by the existing guards, not stored.
- [ ] Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass.

## Notes / answers from Ming
- Split from "Thay nguồn giá EOD và financials (SSI FastConnect)" (Ming, 2026-11-01): prices here, financials in STK-039. Priority P1.
- **Human step:** Ming registers for SSI FastConnect Data and stores the consumer ID/secret in Bitwarden (`agent` collection) and `apps/worker/.env.local`. Agents never handle the values. The live first run (`--dry-run`) needs this.
- Check SSI FastConnect terms for personal automated use and its rate limits; record them in the ADR.
- **Plan gate (orchestrator, 2026-11-01):** plan.md is READY. The ticket is P1 and touches secrets handling (High tier), so workspace CLAUDE.md §8 requires Ming's PLAN approval, while the project CLAUDE.md says there is no PLAN→IMPLEMENT gate. Paused for Ming's approval before IMPLEMENT.

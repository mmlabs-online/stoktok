# STK-042: Financials for banks, securities firms and insurers (VietCap IQ)

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P2 |
| Areas | data, finance |
| Attempts | 1 |
| Created | 2026-11-01 |
| PR | — |

## Goal
Extend the `vci-iq` financials source to companies whose `comTypeCode` is not `CT` (banks `NH`, securities firms `CK`, insurers `BH`), which STK-039 rejects as `unsupported_company_type`. Today 7 of Ming's 11 watched symbols (SHB, TCB, TPB, VCB; AGR, BSI, VND) fall in this group.

## Spec reference
docs/spec-v1.md §2.2, §3 F4, §4.3. CLAUDE.md R1, R2, R4, R5. ADR 0002, ADR 0005, STK-039.

## Acceptance criteria
- [ ] The revenue line and parent net income line per company type are chosen from the recorded `metrics` dictionary and live samples (one bank, one broker, one insurer), and recorded per `comTypeCode` in one constant and in ADR 0005.
- [ ] EPS and BVPS for these types use the STK-039 derivation in `packages/core`, with unit tests for each type's field mapping.
- [ ] A dry-run cross-check shows derived EPS and BVPS within ±3% of VietCap's own figures (market cap ÷ P/E, market cap ÷ P/B) on at least one symbol per type.
- [ ] A type still not covered stays rejected as `unsupported_company_type`.
- [ ] Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass.

## Notes / answers from Ming
- Follow-up from STK-039 decision 5 (Ming, 2026-11-01).
- **Q1 answer (Ming, 2026-11-04):** Option A — Ming runs the recording script from plan.md Q1 on his machine and commits the samples to `work/tickets/STK-042/live-samples/`.
- **Samples recorded (Ming, 2026-11-04T03:45Z, commit f17643d):** VCB, TCB (`NH`), VND (`CK`), BMI (`BH`) — 20 files, all valid JSON, `comTypeCode` confirmed from `details`.
- **Q2 answer (default, 2026-11-04):** BMI is used only as the insurer sample; it is not added to the watchlist.
- Q3–Q5: planner defaults stand.

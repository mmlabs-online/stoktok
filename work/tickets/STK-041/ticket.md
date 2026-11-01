# STK-041: Financials run health: count only in-window rejects, skip unsupported company types

| Field | Value |
|---|---|
| State | DONE |
| Priority | P1 |
| Areas | data |
| Attempts | 1 |
| Created | 2026-11-01 |
| PR | — |

## Goal
Make `pnpm worker:financials` report `ok: true` when the only problems are expected ones. Today the first live dry-run with `vci-iq` (2026-11-01) ended `ok: false` / exit 1 for three reasons. 7 of 11 symbols are banks or brokers and are rejected as `unsupported_company_type`. The source emits 16 quarters while the job window is 12 (2023Q3..2026Q2), so rejects outside the window still count. And the newest quarter is rejected as `missing_shares` while VietCap's ratio endpoint lags the statements (GAS 2026Q3).

## Spec reference
docs/spec-v1.md §4.3 (gaps recorded, stale data never produces a signal). CLAUDE.md R4, R5. ADR 0002, ADR 0005, STK-039.

## Acceptance criteria
- [ ] A rejected period outside the job window (`windowStart..windowEnd`) does not make `ok` false. It is still listed in the summary, separately from in-window rejects.
- [ ] `unsupported_company_type` does not make `ok` false. Affected symbols are listed under their own summary key (e.g. `unsupportedSymbols`), and their in-window quarters stay recorded as gaps (R4), so no signal is produced from them.
- [ ] Any other in-window reject (`missing_shares`, `missing_eps`, unit or validation failures) still makes `ok` false.
- [ ] The rule for which reject reasons are non-failing lives in configuration or one constant (R5), and ADR 0005 records it.
- [ ] Unit tests cover each case above with the existing in-memory store and fixtures; `typecheck`, `lint`, `test` pass.
- [ ] Replaying the 2026-11-01 dry-run shape (11 symbols, recorded fixtures) gives `ok: true`.

## Notes / answers from Ming
- Evidence: Ming's live `pnpm worker:financials --dry-run`, 2026-11-01T11:28Z: `periodsFetched` 44, `rejected` 116 (AGR, BSI, SHB, TCB, TPB, VCB, VND × 16 `unsupported_company_type`; BCG 2021Q2/2021Q4/2022Q1 `missing_shares`; GAS 2026Q3 `missing_shares`).
- BCG's newest quarter on VietCap is 2024Q4, so its 16-quarter range reaches back to 2021. With window-relative counting, those rejects fall outside the window. BCG also has no price bars (possible delisting); Ming to check.
- Ming, 2026-11-01: "tự quyết định làm tiếp" (decide and continue). The orchestrator treats this as approval to continue past PLAN for this P1 ticket; merge stays with Ming.
- Consult open questions: all defaults accepted under the delegation above (orchestrator, 2026-11-01). "8 of 11" was a miscount; it is 7 (AGR, BSI, SHB, TCB, TPB, VCB, VND).

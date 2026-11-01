## Attempt 1 — 2026-11-01

### Files touched
| File | Required because |
|---|---|
| docs/adr/0005-vci-iq-financials-source.md (new) | AC1: comparison, decisions, derivation, units, dry-run checklist |
| docs/adr/0002-financials-source.md | one "Superseded in part by ADR 0005" status line |
| packages/core/src/market/financials-derive.ts (new) | R1/R2: TTM EPS and BVPS derivation in core |
| packages/core/src/market/financials-derive.test.ts (new) | R8 unit tests (9) |
| packages/core/src/index.ts | export `deriveVciIqQuarter` and types |
| apps/worker/src/sources/vci-iq-financials.ts (new) | `VciIqFinancialsSource`, units, source name, EPS basis, field codes |
| apps/worker/src/sources/vci-iq-financials.test.ts (new) | source tests on recorded fixtures (15) |
| apps/worker/src/sources/select-financials-source.ts (new) + test | R5: source chosen by config id |
| apps/worker/src/config.ts | `FINANCIALS_SOURCE_IDS`, `isFinancialsSourceId`, `financialsSource: 'vci-iq'`, `VCI_IQ_CONFIG` |
| apps/worker/src/config.test.ts | default id; honest UA has no browser tokens |
| apps/worker/src/cli.ts | build source via `createFinancialsSource`; `--source` for financials; `vci-iq` in `epsBasisBySource` |
| apps/worker/src/cli.test.ts | parseArgs cases for financials `--source` |
| apps/worker/test/fixtures/vci-iq/* (README + 5 JSON) | trimmed recorded HPG samples (2023 onward, needed fields only) plus a hand-written non-CT details file |

### Tests added / changed
- financials-derive.test.ts (9), vci-iq-financials.test.ts (15), select-financials-source.test.ts (1), cli.test.ts (+1 test), config.test.ts (+2).
- Plan test "financials job constructs the configured source" is covered by `select-financials-source.test.ts` plus the default-id test in `config.test.ts`; `main()` in cli.ts is not unit-testable (it opens a DB client).
- Plan value "BVPS about 17,623": exact HPG 2026 Q3 value rounds to 17,624; tests assert 17,624.
- Duplicate-period and missing-shares/bsa210 variants are built by editing fixture copies in memory (no extra files).

### Checks (actual output summary)
Node v22.23.4.
- typecheck: all 4 packages Done, no errors.
- lint: all Done, no errors or warnings.
- test: core 483 passed; db 117 passed, 1 todo; worker 146 passed (13 files); web 214 passed.

### Out-of-plan files
None. `jobs/financials-sync.ts` and `core/src/market/financials.ts` are unchanged.

### Follow-ups (noticed, not done)
- Fixture's first 3 quarters (2023Q1-Q3) are `missing_eps` by design (no 4-quarter window); in production old pre-lookback quarters will show as rejected too if the source returns more history than 12 quarters + 3; confirm in the dry-run that the job's rejected count stays acceptable (statistics rows also have gaps, e.g. HPG 2021Q2, 2022Q1 -> `missing_shares`).
- The live `--dry-run` (ADR 0005 checklist) is still to be run by Ming/orchestrator.
- `apps/worker/README.md` still describes only the TCBS financials source (not in plan).

### Scope self-check
- Could the diff be smaller? No; the sync job and core normalizer are untouched.
- Diff size: ~+330 lines product/ADR, ~+400 tests and fixtures.

## Attempt 2 (REWORK: review attempt 1, blocker)

### Files touched
- apps/worker/src/config.ts: `FINANCIALS_SYNC_CONFIG.vciIqMaxQuarters = 16` (R5; lookback 12 + 4).
- apps/worker/src/sources/vci-iq-financials.ts: `maxQuarters` option; only the latest N quarters (relative to the latest key) are derived/reported; older ones are dropped silently. Full income history still feeds `netIncomeByPeriod`.
- apps/worker/src/sources/vci-iq-financials.test.ts: `maxQuarters` in `build`; new tests (N=12 gives `rejected: []`; missing shares outside range no reject; inside range still `missing_shares`; unsupported_company_type reports only emitted range). The default-N fixture test still expects the 3 `missing_eps` because the fixture has only 15 quarters (< N+3).
- docs/adr/0005-vci-iq-financials-source.md: one line each in Derivation and Request accounting.

### Checks (Node 22.23.4)
typecheck and lint: no errors. test: core 483, db 117 (+1 todo), worker 150, web 214 passed.

### Out-of-plan files
None. `financials-sync.ts` unchanged. `apps/web/next-env.d.ts` restored.

### Follow-ups
Review nits (distinct `missing_company_type` reason, narrowing `args.source` in cli.ts) not done.

## Attempt 1 — 2026-11-01
Verdict: REWORK

### Checks (run by reviewer)
Node v22.23.4.
- typecheck: all 4 packages Done, no errors.
- lint: all 4 packages Done, no errors or warnings.
- test: core 40 files / 483 passed; db 14 files / 117 passed, 1 todo; worker 13 files / 146 passed; web 25 files / 214 passed. These numbers match impl-log.md.

### Acceptance criteria
- [x] Source chosen after a documented comparison; the choice is recorded in an ADR. Evidence: `docs/adr/0005-vci-iq-financials-source.md` has the comparison table (VietCap IQ, TCBS, SSI, KBS, VNDirect, CafeF), with columns for EPS/BVPS, revenue/NI, sector, units, EPS basis and terms. It also has decisions 1–7 dated 2026-11-01, the units table, the derivation, the header policy and the dry-run checklist. ADR 0002 has a "Superseded in part" line.
- [x] The new `FinancialsSource` feeds the existing validation, gap recording and sector rules unchanged. Evidence: `git diff main...HEAD -- apps/worker/src/jobs/financials-sync.ts packages/core/src/market/financials.ts` is empty. `vci-iq-financials.test.ts` › "passes derived raw values through normalizeQuarterlyFinancials" and › "source name is vci-iq" both pass. `source`/`fetched_at` are set by the unchanged job.
- [x] The source is selected by configuration (R5) and needs no credentials. Evidence: `config.ts` `FINANCIALS_SYNC_CONFIG.financialsSource = 'vci-iq'`. Tests `config.test.ts` › "financials source defaults to vci-iq", `select-financials-source.test.ts` and the `cli.test.ts` financials `--source` cases pass. There are no new env reads and `.env.example` is unchanged.
- [ ] `pnpm worker:financials` and `--dry-run` work with the new source. FAILED, see Issue 1.
- [x] Tests use recorded fixtures and the no-network guard only, and the checks pass. Evidence: `apps/worker/test/fixtures/vci-iq/README.md` (trimmed HPG recordings from 2026-11-01). Tests inject `fetchImpl`, and the setup is untouched.

### Issues
#### Issue 1 — 🔴 blocker — correctness (every live run exits 1)
- **Where**: `apps/worker/src/sources/vci-iq-financials.ts:130` (`keys` = every quarter in the response) and lines 151–171 (each key is derived and normalized, and its rejects are reported). This interacts with `apps/worker/src/jobs/financials-sync.ts:121-123,192`: `rejected` counts every rejected period, inside or outside the window, and `ok` requires `rejected === 0`. `cli.ts` then sets `process.exitCode = summary.ok ? 0 : 1`.
- **Expected**: For a symbol whose in-window data is complete and valid, the run reports `rejected: 0` and `ok: true`, as it did with TCBS. Periods outside the job's lookback must not make the run fail by construction.
- **Actual**:
  - The live endpoints return the full history: HPG has 35 quarters, 2018Q1–2026Q3.
  - The first 3 quarters of the series can never have a 4-quarter TTM window, so they are always rejected as `missing_eps`. The fixture test confirms this: it expects 2023Q1–Q3 `missing_eps`.
  - The recorded `HPG_statistics-financial.json` has no quarter rows for 2021Q2, 2021Q4 and 2022Q1, so those are rejected as `missing_shares`.
  - That gives HPG 6 structural rejects, all years before `windowStart`. The same happens for every symbol, so every `pnpm worker:financials` run (dry-run or not) ends with `ok: false` and exit code 1. The scheduled job would fail every day and real rejects would be lost in the noise.
- **Fix instruction** (in the source only; do not change `financials-sync.ts`):
  1. In `fetchQuarterly`, after building `keys` (and before the `unsupported_company_type` branch), keep only the most recent `N` quarters relative to the latest key: `period >= addQuarters(latestKey, -(N - 1))`. Drop older periods silently. They are neither returned nor rejected.
  2. Keep the full `income.rows` history in `netIncomeByPeriod`, so the oldest emitted quarter still has its 4-quarter window.
  3. Make `N` configuration (R5), e.g. `FINANCIALS_SYNC_CONFIG.vciIqMaxQuarters` (or a `VciIqFinancialsOptions.maxQuarters` that defaults to it). Set it to `lookbackQuarters + 4` (= 16). The margin covers a company that publishes before the `publishLagDays` deadline: then the latest key is ahead of `windowEnd`, and a window of only `lookbackQuarters` would leave `windowStart` unknown.
  4. Tests in `vci-iq-financials.test.ts`:
     - (a) With the default `N`, a fixture that has ≥ N+3 consecutive valid quarters gives `rejected: []`. Restore the 2022 quarters from the recorded samples into the fixtures, or build the variant in memory from the live samples.
     - (b) Shares missing for a quarter older than the emitted range produces no reject.
     - (c) Shares missing inside the emitted range is still rejected as `missing_shares`.
     - (d) For `unsupported_company_type`, only the emitted range is reported.
     - Update the "recorded HPG fixtures" expectation to match.
  5. Update ADR 0005 "Derivation" / "Request accounting" with one line on the emitted range.

### Rules R1–R10
No violations found.
- R1/R2: the derivation is in `packages/core/src/market/financials-derive.ts`. It uses BigInt sums and `roundDiv` (half away from zero, symmetric for negatives), and `toSafe` guards overflow.
  - The TTM window is P, P−1, P−2, P−3 via `addQuarters`, so it is consecutive across year boundaries. A missing quarter leaves EPS undefined, never a partial sum.
  - The share count is the current period's `numberOfSharesMktCap`.
  - BVPS = `bsa78 − bsa210`. A null `bsa210` counts as missing, not 0.
  - Shares must be a positive safe integer.
  - Every case has a unit test.
- R3: no credentials and no client code.
- R4: `source = 'vci-iq'`, and `fetched_at` comes from the unchanged job.
- R5: the source id, URL, UA, field codes and units are constants.
- R6: suspended, not checked.
- R7: no out-of-plan product files. The workflow files are `ticket.md`, `backlog.md`, consults and live samples.
- R8: core tests are present.
- R10: read-only public data.
- Header rule: `http.ts` (unchanged) sends only `User-Agent` + `Accept`. The test asserts the exact header keys for all 4 calls. The UA is `stoktok/0.1 (...)` with no browser tokens (`config.test.ts`). A 403 is non-retryable (1 call) and gets the "no bypass" message.

### Nits (do not block)
- `vci-iq-financials.ts:135-136`: when `details` returns 404 (null), every period is reported as `unsupported_company_type`. A distinct reason (e.g. `missing_company_type`) would be more honest in the gap log. Conservative as is.
- `cli.ts` could narrow `args.source` by job in `ParsedArgs` instead of re-checking with `isFinancialsSourceId`/`isPriceSourceId` at the call site.
- The plan's "financials job constructs the configured source" test is covered indirectly (selector + default-id tests). That is acceptable, since `main()` opens a DB client.

### Follow-ups (out of scope)
- `apps/worker/README.md` still describes only the TCBS financials source.
- Live `--dry-run` with the ADR 0005 checklist (Ming/orchestrator). It is a gate for the `'unverified'` → `'ttm'` flip, not for this merge.
- The follow-ups already listed in the ADR: EPS lower bound, `financials_source_mixed`, peers by `sector_source`, bank/broker/insurer mapping, KBS/VNDirect fallback.
- The PR is High tier (money derivation in `packages/core`), so Ming reviews it.

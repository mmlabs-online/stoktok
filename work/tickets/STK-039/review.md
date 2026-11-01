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

## Attempt 2 — 2026-11-01
Verdict: PASS

### Checks (run by reviewer)
Node v22.23.4.
- typecheck: all 4 packages Done, no errors.
- lint: all 4 packages Done, no errors or warnings.
- test: core 40 files / 483 passed; db 14 files / 117 passed, 1 todo; worker 13 files / 150 passed (+4 since attempt 1); web 25 files / 214 passed. These numbers match impl-log.md attempt 2.
- `apps/web/next-env.d.ts` did not change; the tree is clean after the checks.

### Attempt-1 blocker (Issue 1): fixed
- `vci-iq-financials.ts:133-136` sorts `allKeys`, keeps keys `>= addQuarters(latest, -(N-1))` and drops older keys before the `unsupported_company_type` branch. `netIncomeByPeriod` (line 147) is still built from all of `income.rows`, so the TTM window of the oldest emitted quarter is complete.
- `N` = `this.o.maxQuarters ?? FINANCIALS_SYNC_CONFIG.vciIqMaxQuarters` (16, `config.ts:61`), so it is configuration (R5).
- `financials-sync.ts` is unchanged (`git diff main...HEAD` is empty for it).
- **Live-sample verification (reviewer, offline)**: I ran `VciIqFinancialsSource.fetchQuarterly('HPG')` through tsx with a stub `fetchImpl` that serves the 5 files in `work/tickets/STK-039/live-samples/` (35 quarters, 2018Q1–2026Q3). No network.
  - default N (16): 16 periods, 2022Q4..2026Q3, `rejected: []`.
  - N = 12: 12 periods, 2023Q4..2026Q3, `rejected: []`.
  - N = 35 (old behaviour): 29 periods. There are 6 rejects: 2018Q1–Q3 `missing_eps`, plus 2021Q2, 2021Q4 and 2022Q1 `missing_shares`. That is exactly the attempt-1 failure, and now nothing is emitted that old.
  - So a default-config run on valid live data gives `rejected: 0`, and the job no longer ends `ok:false` by construction.
- The 16-quarter range covers the job window in both cases:
  - Normal: latest expected quarter ≤ 2026Q3, so `windowStart` ≥ 2023Q4.
  - Early publisher: the latest key is 1 quarter ahead and the emitted range still starts 3 quarters before `windowStart`.
- The ADR 0005 "Derivation" and "Request accounting" sections each have the emitted-range line.

### Acceptance criteria
- [x] Source choice and ADR: unchanged since attempt 1. Evidence as in attempt 1.
- [x] The new source feeds the existing validation, gaps and sector rules unchanged. Evidence: the job and core normalizer diffs are still empty, and the attempt-1 tests pass.
- [x] Selected by config, no credentials. Evidence: unchanged, plus `vciIqMaxQuarters` in config.
- [x] `pnpm worker:financials` / `--dry-run` work with the new source. The blocker is resolved: on the live-sample shape, a default run gives zero rejects (verification above). The new tests pass:
  - "maxQuarters keeps only the latest N quarters"
  - "missing shares for a quarter older than the emitted range -> no reject"
  - "missing shares inside the emitted range is still rejected"
  - "unsupported_company_type reports only the emitted range"
- [x] Fixtures only, no-network guard, checks green.

### Implementer's deviation (default-N fixture test)
The recorded fixture has only 15 quarters (fewer than N+3 = 19). Because of that, the default-N test still expects 2023Q1–Q3 `missing_eps`, and fix item 4(a) is covered with `maxQuarters: 12`. I judge the coverage sufficient:
- The trimming logic does not depend on N, and it is tested with an N that actually drops quarters, at both boundaries (outside the range: no reject; inside the range: still rejected).
- I verified the default value end to end against the full live sample (above).
- The only path left without a test is the `??` fallback to config when trimming actually drops quarters. That is low risk, and it is typed as `number`.
- Noted as a nit below, not a blocker.

### Scope
Attempt-2 files are `config.ts`, `vci-iq-financials.ts`, its test, ADR 0005, and the workflow files (`ticket.md`, `backlog.md`, `impl-log.md`). All of them are in the plan or are the review-mandated fix. There are no out-of-plan product files.

### Rules R1–R10
No violations.
- R1/R2: no new arithmetic outside the existing core derivation. Period comparison is lexical on the `YYYYQn` keys, which sort correctly.
- R4: `source` / `fetched_at` unchanged.
- R5: N is config.
- R6: suspended, not checked.
- R7: in scope.
- R8: green, with tests added.

### Nits (do not block)
- `vci-iq-financials.test.ts:65`: the default-N fixture test still asserts 3 `missing_eps`. A reader may take that to mean that default runs reject. Two cheaper options:
  - build an in-memory ≥19-quarter variant from `work/tickets/STK-039/live-samples/` (or extend the fixture) and assert `rejected: []` at the default N;
  - or add a comment saying the fixture is shorter than N+3 on purpose.
- The attempt-1 nits are still open: a distinct reason for a `details` 404, and narrowing `args.source` in `cli.ts`.

### Follow-ups (out of scope)
- These are unchanged from attempt 1:
  - the `apps/worker/README.md` source text;
  - the live `--dry-run` with the ADR 0005 checklist;
  - the ADR follow-ups.
- The PR is High tier (money derivation in `packages/core`), so Ming reviews it before merge.

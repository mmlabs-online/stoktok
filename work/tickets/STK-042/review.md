Verdict: PASS
## Attempt 1 — 2026-11-04

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`: clean (core, db, web, worker).
- lint: `pnpm lint`: clean.
- test: `pnpm test`: core 41 files / 498 passed; db 14 files / 117 passed + 1 todo; worker 14 files / 228 passed; web 25 files / 214 passed. This matches the impl-log exactly.

### Acceptance criteria
- [x] AC1: the revenue and parent-NI line per type come from the recorded `metrics` dictionaries and are recorded in one constant and in ADR 0005. Evidence:
  - The reviewer walked each `*_financial-statement_metrics.json` with a script. All 16 codes exist, and their `titleVi`/`titleEn` match the constant comments (`apps/worker/src/sources/vci-iq-financials.ts:45-52`) and the ADR 0005 table:
    - VCB/TCB `isb38` "Tổng thu nhập hoạt động" (L2 under ISB36, the only field with that title), `isa22` "Cổ đông của Công ty mẹ", `bsa78` "VỐN CHỦ SỞ HỮU" L1, `bsa210` "Lợi ích của cổ đông thiểu số" L1.
    - VND `isa1` "DOANH THU HOẠT ĐỘNG", `isa22` L2/ISA20, `bsa78`, `bsa210` L2/BSA78.
    - BMI `isi64` "Doanh thu thuần từ hoạt động kinh doanh bảo hiểm" L2/ISI106, `isa22`, `bsa78`, `bsa210` L2/BSA78.
  - The AC1 grep matches only `vci-iq-financials.ts:46,48,50,52`.
  - Tests pass: `<type> mapping › non-zero in every fixture quarter`, `› parent NI identity`, and `NH mapping equity › bsa78 - bsa210 equals components`.
  - Raw samples and the README (recorded 2026-11-04T03:45:31Z by Ming) are present.
- [x] AC2: EPS and BVPS use the STK-039 derivation, with per-type tests. Evidence:
  - The adapter still calls `deriveVciIqQuarter` with the resolved field set (`vci-iq-financials.ts:185-193`). There is no per-type formula.
  - `financials-derive.test.ts` has the bank-scale test (4,986 / 30,359) and the minority-0 test.
  - `vci-iq-financials.test.ts › NH (VCB)|NH (TCB)|CK (VND)|BH (BMI) mapping › derives … for 2026Q3` asserts exact integers. The reviewer recomputed them from the raw samples with exact rationals and round half away from zero, and they match: VCB 4,986/30,359; TCB 2,694/17,601; VND 1,379/14,295; BMI 1,730/20,436. Revenue and NI also match.
- [x] AC3: the ±3% cross-check holds on at least one symbol per type. Evidence:
  - `vci-iq-financials.crosscheck.test.ts` recomputes from the fixtures. TTM is the sum of the 4 `isa22` values via `toVndAmount`, and parent equity is `bsa78 − bsa210`. EPS/BVPS go through `deriveVciIqQuarter`. Vendor values are `marketCap_P / pe_P` and `marketCap_P / pb_P` from the stats row for the same period. It also asserts that the share count is stable over P−3..P.
  - `TOLERANCE = 0.03` (line 11) and `|a/vendor − 1| <= 0.03`. The tolerance is not widened, there are no skips, and no expected values are hard-coded.
  - The fixtures are value-for-value identical to the live samples. The reviewer diffed every kept row and field for the income, balance, statistics and details files of all 4 symbols: 0 differences.
  - The reviewer's independent recomputation from the raw samples gives these worst Δ values: VCB 7e-8 %, TCB 2026Q2 −0.0738 % (NI), VND ~1e-10 %, BMI ~6e-9 %. All pass. TCB 2026Q3 (bonus issue) is +0.0022 %.
- [x] AC4: an uncovered type is still rejected. Evidence: these tests pass:
  - `company type gating › 'XX'`
  - `› mapped type not in supportedCompanyTypes`
  - `› missing details / missing comTypeCode`
  - `› resolveVciIqFields` (includes the inherited-key `toString` case)
  - The retargeted STK-039 HPG tests, which now use an in-memory `XX`.
- [x] AC5: tests use recorded fixtures and the no-network guard only, and checks are green. Evidence:
  - The new fixtures are trimmed recordings, confirmed identical as above.
  - The hand-written `details-bank.json` is gone. Git shows it as renamed to `tcb-details.json` only because the files are similar; the content is the recorded TCB details.
  - Tests use the injected `fetchImpl`.

### Issues
#### Issue 1: 🟡 should-fix. ADR accuracy (stale go/no-go checklist)
- **Where**: `docs/adr/0005-vci-iq-financials-source.md:112` (First dry-run checklist, item 7)
- **Expected**: Item 7 should reflect the new gating. For example: "Watched `NH`/`CK` symbols (SHB, TCB, TPB, VCB, AGR, BSI, VND) produce periods; only a type outside `supportedCompanyTypes` shows `unsupported_company_type`."
- **Actual**: It still reads "One non-`CT` symbol shows `unsupported_company_type`". With `['CT','NH','CK','BH']`, no watched symbol will show this, so the item would fail or mislead Ming's live dry-run.
- **Fix instruction**: Reword item 7 as above. This is doc only.

#### Issue 2: 🟡 should-fix. ADR / impl-log Δ figures off by 100× for the near-zero rows
- **Where**: The ADR 0005 cross-check table (VCB, VND, BMI rows) and the same table in `impl-log.md`.
- **Expected**: VCB NI Δ ≈ +0.00000007 %; VND ≈ −0.0000000002 %; BMI NI ≈ +0.0000000002 %, equity ≈ −0.000000006 %.
- **Actual**: The tables show +0.000007 %, −0.00000002 %, +0.00000002 % and −0.0000006 %. These are ratio values with a % sign. The TCB row (−0.0738 %) is correct. No pass/fail outcome changes.
- **Fix instruction**: Either write "≈ 0.0000 %" for the four near-zero cells or correct them to the values above.

Neither issue affects code or any acceptance criterion, so neither blocks PASS. Both are listed under Follow-ups.

### Scope
- Every product file is in the plan's file list.
- `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` and `work/solo-log.md` come from a separate, logged `/solo` commit `351dded` on this branch. It is not part of the STK-042 implementation, and solo-log.md 2026-11-03 justifies it. Note: it will ride along in the STK-042 PR into `main`, so the PR description should mention it.

### Rules R1–R10
No violations found.
- R1: no new money math outside core. The cross-check float arithmetic is test-only.
- R2: integers come through `toVndAmount`/`deriveVciIqQuarter`.
- R3: not touched.
- R4: a missing or renamed code rejects every affected period with no zero-fill (tested for all 4 codes × 4 symbols). Revenue 0 is now `zero_revenue`.
- R5: `supportedCompanyTypes` is config with an override option.
- R6: suspended; no auth expected.
- R8: core changes (`zero_revenue`, bank-scale derive) have unit tests.
- R10: public endpoints only.

### Nits (do not block)
- `vci-iq-financials.test.ts:293-301` mutates the exported `Readonly` constant (adds `ZZ`, then deletes it in `finally`). It works, but an injectable field table would be cleaner.
- `vci-iq-financials.ts:196` forces `rejectZeroRevenue: true` over any caller-supplied `sanity`. This is intended per the plan, but a caller cannot opt out.
- impl-log "Out-of-plan files: None. (No git repo here …)" is inaccurate: there is a repo, and the solo commit is in the branch diff.

### Follow-ups (out of scope)
- Fix ADR 0005 dry-run checklist item 7 (Issue 1) and the Δ formatting (Issue 2).
- Everything listed in the plan and impl-log follow-ups: peer key `sectorVn` + `comTypeCode`, ROE-adjusted bank P/B, universe size, `financials_source_mixed`, `missing_company_type`, the `'ttm'` flip gate, per-type `minBasePpmOfRevenue`, and verifying `NH` on a consumer-finance or asset-manager symbol.

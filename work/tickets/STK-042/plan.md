Status: BLOCKED

# Plan — STK-042: Financials for banks, securities firms and insurers (VietCap IQ)

> **Why BLOCKED.** AC1 says the codes are chosen "from the recorded `metrics` dictionary and live samples (one bank, one broker, one insurer)". AC3 needs VietCap's own `pe`/`pb`/`marketCap` for those symbols. None of this exists in the repo:
> - The only recorded data is HPG (`CT`), in `work/tickets/STK-039/live-samples/`. Its `metrics` dictionary lists only `isa*` income titles (consult-finance F1; consult-data "Findings").
> - `details-bank.json` is hand-written and has no statement rows.
> - The sandbox cannot reach `iq.vietcap.com.vn`: `CONNECT tunnel failed, response 403` from the egress proxy (orchestrator note, consult-data-engineer.md). No bypass is allowed (ADR 0005 header policy; proxy policy).
>
> Picking `isb*`/`iss*`/`isi*` codes without samples would be guessing. The HPG rows show those columns as `0.0`, so a wrong pick fails silently (consult-finance F2). Neither AC1 nor AC3 can be met honestly without samples.
>
> Everything else in this plan is final. **Unblock condition:** the samples listed in Q1 are committed under `work/tickets/STK-042/live-samples/`, and Ming answers Q1–Q2 (Q3–Q5 have defaults). Then the orchestrator can set `Status: READY` without a new planning pass, unless an answer departs from a default. The implementer picks the exact codes using the selection rules in Approach step 2. They are a mechanical result of the samples, not a design decision.

## Spec summary
- docs/spec-v1.md §2.2: "Public sources … are **unofficial and can change or break without notice**." "Gaps must be detected, not silently interpolated."
- §3 F4, medium term: "P/E and P/B vs sector, earnings growth trend … | Daily OHLCV, quarterly financials". Also: "Signals are suppressed if the underlying data is stale or has gaps."
- §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." "Every record stores `source` and `fetched_at`."
- CLAUDE.md R1 (calculations in `packages/core`), R2 (integer VND), R4 (source/fetched_at; gaps recorded, no signal from gapped data), R5 (market rules and config are not hard-coded).
- ADR 0005 decision 6: "Banks, brokers and insurers (`comTypeCode` other than `CT`) are rejected as `unsupported_company_type` … A follow-up ticket maps their layouts." That follow-up is this ticket. Also decision 3: the EPS basis stays `'unverified'` until a separate gate passes. **STK-042 does not flip it** (consult-data rec 8).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | The revenue line and parent net income line per company type are chosen from the recorded `metrics` dictionary and live samples (one bank, one broker, one insurer), and recorded per `comTypeCode` in one constant and in ADR 0005. | The raw samples exist in `work/tickets/STK-042/live-samples/` (README lists recorded-at time and recorder). `VCI_IQ_FIELDS_BY_COMPANY_TYPE` in `vci-iq-financials.ts` is the only place the codes live; `grep -n "'isa3'\|'bsa78'" apps/worker/src` shows no other literal use. ADR 0005 has a table per type with code, `titleVi`, `titleEn` and recorded date, matching the constant. Each chosen code's `titleVi` can be found in that symbol's recorded `*_metrics.json`. Tests `vci-iq-financials.test.ts › <type> mapping › mapped revenue, parent NI and equity are non-zero in every fixture quarter` and `› parent NI equals NPAT minus minority in every fixture quarter` pass. |
| 2 | EPS and BVPS for these types use the STK-039 derivation in `packages/core`, with unit tests for each type's field mapping. | The adapter still calls `deriveVciIqQuarter` with no per-type formula. New core tests in `financials-derive.test.ts` (bank-scale, declared-no-minority) and `financials.test.ts` (`zero_revenue`) pass. Adapter tests `› NH|CK|BH mapping › derives EPS/BVPS from the recorded fixture` assert exact integer EPS and BVPS for the latest fixture quarter, computed by hand in the test comment. |
| 3 | A dry-run cross-check shows derived EPS and BVPS within ±3% of VietCap's own figures (market cap ÷ P/E, market cap ÷ P/B) on at least one symbol per type. | Test `vci-iq-financials.crosscheck.test.ts › <SYM> › TTM parent NI within 3% of marketCap/pe` and `› parent equity within 3% of marketCap/pb`, plus the per-share forms, for each supported non-CT type. They run offline on the recorded fixtures. ADR 0005 and `impl-log.md` give a table: symbol, period P, derived, vendor, delta %, `pe`/`pb` precision. A type that fails is **not** in `supportedCompanyTypes`, and the failure is written down (see AC4). |
| 4 | A type still not covered stays rejected as `unsupported_company_type`. | Tests `› rejects an unlisted comTypeCode (e.g. 'XX') as unsupported_company_type for every emitted period`, `› rejects a mapped type that is not in supportedCompanyTypes`, and `› missing details / missing comTypeCode stays unsupported_company_type`. |
| 5 | Tests use recorded fixtures and the no-network guard only; `typecheck`, `lint`, `test` pass. | `pnpm typecheck && pnpm lint && pnpm test` are green. The new fixtures are trimmed copies of the STK-042 recordings, and the fixtures README says so. The tests use the existing injected `fetchImpl` / no-network guard and make no real fetch. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `work/tickets/STK-042/live-samples/*` | **Prerequisite, not implementer work.** Ming records these (Q1); the implementer only reads them. | AC1, AC3 |
| `apps/worker/src/sources/vci-iq-financials.ts` | Replace `VCI_IQ_FIELDS` and `SUPPORTED_COMPANY_TYPE` with: `VCI_IQ_FIELDS_BY_COMPANY_TYPE` (per-type `revenue`, `parentNetIncome`, `ownersEquity`, `minorityInterests: string \| null`, each with a code comment giving `titleVi`); `VCI_IQ_COMMON_FIELDS` (`shares`, `companyType`, `sector`); and an exported `resolveVciIqFields(comTypeCode, supported)`, which returns the field set or `null`. Use the resolved set in `fetchQuarterly`. Pass `rejectZeroRevenue: true` in sanity. | AC1, AC2, AC4 |
| `apps/worker/src/config.ts` | Add `VCI_IQ_CONFIG.supportedCompanyTypes: readonly string[]`, defaulting to `['CT']` plus each type that passed AC3. | AC4, R5 (finance rec 3) |
| `packages/core/src/market/config.ts` | Add an optional `FinancialsSanity.rejectZeroRevenue?: boolean` with a doc comment. `DEFAULT_FINANCIALS_SANITY` is unchanged, so TCBS behaviour stays the same. | Zero-revenue guard (finance rec 2), R5 |
| `packages/core/src/market/financials.ts` | `if (revenue === 0 && sanity.rejectZeroRevenue) return fail('zero_revenue')`, before the band checks. | Zero-revenue guard (R4: a "not applicable" column must never be stored as revenue 0) |
| `packages/core/src/market/financials.test.ts` | Tests for `zero_revenue`. | R8 |
| `packages/core/src/market/financials-derive.test.ts` | Bank-scale and per-type input tests. | AC2, R8 |
| `apps/worker/src/sources/vci-iq-financials.test.ts` | Per-type mapping, missing-code, unsupported-type and gating tests. Retarget the tests that used `details-bank.json`. | AC1, AC2, AC4 |
| `apps/worker/src/sources/vci-iq-financials.crosscheck.test.ts` | New. An offline ±3% cross-check on the recorded fixtures for each supported non-CT type. The helper lives in the test file only. | AC3 |
| `apps/worker/test/fixtures/vci-iq/{bank,broker,insurer}-{statistics,income,balance,details}.json` | New. Trimmed copies of the STK-042 recordings (2023+ rows, the mapped fields plus `isa20`/`isa21` for the identity check, the identifying fields, and `pe`, `pb`, `marketCap`, `numberOfSharesMktCap`). Values unchanged. | AC1, AC5 |
| `apps/worker/test/fixtures/vci-iq/details-bank.json` | Delete. Tests that need an unsupported type use an in-memory copy of a recorded `details` with `comTypeCode` changed. | AC5: recorded fixtures only (consult-data rec 1) |
| `apps/worker/test/fixtures/vci-iq/README.md` | List the new recorded files and the source symbol and date for each. Remove the hand-written entry. | AC5 |
| `docs/adr/0005-vci-iq-financials-source.md` | Add a per-type field table (code, `titleVi`, `titleEn`, recorded date), the `supportedCompanyTypes` gating, `zero_revenue`, the cross-check results table, the meaning of the 1% growth gate per type (finance rec 7), and edits to the UNVERIFIED and Follow-ups lines. | AC1, AC3 |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `financials.test.ts › rejectZeroRevenue: revenue 0 -> zero_revenue` | Zero-revenue guard |
| `financials.test.ts › rejectZeroRevenue unset: revenue 0 still accepted (TCBS unchanged)` | No regression |
| `financials-derive.test.ts › bank-scale amounts (equity ~3e14, quarterly NI ~1e13, shares ~8.4e9) derive exact integer EPS/BVPS` | AC2, R2 (BigInt path at bank scale) |
| `financials-derive.test.ts › minority 0 (declared no-minority layout) -> BVPS = equity / shares` | AC2 (adapter passes 0 only when the mapping declares `null`) |
| `vci-iq-financials.test.ts › NH mapping › derives EPS/BVPS/revenue/netIncome from the recorded fixture` (same for CK and BH) | AC2 |
| `vci-iq-financials.test.ts › <type> mapping › mapped revenue, parent NI and equity are non-zero in every fixture quarter` | AC1 (guards against a "not applicable" 0.0 column, finance F2) |
| `vci-iq-financials.test.ts › <type> mapping › parent NI equals isa20 − isa21 (or the type's NPAT − minority lines) in every fixture quarter` | AC1 (parent, not total, NI; finance F4) |
| `vci-iq-financials.test.ts › <type> mapping › removing the mapped revenue / parent NI / equity / minority code rejects every period (no zero-fill)` | R4, consult-data rec 7 |
| `vci-iq-financials.test.ts › <type> mapping › mapped revenue 0 in one quarter -> that period zero_revenue` | Zero-revenue guard in the adapter |
| `vci-iq-financials.test.ts › minorityInterests null in mapping -> minority treated as 0; minorityInterests code present but value null -> missing_bvps` | Explicit-declaration rule (finance rec 1) |
| `vci-iq-financials.test.ts › unlisted comTypeCode 'XX' -> every emitted period unsupported_company_type` | AC4 |
| `vci-iq-financials.test.ts › mapped type not in supportedCompanyTypes -> unsupported_company_type` | AC4, gating |
| `vci-iq-financials.test.ts › details 404 / comTypeCode missing -> unsupported_company_type` | AC4 (current behaviour kept) |
| `vci-iq-financials.test.ts › CT (HPG) results unchanged` (the existing HPG tests stay green with no edits to their expectations) | No regression |
| `vci-iq-financials.crosscheck.test.ts › <SYM> period P › TTM parent NI within 3% of marketCap_P/pe_P; EPS within 3% of marketCap_P/pe_P/shares_P` | AC3 |
| `vci-iq-financials.crosscheck.test.ts › <SYM> period P › parent equity within 3% of marketCap_P/pb_P; BVPS within 3% of marketCap_P/pb_P/shares_P` | AC3 |

## Approach
0. **Prerequisite (Ming, see Q1):** raw samples in `work/tickets/STK-042/live-samples/`. The implementer must not try to fetch them (the sandbox proxy returns 403; no bypass).
1. **Read the samples.** For each symbol, confirm from `details_ticker_<SYM>.json` the `comTypeCode` (`NH` for VCB/TCB, `CK` for VND, `BH` expected for the insurer) and `isBank`. Note whether `*_metrics.json` differs per type (consult-data open Q3).
2. **Choose codes. These rules are fixed here, not left to the implementer:**
   - **Revenue** (finance F3: one source field, never a computed sum, always > 0):
     - NH: the single total-operating-income line ("Tổng thu nhập hoạt động"). Fallback if no such single line exists: gross interest income ("Thu nhập lãi và các khoản thu nhập tương tự").
     - CK: gross total operating revenue ("Cộng doanh thu hoạt động").
     - BH: net revenue from insurance business ("Doanh thu thuần hoạt động kinh doanh bảo hiểm").
     - CT: unchanged (`isa3`).
   - **Parent net income:** the "attributable to parent company" line (`isa22` if it holds for the type). Accept it only if it is non-zero in every fixture quarter **and** equals NPAT − minority (`isa20 − isa21`, or the type's own lines) in each quarter (finance F4). The ±3% check cannot tell parent from total NI for these types; the identity check is the real guard.
   - **Owner's equity (incl. minority) and minority interests:** taken from the type's own `BALANCE_SHEET` dictionary (consult-data rec 5). If a layout has no minority line, set `minorityInterests: null` explicitly, with a comment citing the dictionary. Never infer null from a `0.0`.
   - Match by `titleVi` in the recorded dictionary. Record code, `titleVi`, `titleEn` and date next to each constant and in ADR 0005.
   - **Ambiguity:** if two lines plausibly match, or the chosen line is 0 or null in any of the 16 emitted quarters (e.g. the insurer reporting-format change, finance risk), leave the type out of `supportedCompanyTypes`. Record why in ADR 0005 and the impl-log. Do not guess.
3. **Adapter (`vci-iq-financials.ts`):**
   - Keep the current request order (stats → income → balance → details). Mapping is only needed at derive time, after details is loaded, so no reorder is needed (minimal change; consult-data rec 3 says "if you keep the current order, the behaviour is unchanged").
   - Replace the `!== SUPPORTED_COMPANY_TYPE` check with `const f = resolveVciIqFields(details?.comTypeCode, VCI_IQ_CONFIG.supportedCompanyTypes)`. If the result is `null`, reject every emitted period as `unsupported_company_type` (the same code path as today).
   - Use `f.revenue`, `f.parentNetIncome`, `f.ownersEquity`, and `f.minorityInterests === null ? 0 : amount(b, f.minorityInterests)`.
   - Pass sanity `{ ...(this.o.sanity ?? DEFAULT_FINANCIALS_SANITY), rejectZeroRevenue: true }`. This applies to CT too. HPG revenue is never 0, so the existing tests are unaffected.
4. **Core:**
   - Add `rejectZeroRevenue` (optional, default off) and the `zero_revenue` reason in `normalizeQuarterlyFinancials`.
   - `deriveVciIqQuarter` is unchanged (it is already generic; consult-data findings).
   - Bounds check: bank quarterly TOI ~1.6e13 and NI ~1e13 are below `maxAbsTotalVnd` 1e15. Verify the BVPS bounds (100 … 1e7) against the samples. If a real value is out of band, stop and record it. Do not widen bounds silently (R5: a change to `DEFAULT_FINANCIALS_SANITY` needs a note in the ADR).
5. **Gating (R5, finance rec 3):**
   - `VCI_IQ_CONFIG.supportedCompanyTypes` lists `CT` plus only the types whose AC3 cross-check passed.
   - Keep `nonFailingRejectReasons` at `['unsupported_company_type']`. Rejects for newly supported symbols now fail the run, which is intended (consult-data rec 7). The run's existing per-symbol reject handling is unchanged.
6. **Cross-check (AC3), offline from recorded data** (consult-data rec 8 alternative; finance rec 4):
   - Compare amounts first: Σ parent NI over P..P−3 vs `marketCap_P / pe_P`, and (equity − minority)_P vs `marketCap_P / pb_P`. Then the per-share forms using `numberOfSharesMktCap_P`.
   - Pair statement period P with the **stats row for P**, never the latest row.
   - Use profitable quarters only (skip `pe ≤ 0`). Pick a P with no share-count change in or around the TTM window: check that `numberOfSharesMktCap` is equal over P..P−3. If there is a change, choose an earlier P and note it.
   - Record the decimal precision of `pe`/`pb` and how much of the 3% budget it uses.
   - Do not tune the ±3% tolerance. If a type fails, it stays unsupported (AC4), and the reason (treasury shares, total-vs-parent equity, restatement) goes in the ADR.
   - Two banks (VCB, TCB) if recorded.
   - Optional confirmation: Ming runs `pnpm worker:financials --dry-run` on his machine after merge (ADR 0005 checklist). Not needed for PASS (see Assumptions).
7. **Fixtures:** trim as for STK-039 (2023+ rows, read fields plus `isa20`/`isa21`, the ratio fields, and identifying fields; values unchanged). Delete `details-bank.json` and update the README.
8. **ADR 0005:** add the per-type table, gating, `zero_revenue`, the cross-check results, and the per-type meaning of the 1% growth gate (TOI vs net sales vs net insurance revenue; accepted because the gate only screens out near-zero bases, finance rec 7). Update UNVERIFIED (layouts now probed for the recorded types; `NH` also covers consumer finance and asset managers, unverified, finance F5). Add follow-ups (below).
9. **Rules:**
   - R1/R2: no new math outside core except test-only cross-check arithmetic; integers via `toVndAmount`/`roundDiv`.
   - R3: not touched.
   - R4: missing codes or values reject and record as gaps, no zero-fill; 0 revenue is now a reject.
   - R5: supported types and the zero-revenue flag are config.
   - R6: suspended; no auth added.
   - R7: follow-ups below are not in the diff.
   - R8: core tests listed.
   - R9: n/a.
   - R10: no brokerage login (public endpoints only).
10. **Follow-ups to list in impl-log, not implemented (R7):**
    - Peer key `sectorVn` + `comTypeCode` (finance F5, rec 6).
    - ROE-adjusted bank P/B or a "structural premium/discount" caveat (finance F6).
    - Tracked-universe size: only 4 banks and 3 brokers, so `peers_insufficient` for P/E and P/B (finance Q5).
    - The `financials_source_mixed` check.
    - A distinct `missing_company_type` reason (STK-039 review; consult-data Q5).
    - The EPS-basis flip to `'ttm'` (separate ADR 0005 gate).
    - Per-type `minBasePpmOfRevenue`, only if the gate is ever raised.

## Specialist input used
- **consult-data-engineer:**
  - Adopted: samples are a prerequisite, with no guessing of codes; the per-type constant keyed by `comTypeCode`; supported types = map keys plus gating; the ADR table; missing or renamed code rejects all periods; per-type removed-code test; run-health consequence; bank-scale guard check; offline cross-check from recorded `statistics-financial`; no tolerance tuning; no EPS-basis flip; recordings under `live-samples/`, trimmed into fixtures, with hand-written `details-bank.json` replaced.
  - Rejected: reordering to fetch details first (rec 3). It is not needed for correctness and keeps the diff minimal; the consult marks it optional.
  - Deferred: `missing_company_type` reason → follow-up (R7).
- **consult-finance-investment-researcher:**
  - Adopted: F3 revenue line per type with the NH fallback; F4 parent-NI identity check as the real guard; rec 1 explicit `minorityInterests: null`; rec 2 zero revenue treated as missing (`zero_revenue`) plus non-zero fixture assertions; rec 3 `supportedCompanyTypes` gating with default `['CT']`; rec 4 amount-first cross-check, P-paired stats row, profitable quarters, `pe` precision, two banks; rec 5 share-count timing pitfalls (Approach 6); rec 7 ADR text on the 1% gate.
  - Recorded as follow-ups: F5/F6 and rec 6.
  - F7 (VAS 30 basic EPS differs) is adopted as the rule "compare against VietCap `pe`, never `isa23` or company reports".

## Assumptions
- A1. The offline cross-check on recorded `statistics-financial` + statements (a reproducible test) meets AC3's "dry-run cross-check". A live `--dry-run` on Ming's machine is optional confirmation. (If Ming wants a live run as the gate, that changes only verification, not code.)
- A2. Bank revenue = TOI, with gross interest income as fallback; insurer revenue = net revenue from insurance business (finance Q2/Q3 defaults). See Q3.
- A3. A type is enabled only after its cross-check passes (finance Q4 default). See Q4.
- A4. `rejectZeroRevenue` is on for all `vci-iq` types, including CT. HPG is unaffected; a real 0-revenue CT quarter becomes a gap instead of a stored 0, which is the safer reading of R4.
- A5. `NH` symbols that are not banks (consumer finance, asset managers) get the bank mapping. If their layout differs, the non-zero or identity guards reject their periods rather than storing them wrong.
- A6. Peer insufficiency for banks and brokers (only 4 and 3 tracked) is accepted for now (finance Q5 default); it is a follow-up.
- A7. ±3% on at least one symbol per type is enough for that type. A type that fails leaves the ticket passable with that type unsupported, as long as the failure is recorded (consult-data rec 8: "If a type fails, leave it rejected (AC4) and record why"). If **every** non-CT type fails, the implementer stops and the ticket escalates. Shipping only the gating would not meet the goal.

## Blocking questions
**Q1. How should the live samples be recorded?** Exactly 5 GETs per symbol, sequential, 3 s apart, with the honest headers only.

- **Symbols (default):**
  - `VCB` (NH), `TCB` (NH, second bank per finance rec 4).
  - `VND` (CK).
  - `BMI` (insurer; expected `BH`, confirmed from `details`; HOSE; not on the watchlist).
  - If BMI's `comTypeCode` is not `BH`, use `BVH` instead.
- **Option A (recommended): Ming runs this from the repo root on his WSL machine,** on branch `ticket/STK-042`. It is the same machine and posture as the STK-039 recording (ADR 0005 decision 4), and needs no new code. It sends only `User-Agent` + `Accept` (no `--compressed`, so no extra header), gunzips if the server gzips anyway, stops on the first 403, and retries a connection reset once.
  ```bash
  #!/usr/bin/env bash
  # STK-042: record VietCap IQ samples (honest headers only; ADR 0005). Run from the repo root.
  set -u
  BASE='https://iq.vietcap.com.vn/api/iq-insight-service/v1/company'
  UA='stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)'
  OUT=work/tickets/STK-042/live-samples
  mkdir -p "$OUT"
  get() { # $1=url $2=file
    for try in 1 2; do
      code=$(curl -sS -o "$OUT/$2.tmp" -w '%{http_code}' -H "User-Agent: $UA" -H 'Accept: application/json' "$1")
      if [ "$code" = 200 ]; then
        if gzip -t "$OUT/$2.tmp" 2>/dev/null; then gunzip -c "$OUT/$2.tmp" > "$OUT/$2"; else mv "$OUT/$2.tmp" "$OUT/$2"; fi
        rm -f "$OUT/$2.tmp"; echo "200 $2"; sleep 3; return 0
      fi
      rm -f "$OUT/$2.tmp"; echo "HTTP $code $2 (try $try)"
      [ "$code" = 403 ] && { echo 'Blocked (403): stopping, no bypass.'; exit 1; }
      sleep 10
    done
    sleep 3
  }
  for S in VCB TCB VND BMI; do
    get "$BASE/$S/financial-statement/metrics"                       "${S}_financial-statement_metrics.json"
    get "$BASE/$S/financial-statement?section=INCOME_STATEMENT"       "${S}_financial-statement_section_INCOME_STATEMENT.json"
    get "$BASE/$S/financial-statement?section=BALANCE_SHEET"          "${S}_financial-statement_section_BALANCE_SHEET.json"
    get "$BASE/$S/statistics-financial"                               "${S}_statistics-financial.json"
    get "$BASE/details?ticker=$S"                                     "details_ticker_${S}.json"
  done
  printf 'Recorded %s by Ming (WSL), honest UA + Accept only. Script: STK-042 plan.md Q1.\n' "$(date -u +%FT%TZ)" > "$OUT/README.md"
  grep -ho '"comTypeCode":"[A-Z]*"' "$OUT"/details_ticker_*.json
  ```
  Then:
  ```bash
  git add work/tickets/STK-042/live-samples && git commit -m "STK-042: record VietCap IQ samples (VCB TCB VND BMI)" && git push
  ```
  If the last `grep` shows BMI is not `BH`, rerun the loop with `for S in BVH; do`. If any file is missing after the retry (the STK-039 BALANCE_SHEET call reset twice), rerun the script later for that symbol only.
- **Option B: a `workflow_dispatch` GitHub Action on a GitHub-hosted runner** that runs the same script and uploads the files with `actions/upload-artifact`. Uploading an artifact is safer than committing; committing would need `contents: write`. The orchestrator then fetches the artifact with `gh run download`. **This is not in STK-042's scope.** It is a new workflow file, so it needs a separate prerequisite ticket (e.g. "STK-0xx: workflow to record VietCap IQ samples"), planned, reviewed and merged into `main` before it can be dispatched. Workflow-dispatch runs from the default branch. Risks:
  - GitHub runners egress from foreign datacenter IPs. VietCap may block or challenge them (TCBS already sits behind a Cloudflare bot challenge, ADR 0005), and that is unverified.
  - It moves the "personal, low-volume, from home" terms posture accepted in ADR 0005 decision 4, so Ming must accept that explicitly.
- **Ming decides:** A or B, and confirms or changes the symbol list.

**Q2. Insurer coverage.** No watched symbol is an insurer.
- (a) Use a non-watched insurer (BMI by default, BVH as fallback) for the sample and cross-check only, with no change to the watchlist. Finance Q1 default; recommended.
- (b) Defer `BH`: record only VCB/TCB/VND, leave `BH` out of `supportedCompanyTypes` (it stays `unsupported_company_type`, AC4), and amend AC1/AC3 to "bank and broker". This needs Ming's approval because it changes the ticket's acceptance criteria.

**Non-blocking (defaults apply unless Ming says otherwise):**
- **Q3.** Bank revenue = TOI (fallback gross interest income); insurer revenue = net revenue from insurance business, or net premium earned? Default: as in A2.
- **Q4.** Should types be gated on a passed cross-check via `supportedCompanyTypes`? Default: yes (A3).
- **Q5.** Is AC3 met by the offline cross-check on recorded data, or does Ming want a live `--dry-run` as the gate? Default: offline (A1).

## Split proposal
None. Once samples exist, the estimated diff is about 150 lines of source, about 250 lines of tests and the ADR text, plus trimmed JSON fixtures, and covers one feature (the non-CT mapping). The recording workflow (Q1 option B), if chosen, is a **separate prerequisite ticket**, not a slice of this one.

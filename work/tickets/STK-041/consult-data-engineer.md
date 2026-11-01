## Findings
- Gap recording for unsupported symbols already works. The job builds `known` from `res.rejected` periods, so `planFinancialGaps` (packages/core/src/market/quarters.ts:84) records every in-window quarter that is not present. It skips quarters that already have an open gap, which makes re-runs idempotent. The only change needed for the gap criterion is a test that asserts it.
- `planFinancialGaps` clamps its loop to `windowStart..windowEnd`. Out-of-window rejects therefore never create gaps. Only counting and reporting need to change.
- GAS 2026Q3 is after `windowEnd` (2026Q2), so window-relative counting already covers the ratio-lag case. No separate "lag" rule is needed.
- BCG 2021Q2, 2021Q4 and 2022Q1 are before `windowStart` (2023Q3), so window-relative counting covers them too.
- `ok` today is `rejected === 0`. `rejected` is the raw total, and the job already computes `kept` by window with `comparePeriods(p.period, windowStart) >= 0`.
- The source emits `unsupported_company_type` once per period in `keys` (the latest 16 quarters). That is why each of the 8 banks shows 16 rejects, which is noisy.
- The window is a job concept (config `lookbackQuarters`, `publishLagDays`, run date). The source only knows `maxQuarters`. A source-side filter would duplicate window logic and hide rejects from the summary, which the first criterion forbids.

## Recommendations
1. **Where the window filter goes: the job.** Split `res.rejected` into in-window and out-of-window:
   - A reject is out-of-window when `period` is defined and `comparePeriods(period, windowStart) < 0` or `comparePeriods(period, windowEnd) > 0`.
   - A reject with no `period` (`invalid_row`, `invalid_period`, `ticker_mismatch`) cannot be placed, so treat it as in-window and failing.
   - Put the predicate in a small pure helper, either in core next to `planFinancialGaps` or local to the job. Do not touch the source for this (AC1, R7).
2. **Unsupported company types: a typed field, not a reason-code match in the job.** Prefer one of these:
   - (a) Add `unsupported?: boolean` to `QuarterlyResult`. The source sets it when `comTypeCode !== 'CT'`, returns `periods: []`, and still returns the per-period rejects so gaps keep working.
   - (b) Keep the reason code `unsupported_company_type` and add one constant, e.g. `NON_FAILING_REJECT_REASONS = ['unsupported_company_type']`, in `apps/worker/src/config.ts` under `FINANCIALS_SYNC_CONFIG` (e.g. `nonFailingRejectReasons`). The job reads it from `config`. This is the shape AC4 asks for (R5, "configuration or one constant") and generalises to later reasons.
   - Do (b) as the rule. Add (a) only if you want to avoid emitting 16 per-period rejects.
   - Typed-field variant (smaller summary): the source returns one `{ reason: 'unsupported_company_type' }` with no period, and the job derives gaps from `windowStart..windowEnd` itself. I advise against it, because that breaks the "known period" logic and the source's current contract.
3. **Rule semantics.**
   - A reason in the non-failing list only suppresses `ok=false`. It does not suppress gap recording, and it is still reported.
   - Count `rejected` (and fail) only for in-window rejects whose reason is not in the non-failing list.
   - Also keep rejects that are in-window but non-failing visible (see summary shape).
4. **Gap recording for unsupported symbols.** Keep the current path: in-window quarters go to `knownPeriods` and not `presentPeriods`, so they are recorded as gaps. Idempotency comes from the open-gap match, so a second run records 0 new gaps.
   - Tests to add: first run records N gaps for an unsupported symbol; second run with those gaps returned from `listOpenGaps` records 0; no `financials` rows are upserted for it; `ok` is true.
   - No-noise point: log one line per unsupported symbol, not per period. The `missing ${symbol}` log is already one line per symbol.
5. **Summary shape.** Keep `rejected` and `rejectedBySymbol` as the failing, in-window rejects. Add:
   - `rejectedOutOfWindow: number` and `rejectedOutOfWindowBySymbol: Record<string, RejectedPeriod[]>`. The BCG and GAS evidence is listed there without failing the run.
   - `unsupportedSymbols: string[]`, sorted. Derive it from symbols whose rejects include a non-failing reason. Do not repeat their 16 periods in `rejectedBySymbol`.
   - Compatibility check: grep for consumers of `rejected` / `rejectedBySymbol` (the CLI printer, tests) before changing their meaning. If any exist, add new keys and keep the old ones' meaning clear in the docstring.
   - Update the `ok` docstring at line 32: "False on any failed or skipped symbol, in-window failing reject, sector error or ledger error".
   - `periodsFetched` stays in-window only (already true).
6. **ADR 0005.** Add a short decision: the non-failing reason list, window-relative counting, and that out-of-window rejects (including the ratio-endpoint lag for the newest quarter) are reported, not failing. Mention that gaps for unsupported symbols stay recorded (R4).
7. **Replay test (AC6).** Build 11 symbols from fixtures with a fake source. Use `now` so the window is 2023Q3..2026Q2. Seven symbols return 16 `unsupported_company_type` rejects (the ticket lists AGR, BSI, SHB, TCB, TPB, VCB, VND; the "8 of 11" figure needs reconciling, see Open questions). BCG returns 3 old `missing_shares`. GAS returns 2026Q3 `missing_shares`. Assert `ok: true`, `unsupportedSymbols`, the out-of-window counts, and that an in-window `missing_shares` still gives `ok: false`.

## Risks
- Unsupported symbols whose rejects are all pre-window: `planFinancialGaps` starts at `windowStart` once any period is known, so the whole window is recorded as gaps. That is existing behavior and acceptable (no signal produced).
- Gaps for banks stay open forever, which is correct for R4 but means they never resolve. Make sure downstream gap displays do not treat that as an alert.
- Treating period-less rejects as in-window failing is the conservative choice. A noisy upstream could keep `ok` false, but it should never be silenced.
- The newest-quarter `missing_shares` lag is out-of-window only while it falls after `windowEnd`. If a quarter falls inside the window (e.g. a late ratio endpoint after the publish lag), `ok` stays false. That is intended.
- Do not make the non-failing list match on substrings. Use exact reason codes, so a renamed reason fails loudly.

## Open questions (each with a default)
1. Config key vs a core constant for the non-failing reasons? Default: `FINANCIALS_SYNC_CONFIG.nonFailingRejectReasons: ['unsupported_company_type']` in `apps/worker/src/config.ts`.
2. Should the source also emit a typed `unsupported` flag on `QuarterlyResult`? Default: no, use the reason code only (the minimal change; R7).
3. Should the per-period unsupported rejects appear in `rejectedBySymbol`? Default: no, list the symbols once under `unsupportedSymbols` (and keep the periods out of the failing map).
4. Should out-of-window rejects be capped or truncated in the summary? Default: no, list them in full under `rejectedOutOfWindowBySymbol`.
5. The ticket says 8 of 11 symbols are unsupported but lists 7 by name (AGR, BSI, SHB, TCB, TPB, VCB, VND). Which is the eighth, or is it a miscount? Default: treat it as a miscount and build the replay from the 7 listed symbols plus BCG, GAS and others as fixtures allow.
6. BCG has no price bars and its newest quarter is 2024Q4, so it may be delisted. Out of scope here. Default: do not handle it in this ticket; Ming checks the symbol.

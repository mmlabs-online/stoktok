Status: READY

# Plan — STK-041: Financials run health: count only in-window rejects, skip unsupported company types

## Spec summary
- docs/spec-v1.md line 50: "Gaps must be detected, not silently interpolated."
- docs/spec-v1.md line 83: "Signals are suppressed if the underlying data is stale or has gaps."
- CLAUDE.md R4: "Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded."
- CLAUDE.md R5: "Market rules are configuration, never hard-coded."
- ADR 0005 decision 6: "Banks, brokers and insurers (`comTypeCode` other than `CT`) are rejected as `unsupported_company_type` and recorded as gaps."
- Ticket goal: `pnpm worker:financials` reports `ok: true` when the only problems are expected ones: unsupported company types, and rejects outside the job window (`windowStart..windowEnd`).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | A rejected period outside `windowStart..windowEnd` does not make `ok` false. It is still listed in the summary, separately from in-window rejects. | `financials-sync.test.ts` › "reject before windowStart …" and "reject after windowEnd …": `ok: true`, `rejected: 0`, the period appears in `rejectedOutOfWindowBySymbol` and not in `rejectedBySymbol`. Core: `quarters.test.ts` › `isPeriodInWindow` cases. |
| 2 | `unsupported_company_type` does not make `ok` false. The symbols are listed under `unsupportedSymbols`. Their in-window quarters stay recorded as gaps (R4). | `financials-sync.test.ts` › "unsupported company type …": `ok: true`, `unsupportedSymbols: ['TCB']`, no `TCB` key in `rejectedBySymbol`, no `TCB|*` financials rows, 12 gaps recorded (2023Q3..2026Q2), a second run records 0 new gaps. |
| 3 | Any other in-window reject (`missing_shares`, `missing_eps`, unit or validation failures) still makes `ok` false. | `financials-sync.test.ts` › "in-window missing_shares / missing_eps → ok false", "period-less reject → ok false", "unsupported plus a failing reject → ok false". The existing test "rejected period recorded as gap …" (`eps_out_of_band`, `rejected: 2`, `ok: false`) still passes unchanged. |
| 4 | The non-failing rule lives in configuration or one constant (R5), and ADR 0005 records it. | `FINANCIALS_SYNC_CONFIG.nonFailingRejectReasons` in `apps/worker/src/config.ts`. The job reads only `config.nonFailingRejectReasons` (grep shows no `'unsupported_company_type'` literal in `financials-sync.ts`). Test "reason list comes from config" passes an empty list and gets `ok: false`. `config.test.ts` pins the default. ADR 0005 has new decision 8. |
| 5 | Unit tests cover each case with the in-memory store and fixtures. `typecheck`, `lint`, `test` pass. | `pnpm typecheck && pnpm lint && pnpm test` are green. The tests listed below exist. |
| 6 | Replaying the 2026-11-01 dry-run shape (11 symbols) gives `ok: true`. | `financials-sync.test.ts` › "replay 2026-11-01 dry-run shape → ok true": `periodsFetched: 44`, `rejected: 0`, `rejectedOutOfWindow: 4`, 7 sorted `unsupportedSymbols`, `ok: true`. A variant that adds one in-window `missing_shares` gives `ok: false`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/quarters.ts` | Add a pure `isPeriodInWindow(period, windowStart, windowEnd): boolean` (inclusive at both ends, uses `comparePeriods`). | AC1. The window predicate is domain logic and sits next to `planFinancialGaps` (rule 6, consult rec 1). |
| `packages/core/src/index.ts` | Export `isPeriodInWindow`. | The worker uses it. |
| `packages/core/src/market/quarters.test.ts` | Unit tests for `isPeriodInWindow`. | R8. |
| `apps/worker/src/config.ts` | Add `nonFailingRejectReasons: ['unsupported_company_type'] as readonly string[]` to `FINANCIALS_SYNC_CONFIG`, with a doc comment (exact reason codes; reported but not failing; gaps still recorded). | AC4, R5. |
| `apps/worker/src/config.test.ts` | Pin the default list. | AC4. If either side renames the reason, a test fails. |
| `apps/worker/src/jobs/financials-sync.ts` | Classify rejects, add summary keys, change how `ok` and `rejected` are computed, update docstrings, log one line per unsupported symbol. Gap logic is unchanged. | AC1–3. |
| `apps/worker/src/jobs/financials-sync.test.ts` | New tests (below). | AC1–6. |
| `docs/adr/0005-vci-iq-financials-source.md` | Add decision 8, and one sentence under "Emitted range". | AC4. |
| `apps/worker/README.md` | Line 64 exit-code sentence: "a period was rejected" becomes "an in-window period was rejected (unsupported company types and out-of-window rejects are reported, not failing)". | `rejected` and exit code 1 have a new meaning. A stale description would mislead Ming's next dry-run check. |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `quarters.test.ts` › `isPeriodInWindow`: start and end are inclusive; one quarter before start is false; one quarter after end is false; a period inside the window across a year boundary is true | AC1 (core) |
| `financials-sync.test.ts` › "reject before windowStart (BCG 2021Q2 missing_shares): ok true, rejected 0, listed in rejectedOutOfWindowBySymbol" | AC1 |
| `financials-sync.test.ts` › "reject after windowEnd (GAS 2026Q3 missing_shares, ratio lag): ok true, rejectedOutOfWindow 1, no gap for 2026Q3" | AC1 |
| `financials-sync.test.ts` › "in-window missing_shares → ok false, rejected 1, rejectedBySymbol lists it"; the same for `missing_eps` | AC3 |
| `financials-sync.test.ts` › "period-less reject (invalid_row) → in-window, ok false" | AC3 (conservative rule) |
| `financials-sync.test.ts` › "unsupported company type: ok true, unsupportedSymbols, not in rejectedBySymbol, no rows, 12 in-window gaps; second run records 0; one log line" (16 rejects 2022Q4..2026Q3, not dry-run) | AC2, R4 |
| `financials-sync.test.ts` › "unsupported plus a failing reject on the same symbol → ok false" (16 `unsupported_company_type` + `{ reason: 'invalid_row' }`) | AC3 |
| `financials-sync.test.ts` › "reason list comes from config: nonFailingRejectReasons [] → unsupported fails" | AC4 |
| `financials-sync.test.ts` › "replay 2026-11-01 dry-run shape → ok true" plus a variant with one in-window `missing_shares` → ok false | AC6 |
| `config.test.ts` › "financials nonFailingRejectReasons default is ['unsupported_company_type']" | AC4 |

Existing tests must stay green without edits. In particular, "rejected period recorded as gap …" asserts `rejected: 2` for in-window `eps_out_of_band`.

## Approach
1. **Core.** In `quarters.ts`, add:
   ```ts
   /** True when windowStart <= period <= windowEnd. */
   export function isPeriodInWindow(period: string, windowStart: string, windowEnd: string): boolean
   ```
   Export it from `index.ts` and add the tests.
2. **Config (R5).** Add `nonFailingRejectReasons` to `FINANCIALS_SYNC_CONFIG`. Use a `readonly string[]` type so tests can override it with `{ ...FINANCIALS_SYNC_CONFIG, nonFailingRejectReasons: [] }`. Match exact codes only, never substrings.
3. **Job: classify each reject** in `res.rejected` per symbol, in this order:
   1. If `config.nonFailingRejectReasons` includes `r.reason`, the reject is **non-failing**. Add the symbol to `unsupportedSymbols` once and count it in `rejectedNonFailing`. Its periods are not repeated anywhere else in the summary (consult open question 3, default).
   2. Else, if `r.period !== undefined` and `!isPeriodInWindow(r.period, windowStart, windowEnd)`, the reject is **out-of-window**. It goes to `rejectedOutOfWindowBySymbol[symbol]` and `rejectedOutOfWindow += 1`.
   3. Else the reject is **failing**: `rejectedBySymbol[symbol]` and `rejected += 1`. A reject with no period cannot be placed, so it is treated as in-window and failing.
4. **Summary interface.**
   - Keep `rejected` and `rejectedBySymbol`, which now mean the failing, in-window rejects only. Update their docstrings.
   - Add `rejectedOutOfWindow: number`, `rejectedOutOfWindowBySymbol: Record<string, RejectedPeriod[]>`, `rejectedNonFailing: number` and `unsupportedSymbols: string[]` (sorted; the symbols loop is already sorted).
   - Update the `ok` docstring to: "False on any failed or skipped symbol, in-window failing reject, sector fetch error or ledger error."
   - The `ok` expression stays `rejected === 0 && …`. Only the meaning of `rejected` changes.
5. **Logging.** Log `unsupported ${symbol}: ${reasons}` once per symbol (warn level text, not `error:`). The existing `missing ${symbol}` gap line already appears once per symbol.
6. **Gaps (R4): no code change.** `known` still includes every reject period. For an unsupported symbol, `planFinancialGaps` therefore records every in-window quarter (2023Q3..2026Q2) as a gap, and the open-gap match keeps re-runs idempotent (consult findings 1–2). Out-of-window rejects never create gaps, because `planFinancialGaps` clamps to the window. Gapped quarters produce no signal (spec line 83).
7. **ADR 0005, decision 8.**
   - The run counts as failing only for in-window rejects whose reason is not in `FINANCIALS_SYNC_CONFIG.nonFailingRejectReasons`. The default list is `['unsupported_company_type']`.
   - Out-of-window rejects are reported in `rejectedOutOfWindowBySymbol` and do not fail the run. This includes the emitted range reaching back before `windowStart`, and the ratio endpoint lagging the statements for the newest quarter after `windowEnd`.
   - Unsupported symbols are listed in `unsupportedSymbols`. Their in-window quarters stay recorded as open gaps (R4), so no signal is produced from them.
   - Add one sentence under "Emitted range": rejects for the extra 4 quarters before `windowStart` are reported out-of-window.
8. **README.** Update the exit-code sentence (line 64).
9. **Replay test (AC6).**
   - Use `now = 2026-11-01T11:28:00Z` (VN date 2026-11-01). The window is 2023Q3..2026Q2, because 2026Q3 is not due until Nov 14. Run as a dry run.
   - Use 11 symbols with a `fakeSource` shaped from Ming's evidence (ticket Notes):
     - AGR, BSI, SHB, TCB, TPB, VCB, VND: each returns `periods: []` and 16 `unsupported_company_type` rejects, 2022Q4..2026Q3. This is the shape the source emits for a bank (see `vci-iq-financials.test.ts` "unsupported_company_type reports only the emitted range", which uses the recorded `details-bank.json`).
     - BCG: periods 2023Q3..2024Q4 (6 in-window) plus rejects 2021Q2, 2021Q4, 2022Q1 `missing_shares`.
     - GAS: periods 2023Q3..2026Q2 (12) plus 2026Q3 `missing_shares`.
     - Two healthy CT symbols (placeholder names `FPT`, `HPG`): 13 periods each, 2023Q3..2026Q3.
   - Assert: `periodsFetched: 44` (6 + 12 + 13 + 13; this matches the live 44), `rejected: 0`, `rejectedOutOfWindow: 4`, `rejectedNonFailing: 112`, 7 sorted `unsupportedSymbols`, and `ok: true`. Then rerun with one extra in-window `missing_shares` on GAS (2025Q4) and assert `ok: false`, `rejected: 1`.

Rules:
- R1 and R2: no money math changes.
- R4: gaps for unsupported symbols are still recorded, and a test asserts it.
- R5: the reason list is configuration.
- R7: no change to the sources, `planFinancialGaps`, or the `kept` filter.
- R8: core and worker tests are listed above.
- R3, R6, R9 and R10: not affected.

## Specialist input used
`consult-data-engineer.md`:
- Adopted rec 1: the window filter goes in the job, using a pure predicate in core. Period-less rejects count as in-window and failing.
- Adopted rec 2(b): a config list of non-failing reasons. Rejected 2(a) and the typed-field variant (open question 2, default "no"; R7, keeps the source contract).
- Adopted rec 3: reason-list semantics. Non-failing only suppresses `ok=false`; it still reports and still records gaps.
- Adopted rec 4: gap path unchanged, plus idempotency tests and one log line per symbol.
- Adopted rec 5: summary shape. I added `rejectedNonFailing` so the count of non-failing rejects stays visible after their periods leave `rejectedBySymbol`. Consumer check: `rejected` / `rejectedBySymbol` from the financials job are read only by its own tests and the CLI JSON printer (`cli.ts` prints the summary and uses `ok` for the exit code). `eod-sync` has its own separate fields. Changing the meaning is therefore safe, and the docstrings and README are updated.
- Adopted rec 6 (ADR) and rec 7 (replay). The replay uses the 7 listed symbols (open question 5: miscount, per ticket Notes).
- Open question 4 (no truncation) and open question 6 (BCG delisting is out of scope): defaults accepted, per ticket Notes.

## Assumptions
- A reject after `windowEnd` counts as out-of-window, even though valid periods after `windowEnd` are still upserted by the existing `kept` filter (`>= windowStart` only). AC1 defines the window as `windowStart..windowEnd`. The `kept` asymmetry is existing behavior and stays untouched (R7).
- The summary key is named `unsupportedSymbols`, as in the ticket. If more reasons are later added to `nonFailingRejectReasons`, their symbols also land there. The docstring says so ("symbols with any non-failing reject").
- The two healthy symbols in the replay use placeholder names, because the ticket does not name the remaining 2 of the 11. Their counts are chosen so that `periodsFetched` equals the live 44.
- The ticket says "recorded fixtures". The replay uses a fake source built from the recorded run's shape. The bank shape from the recorded `details-bank.json` fixture is already covered at source level. Wiring the real `VciIqFinancialsSource` with an HTTP stub into the job test would duplicate the source test harness for no extra coverage.
- Follow-up (not in this diff): the README "Financials sync" section still describes the TCBS source and ADR 0002. That stale text dates from STK-039 and is out of scope.

## Blocking questions
None.

## Split proposal
None. The estimate is about 150–250 changed lines, mostly tests.

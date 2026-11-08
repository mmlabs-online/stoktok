## Attempt 1 — 2026-11-08

Scope: slice A of plan.md (ticket ACs narrowed: ratios to STK-067, cash flow to STK-068).

### Files touched
| File | Required because |
|---|---|
| `supabase/migrations/20261108000100_financial_lines.sql` | AC1, AC4, AC5: table, RLS, service_role-only grants (High tier) |
| `supabase/rollback/20261108000100_financial_lines.down.sql` | AC5: rollback |
| `scripts/db-check/checks.sql` | AC5: table list, column shapes, service_role read/write, negative inserts |
| `packages/core/src/market/statement-lines.ts` | R1/R2/R4/R5: line registry, `normalizeStatementLines`, `assertFieldMap`, year helpers, gap type constants |
| `packages/core/src/market/statement-lines.test.ts` | AC6, R8 |
| `packages/core/src/market/config.ts` | R5: `StatementLinesSanity`, `DEFAULT_STATEMENT_LINES_SANITY` |
| `packages/core/src/index.ts` | Exports for the worker |
| `packages/db/src/rows.ts`, `mappers.ts`, `index.ts` | `FinancialLineInsert/Row`, `FinancialLineRecord` + mapper, exports |
| `packages/db/src/repos/financial-lines.ts` (+ `.test.ts`) | AC4: `listFinancialLines`, `upsertFinancialLines` |
| `apps/worker/src/sources/financials-source.ts` | AC3: `FinancialStatementsSource`, `StatementsResult`, `StatementPeriod` |
| `apps/worker/src/sources/vci-iq-financials.ts` | AC1, AC3: per-type field maps, `fetchStatements`, shared response cache (`load`), `parse(..., 'years')` |
| `apps/worker/src/sources/vci-iq-statements.test.ts` | AC3, AC6 |
| `apps/worker/test/fixtures/vci-iq/statements/{hpg,vcb,vnd,bmi}-{income,balance}.json`, `fixtures/vci-iq/README.md` | AC3: trimmed recorded fixtures and provenance |
| `apps/worker/src/jobs/financial-statements-sync.ts` (+ `.test.ts`) | AC1, AC4: the job |
| `apps/worker/src/config.ts`, `config.test.ts` | R5: `FINANCIAL_STATEMENTS_SYNC_CONFIG` |
| `apps/worker/src/store.ts` | `createDbFinancialStatementsStore` |
| `apps/worker/src/cli.ts`, `cli.test.ts` | `financial-statements` job name, `--dry-run` only |
| `package.json` (root) | `worker:financial-statements` script (the existing `worker:*` scripts live in the root, not in `apps/worker/package.json`) |
| `apps/worker/README.md` | Document the job; not scheduled |
| `scripts/probe-vci-iq-cashflow.sh` | Live probe for Ming (not run by agents); `bash -n` passes |
| `docs/adr/0007-vci-iq-statement-lines.md` | AC3 terms note, codes, open cash-flow questions |

### Tests added / changed
- `statement-lines.test.ts`: registry integrity; half-away-from-zero conversion; missing/null/non-number/non-finite; zeroIsMissing vs borrowings zero; nonNegative guard; max bound; null = not applicable; assertFieldMap; yearBounds; latestExpectedYear (lag cases); planAnnualGaps (record, resolve, no known year, open gap, window clip).
- `vci-iq-statements.test.ts`: HPG all 12 lines exact (quarter + year); balance identity and gross_profit/minority sanity on every period; VCB/VND/BMI map only non-null lines; every non-null code numeric in the fixtures; removed code goes to `missing`; year rows; non-5 year row; duplicates (quarter and year); unsupported type; out-of-band line; shared cache GET count; GETs and pauses alone; 403/404; invalid symbol; consistency with `fetchQuarterly` (revenue, net income).
- `financial-statements-sync.test.ts` (14): writes quarter and year lines with source/fetched_at; idempotent second run; line missing leads to period gap; missing year leads to annual gap; not-applicable; gap resolves; restated; dry run; unsupported; failing vs out-of-window rejects; fetch error and circuit breaker; no data; upsert before gaps; ledger error.
- `financial-lines.test.ts` (repo): upsert dedupe/chunk/onConflict/no select, empty, 23514; list filters, empty, mapping errors.
- `cli.test.ts`: `financial-statements` accepted; `--source` and `--backfill` rejected. `config.test.ts`: new config defaults.

### Checks (actual output summary)
- typecheck: `pnpm typecheck` passes for all workspaces (no errors).
- lint: `pnpm lint` passes for all workspaces (no errors).
- test: `pnpm -r --no-bail test`: core 52 files / 669 tests pass; sources 24 pass; worker 16 files / 261 pass; web 38 files / 302 pass; db 147 pass, 2 FAIL, 1 todo. The 2 db failures are the known pre-existing Windows ones in `packages/db/src/r3-guard.test.ts` (backslash paths, spaceM#11), not touched here. All new db tests (`financial-lines.test.ts`, 6) pass.
- `scripts/db-check.sh` was NOT run (needs a Postgres/Supabase instance; none here). The migration and `checks.sql` changes are unverified against a live database; the reviewer or Ming should run it.

### Out-of-plan files
None. Two deviations inside planned files: the `worker:financial-statements` script went to the root `package.json` only (plan said "+ root if defined there"; `apps/worker/package.json` has no `worker:*` scripts), and `parse()` got a `'years'` mode instead of a separate `parseYears()` (same rules, smaller diff).

### Deviations from the plan, for the reviewer
- `DEFAULT_STATEMENT_LINES_SANITY.maxAbsTotalVnd` is 9e15, not "reuse `maxAbsTotalVnd`" (1e15). The first fixture run rejected every VCB `total_assets`/`total_liabilities` (> 1e15 VND, about 2e15 for a large bank). 9e15 sits just under `Number.MAX_SAFE_INTEGER`; a 1000x error is still caught by this bound or the safe-integer check. Recorded in ADR 0007.
- Codes: all non-null codes in the plan table were asserted numeric in the latest period of the fixtures and none had to be set to null. No code changed.
- Line-level `out_of_band` rejections are surfaced as `RejectedPeriod { period, reason: '<line>_out_of_band' }`, so they fail the run when in-window (same as other rejects) and make the period "known" but not "present" (gap recorded).
- A period present in only one of income/balance is still emitted (union), with the other statement's lines in `missing`.
- The CK `profit_before_tax` null (VND `isa16` ambiguity) and the bank `cash_and_equivalents` null follow the plan.

### Follow-ups (noticed, not done)
- `debt` issue: schedule `financial-statements` in `deploy/**/run-schedule.sh` after migration `20261108000100` is applied and a dry-run is clean (plan Assumption 3).
- `debt` issue: map more NH/CK/BH lines and resolve the VND `isa16` ambiguity.
- `debt` issue: verify consolidated vs parent-only basis of the statements.
- Ming: run `scripts/probe-vci-iq-cashflow.sh` and commit samples to `work/tickets/STK-061/live-samples/` (gate for STK-068); apply the migration and run `scripts/db-check.sh`.
- `.gitattributes` is untracked in the working tree (pre-existing, not part of this ticket); left out of the commit.

### Scope self-check
- Could the diff be smaller? No. Non-test code is about the planned size; the rest is tests, fixtures (45 KB trimmed JSON) and docs.
- Diff size: +3,826 / -36 lines in 36 files, of which about 2,000 are pretty-printed fixture JSON; non-test source is about +700.

## Attempt 2 (REWORK) — 2026-11-08

Fixes review Attempt 1, Issue 1 only: the stored-lines read exceeded the PostgREST 1000-row cap.

### Files touched
- `apps/worker/src/config.ts`: new `FINANCIAL_STATEMENTS_SYNC_CONFIG.linesSymbolChunk = 4` (4 symbols x 16 quarters x 12 lines = 768 rows < 1000). Required because chunk size is configuration, like `financialsSymbolChunk`.
- `apps/worker/src/store.ts`: `createDbFinancialStatementsStore.listFinancialLines` reads in symbol chunks and concatenates (same pattern as `createDbSignalsStore`). Takes `linesSymbolChunk` in opts. Required because it is the unchunked wiring named in the review.
- `apps/worker/src/cli.ts`: passes `linesSymbolChunk` from config. Required by the new opt.
- `apps/worker/src/store.test.ts`: mock entry plus a test that chunks of `[A,B],[C,D],[E]` are read with the same kind/period and concatenated in order.

### Checks
- `pnpm typecheck`: clean.
- `pnpm lint`: clean.
- `pnpm -r --no-bail test`: core 669 pass; sources 24 pass; worker 262 pass; web 302 pass; db 147 pass, 2 FAIL (`r3-guard.test.ts`, Windows paths, spaceM#11, pre-existing).

### Out-of-plan files
None beyond the review's named wiring (`config.ts`, `cli.ts`, `store.ts` are all worker files already in the ticket).

### Follow-ups
None new. Nits from the review left untouched (non-blocking).

### Scope self-check
Only Issue 1 addressed; ~25 lines of source plus one test.

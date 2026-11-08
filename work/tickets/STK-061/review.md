## Attempt 1 — 2026-11-08
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`, exit 0, all workspaces clean.
- lint: `pnpm lint`, exit 0, all workspaces clean.
- test: `pnpm -r --no-bail test`: core 52 files / 669 pass; sources 24 pass; worker 16 files / 261 pass; web 38 files / 302 pass; db 147 pass, 2 FAIL, 1 todo. The 2 failures are both in `packages/db/src/r3-guard.test.ts` (Windows backslash paths, spaceM#11). They also fail on main, and this diff does not touch the files they guard. This matches impl-log.md.
- `bash -n scripts/probe-vci-iq-cashflow.sh`: OK. Its UA string matches `VCI_IQ_CONFIG.userAgent` (apps/worker/src/config.ts:53).
- `scripts/db-check.sh`: not run, because there is no Postgres here. I judged the SQL by reading it (see AC5).

### Acceptance criteria
- [ ] AC1: worker stores quarterly and annual income and balance lines for watchlist and held symbols, each with `source`/`fetched_at`; not-applicable lines are not gaps. The mapping and writing work: `vci-iq-statements.test.ts › HPG (CT) maps all 12 lines…`, `› VCB (NH), VND (CK), BMI (BH) map only their non-null lines…`, `financial-statements-sync.test.ts › writes quarter and year lines… with source and fetched_at`, `› a not-applicable line writes no row and no gap`. But the stored-line read silently truncates for a realistic watchlist, which corrupts gap and restatement decisions. FAILED, see Issue 1.
- [x] AC2: VCI IQ adapter pattern, recorded fixture, terms note in an ADR, no PDF parsing, cash-flow probe script. Evidence: `VciIqFinancialsSource implements FinancialsSource, FinancialStatementsSource` (vci-iq-financials.ts); fixtures `apps/worker/test/fixtures/vci-iq/statements/*` with provenance in the fixture README; `docs/adr/0007-vci-iq-statement-lines.md` "Endpoint use and terms"; `grep -ri pdf apps/worker/src packages/core/src` finds nothing; `scripts/probe-vci-iq-cashflow.sh` (no cookies/Origin/Referer, stops on 403, 1 s pacing).
- [ ] AC3: idempotent upsert on symbol + period kind + period + line; a missing period or line is a gap, never 0. The upsert works: `financial-lines.test.ts › dedupes by full key…onConflict symbol,period_kind,period,line`, `financial-statements-sync.test.ts › second run…no new gaps`, `› a mapped line missing…records a period gap`, `statement-lines.test.ts › zero on a zeroIsMissing line…`. Gap correctness depends on a complete read of stored rows, which is not guaranteed. FAILED, see Issue 1.
- [x] AC4: migration has RLS on, service_role-only grants, a rollback and db-check updates. Evidence (by reading): `supabase/migrations/20261108000100_financial_lines.sql` enables RLS, revokes from public/anon/authenticated and grants select/insert/update/delete to service_role, matching `20261026000100_financials.sql`. The rollback file drops the table, and db-check applies rollbacks in reverse and asserts 0 tables left. `checks.sql` adds the table to `tables_exist` in sorted order, column-shape asserts, service_role read/write, and negatives (symbol, kind, tied period check, Q5, statement, line regex, empty source, null value, duplicate key). The generic anon/authenticated-denied and no-grants loops cover the new table. The SQL looks correct, but it has not been run against Postgres.
- [x] AC5: typecheck/lint/test green (apart from the known pre-existing r3-guard Windows failures), with unit tests for mappers and line guards. Evidence: the runs above; `packages/core/src/market/statement-lines.test.ts` (registry, rounding, missing, zeroIsMissing, nonNegative, max bound, not applicable, assertFieldMap, year helpers, planAnnualGaps); `vci-iq-statements.test.ts`; `financial-lines.test.ts`.

### Issues
#### Issue 1 — 🔴 blocker — data correctness (R4): stored-line read is silently capped at the PostgREST 1000-row limit
- **Where**: `packages/db/src/repos/financial-lines.ts:14-19` (`listFinancialLines`), wired unchunked in `apps/worker/src/store.ts` (`createDbFinancialStatementsStore.listFinancialLines`), consumed at `apps/worker/src/jobs/financial-statements-sync.ts` (`storedQ` / `storedY`).
- **Expected**: The job sees every stored line in the window, as the codebase already ensures elsewhere. `SIGNALS_JOB_CONFIG.financialsSymbolChunk` ("keeps a response under the 1000-row cap", config.ts:110) and `HOLIDAY_GAPS_CONFIG.pageSize` ("PostgREST caps a response at 1000") both exist for this reason.
- **Actual**: A single `.in('symbol', all).eq('period_kind').gte('period')` query with no order or paging. A CT symbol has 12 lines × `lookbackQuarters` 12 = 144 quarter rows. With more than 6 symbols, the quarter read passes 1000 rows and PostgREST returns an arbitrary subset with no error. The `stored ∪ fetched` "present" set, the "known" set, gap resolution, and `restated` are then computed from incomplete data. The effects: periods that are stored but not re-emitted get recorded as gaps (or never resolve), restatements are missed, and nothing reports it.
- **Fix instruction**: Read stored lines in symbol chunks in `createDbFinancialStatementsStore`, the same way `createDbSignalsStore` does (store.ts:102). Add `FINANCIAL_STATEMENTS_SYNC_CONFIG.storedLinesSymbolChunk` (R5), with a doc comment that derives the value: 12 lines × max(lookbackQuarters, maxYears) per symbol must stay under 1000, so 5 symbols per chunk. Pass it through `createDbFinancialStatementsStore(db, { upsertChunkSize, storedLinesSymbolChunk })` in cli.ts. Add a `config.test.ts` assertion that `storedLinesSymbolChunk × 12 × lookbackQuarters < 1000`. Add a store-level or repo test showing that a symbol list longer than one chunk produces several queries and that their results are concatenated. Paging with `.range()` plus `.order()` is an acceptable alternative if it is tested the same way.

### Rules R1–R10
No violations found.
- R1/R2: conversion goes only through `toVndAmount`. Guards, gap math and year helpers live in `packages/core/src/market/statement-lines.ts`. Values are integers (bigint column, `toSafeInt` on read).
- R4: every row carries `source`/`fetched_at` (DB `not null`, `source <> ''`, mapper rejects empty values). Missing means no row plus a gap. Placeholder zeros on `zeroIsMissing` lines become missing. The completeness of the gap computation is Issue 1.
- R5: windows, lags, caps and sanity bound are in config. The field maps are constants with `assertFieldMap` at module load.
- R3/R6: worker only, no web or client code touched.
- R7: no ratios, no cash flow, no scheduling. Scope matches plan.md. The two deviations (root `package.json` script, `parse(...,'years')` mode) are justified in impl-log.md. The other `work/**` files in `origin/main...HEAD` come from earlier orchestrator commits (f432e79, e84f510, 98d1ea8), not from the implementer.
- R8: new core logic has unit tests.

### Nits (do not block)
- `financial-statements-sync.ts`: a line that is stored but absent or rejected in a fresh fetch still counts as "present", because the stored value is kept. This is acceptable under ADR 0002 overwrite semantics, but a short comment would make it explicit.
- The migration revokes from `public` as well as anon/authenticated, which is stricter than `financials`. That is fine; the only point is the inconsistency between the two migrations.
- `latestExpectedYear` loop bound `3` is a magic number. A named constant or a comment would help.
- `DEFAULT_STATEMENT_LINES_SANITY.maxAbsTotalVnd` 9e15 is very close to `MAX_SAFE_INTEGER`. The rationale is documented in ADR 0007 and is acceptable.

### Follow-ups (out of scope)
- Run `scripts/db-check.sh` on a machine with Postgres (Ming or CI) before merge. This PR is High tier (migration).
- `debt` issues listed in impl-log.md: schedule the job after the migration is applied; map more NH/CK/BH lines and resolve the VND `isa16` ambiguity; verify consolidated vs parent-only basis.
- Ming: run the cash-flow probe (gate for STK-068).

## Attempt 2 — 2026-11-08
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`, exit 0.
- lint: `pnpm lint`, exit 0.
- test: `pnpm -r --no-bail test`: core 669 pass; sources 24 pass; worker 16 files / 262 pass (+1 compared with attempt 1); web 302 pass; db 147 pass, 2 FAIL, 1 todo. Both failures are in `packages/db/src/r3-guard.test.ts` (Windows paths, spaceM#11). They are pre-existing and unrelated to this diff. This matches impl-log.md Attempt 2.
- `scripts/db-check.sh`: not run, because there is no Postgres here. The migration is unchanged since attempt 1.

### Issue 1 (attempt 1) — resolved
- `apps/worker/src/store.ts:80-95`: `createDbFinancialStatementsStore.listFinancialLines` now reads in chunks of `opts.linesSymbolChunk` symbols. It awaits each chunk in turn and concatenates the results, the same pattern as `createDbSignalsStore`.
- `apps/worker/src/config.ts:105-106`: `FINANCIAL_STATEMENTS_SYNC_CONFIG.linesSymbolChunk = 4` (R5). The doc comment derives the bound: 4 × 16 (`maxQuarters`, a safe upper bound on the 12-quarter lookback) × 12 lines = 768 < 1000. The year read is 4 × 6 × 12 = 288 rows.
- `apps/worker/src/cli.ts:94`: passes the new option through.
- `apps/worker/src/store.test.ts › createDbFinancialStatementsStore › listFinancialLines chunks by linesSymbolChunk and concatenates`: with chunk 2, five symbols produce 3 calls (`[A,B],[C,D],[E]`). Each call keeps the same kind and period, and the output is concatenated in order. Passes.

### Acceptance criteria
- [x] AC1: the evidence from attempt 1, plus the complete stored-line read above.
- [x] AC2: unchanged since attempt 1 (met).
- [x] AC3: the upsert and gap evidence from attempt 1. The gap and restatement logic now sees every stored row in the window.
- [x] AC4: unchanged since attempt 1 (met by reading; db-check is pending, see Follow-ups).
- [x] AC5: the checks above. The new store test covers the chunking.

### Scope
The attempt 2 diff (`86b5250`) touches only `config.ts`, `store.ts`, `cli.ts`, `store.test.ts` and `impl-log.md`. These are worker files already in the plan, and the change is limited to Issue 1. No out-of-plan changes.

### Rules R1–R10
No violations. R5: the chunk size is in config. R4: the gap computation now works on complete data.

### Should-fix (non-blocking, carry to debt)
- 🟡 The `config.test.ts` guard asked for in attempt 1 is missing. `apps/worker/src/config.test.ts` has no assertion that `linesSymbolChunk × STATEMENT_LINES count × max(maxQuarters, maxYears) < 1000`. The value is correct today and the comment documents it. But if `maxQuarters` or the line registry grows, truncation would come back silently. Fix: add `expect(c.linesSymbolChunk * Object.keys(STATEMENT_LINES).length * Math.max(c.maxQuarters, c.maxYears)).toBeLessThan(1000)`. Do it in a follow-up, or fold it into the PR if convenient.

### Nits (do not block)
- The attempt 1 nits still stand (the comment on stored-but-absent lines, the `public` revoke inconsistency, the `latestExpectedYear` bound `3`).

### Follow-ups (out of scope)
- Run `scripts/db-check.sh` on a machine with Postgres (Ming or CI) before merge. This PR is High tier (migration), so Ming reviews it.
- Open a `debt` issue for the config guard above if it is not added before merge.
- The `debt` items listed in impl-log.md attempt 1 still apply.

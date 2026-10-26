## Attempt 1 — 2026-10-26
Verdict: PASS

Scope reviewed: `git diff f4861e7^..HEAD` (STK-014 only; STK-010/011 are in PR #9).

### Checks (run by reviewer)
- typecheck: green (exit 0; core, db, web, worker).
- lint: green (exit 0).
- test: green (exit 0). core 287 passed (25 files); db 89 passed + 1 todo (13 files); worker 55 passed (7 files); web 148 passed (18 files). Matches impl-log.
- build: green (web build Done; worker tsup).
- check:service-key: `OK: no service key material in client bundle` (0 hits for `SUPABASE_SERVICE_ROLE_KEY` and `service_role` in `.next/static`).
- db:check: `db:check OK`. It applied 4 migrations, ran the checks, applied the 4 rollbacks (including `20261026000100_financials.down.sql`), re-applied, and passed the checks again.
- Reviewer e2e (scratch, outside the repo: `/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/stk014-review/e2e.mts`). It ran the real `TcbsFinancialsSource` and `runFinancialsSync` with `dryRun: false` against a stateful fake store. The store has an upsert keyed on (symbol, period), id'd gaps with `resolved_at`, and a symbols table with PostgREST merge-upsert semantics. HTTP was a stubbed `fetchImpl` and global `fetch` was replaced with a thrower. The run used 5 symbols (TSTA ok, ETFX all-404, FAIL all-503, TSTB blank sector, TSTC partial quarter). **26/26 checks PASS:**
  - Run 1 wrote 17 rows, all with integer VND, `source='tcbs-public'` and `fetched_at=now`. FAIL went to `failedSymbols` and the other symbols continued. ETFX went to `symbolsWithoutData` with no gaps. TSTC 2025Q3 (eps null) got no row and one gap with VN bounds `2025-06-30T17:00:00Z..2025-09-30T16:59:59Z` and source/fetched_at.
  - Sectors: TSTA got its sector set and kept `exchange='HNX'`. TSTB (`industry: '   '`) kept its stored sector, provenance and exchange. TSTC (no industry) had no symbols row written.
  - Run 2, an identical re-run: the row count did not change, rows were identical apart from `fetched_at`, there were 0 new gaps and 0 restatements.
  - Run 3, wrong-unit fixtures for TSTA: 2 rejections and `ok=false`. Stored TSTA rows were untouched and no gap was created. A new symbol with wrong-unit data stored nothing.
  - Run 4, the full TSTC fetch: 2025Q3 was stored and the gap was resolved (`resolved_at` set, not deleted). There were 0 new gaps. Run 5 resolved nothing and recorded nothing.
  - Open-gap timestamps were fed back in `+00:00` form, which confirms that matching is by instant, not by string.

### Acceptance criteria
- [x] `FinancialsSource` interface with one implementation, swappable. Evidence:
  - `apps/worker/src/sources/financials-source.ts` declares the interface, and `TcbsFinancialsSource implements FinancialsSource` (`tcbs-financials.ts:32`).
  - `jobs/financials-sync.ts` imports only the interface type. Only `cli.ts` constructs TCBS.
  - Tests: `financials-sync.test.ts › works with any FinancialsSource (fake source)` and all `tcbs-financials.test.ts` cases pass.
- [x] Migration adds `financials` and a symbol→sector mapping; RLS on, no anon/authenticated policies; integer VND. Evidence:
  - `supabase/migrations/20261026000100_financials.sql`: four `bigint not null` value columns, PK (symbol, period), period/symbol/revenue CHECKs, RLS enabled, revoke from anon/authenticated, grant to service_role.
  - `symbols.sector`, `sector_source` and `sector_fetched_at` have format and all-or-nothing provenance CHECKs (R4).
  - db:check is green. That covers `tables_exist`, `financials_columns`, `symbols_columns`, `source_fetched_at_not_null`, `no_numeric_or_float_columns`, `no_policies`, the anon/authenticated denied loop, `service_role_can_read_write_financials`, the new `rejects_bad_rows` cases (bad period ×3, lowercase symbol, negative revenue, NULL eps/source, sector ''/untrimmed/provenance mismatch ×2, duplicate 23505, negatives accepted), and rollback plus re-apply.
- [x] Daily-check job upserts idempotently with `source`/`fetched_at`; missing periods are recorded, not filled. Evidence:
  - Tests: `financials-sync.test.ts` › `re-run produces the same rows except fetched_at`, `every row carries source…`, `interior missing period recorded once across two runs`, `rejected period recorded as gap, no row written…`, `gap resolved when the period arrives`, `no gap before the symbol's first known period; not-yet-due quarter is not a gap`.
  - `financials.test.ts › onConflict symbol,period`.
  - Reviewer e2e runs 1–5 above.
- [x] Unit tests use recorded fixtures only, no live network. Evidence:
  - `vitest.config.ts` keeps `setupFiles: ['test/no-network.ts']` (unchanged).
  - `tcbs-financials.test.ts › no-network guard › global fetch throws`. All adapter tests inject `fetchImpl` serving `test/fixtures/tcbs-financials/*`.
  - The fixture README opens with "SYNTHETIC — hand-written from a recalled shape, not recorded" and uses made-up tickers. That labelling is honest; "recorded" in the AC is satisfied as far as the sandbox allows, per Ming's note.
- [x] Job runnable once via a documented `pnpm` script. Evidence:
  - The root `package.json` has `worker:financials`.
  - `cli.test.ts › financials and financials --dry-run are accepted` and the unknown-flag rejection test pass.
  - `apps/worker/README.md` has a "Financials sync" section with the commands, the first-run checklist, the exit codes and the schedule.

### Issues
None blocking.

### Rules R1–R10
No violations found.
- R1: conversion, guards, period math, the publish lag and gap planning are in `packages/core/src/market/{financials,quarters}.ts`. The worker only orchestrates; the restatement diff is an equality check.
- R2: `toVndAmount` is the single boundary conversion (half away from zero, safe-integer check). Integers flow end to end, the DB columns are bigint, and the mapper uses `toSafeInt`.
- R3: there are no web changes, and the service-key check is green.
- R4: `source`/`fetched_at` are on financials rows and gap rows. Sector provenance is enforced by a DB CHECK and written only through `setSymbolSector`. The mapper rejects rows without provenance.
- R5: `DEFAULT_FINANCIALS_SANITY` is in core config, and `FINANCIALS_SYNC_CONFIG` holds the lookback, lag, delays, caps and breaker. The units constant lives in the adapter and is labelled UNVERIFIED.
- R6 is suspended, so it was not assessed.
- R7: every changed product file is in the plan's file list. The extra `work/` edits (ticket state, backlog, STK-031 note) are workflow bookkeeping.
- R8: core and repo logic have unit tests.
- R10: read-only public data.

ADR 0002 and the README match the code: paths and params, honest UA, about 3 requests per symbol with a 1 s delay and 15 s timeout, retries on network/429/5xx (matches `http.ts`), unit table, policies and the UNVERIFIED list including the EPS basis.

### Nits (do not block)
- 💭 `packages/core/src/market/config.ts:53`: the comment says `maxAbsTotalVnd` together with the safe-integer check "guards raw VND or millions read as billions". The raw-VND part holds (×1e9 overflows the safe-integer range). Millions read as billions is caught only when the mis-scaled value exceeds about 9.0e15 VND. A mid-cap with 100 bn revenue sent in millions (100 000) becomes 1e14 VND and passes. Also, `maxAbsTotalVnd` (1e18) is above `Number.MAX_SAFE_INTEGER`, so that bound can never trigger in practice. Reword the comment, and add a line to the ADR's units section saying millions vs billions is caught only by the first-run `--dry-run` check, which the README checklist already covers.
- 💭 The job sleeps `requestDelayMs` before the sector request even for the first symbol. This is harmless, and the impl-log already notes it.

### Follow-ups (out of scope)
- Tighten or replace the totals-scale guard (for example a cross-check of revenue vs EPS × shares once outstanding shares are stored), and update the comment and ADR as in the nit above.
- Replace the synthetic fixtures with real captures after Ming's first `--dry-run`, and confirm the EPS basis, units and the ETF 404 vs `[]` response.
- Paginate `listFinancials` and `listOpenGaps` past the PostgREST 1000-row cap (from the impl-log).
- The plan's follow-up list is still open: `redirect: 'error'` and no-network hardening, a partial unique index on open gaps plus a run lock, a sector refresh interval, a shared symbol-union helper, and a fallback source.

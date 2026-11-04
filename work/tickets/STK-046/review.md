## Attempt 1 — 2026-11-04
Verdict: PASS

### Checks (run by reviewer)
- typecheck: pass, all workspaces (exit 0)
- lint: pass, all workspaces (exit 0)
- test: pass, exit 0. core 42 files / 516 tests, db 14 / 121 + 1 todo, worker 15 / 236, web 25 / 214. These match the impl-log.
- db:check: not runnable here (no Postgres). I read the SQL instead:
  - Migration `20261105000100_data_gaps_resolved_reason.sql`: additive nullable `text` column, the value check `data_gaps_resolved_reason_check`, and `data_gaps_resolved_reason_needs_resolved`. Timestamp sorts last.
  - Rollback drops the column with `if exists`. `scripts/db-check.sh:50` applies rollbacks newest first, so it runs before the table drop.
  - `checks.sql` asserts the column is `text` and nullable (`assert_col(..., false)`), asserts the check constraint exists, and adds two `expect_fail` cases (bogus value with `resolved_at` set; valid reason without `resolved_at`), each expecting 23514. Each targets only the intended constraint: `data_type` has no check, and from/to are valid.
  - Grants and RLS are table-level in `20261023000200_v1_rls_grants.sql`, so the new column needs no grant.

### Acceptance criteria
- [x] AC1: seeded 2025–2027 calendar with a source on every date, and provisional flags. Evidence:
  - `packages/core/src/market/holiday-calendar.ts` holds 38 weekday dates, exactly the plan's list.
  - Every entry has a notice number plus a URL. All 11 URLs appear verbatim in `consult-finance-investment-researcher.md`.
  - The header comment covers one calendar for HOSE/HNX/UPCoM, weekdays only, and the hsx.vn/hnx.vn verification note.
  - Tests in `holiday-calendar.test.ts`: "exact date snapshot (38 dates)", "provisional: every 2027 entry and 2026-11-24, nothing else", "every entry has a name and a source", "covers 2025, 2026 and 2027". All pass.
- [x] AC2: empty or unset settings fall back to the seed, and stored dates are kept. Evidence:
  - `effectiveHolidays` (union, sorted, unique) is applied in `packages/db/src/repos/settings.ts` `getSettings` and all three `getEntrySettings` branches.
  - `getAppSettings` and the save paths stay raw. Test "getAppSettings returns the raw stored holidays, not the seed".
  - Tests "getEntrySettings: row with empty holidays gives the seed; stored dates are unioned" and "no row … holidays: SEEDED_HOLIDAY_DATES". The core tests cover empty/null/undefined, union and no mutation.
  - Every holiday consumer reads `getEntrySettings`: the web loaders for dashboard, watchlist and symbol, and the worker stores at `store.ts:37,56,79`.
  - Only the settings page uses the raw `getAppSettings`, which is intended.
- [x] AC3: holiday-only gaps are resolved (not deleted) with a reason, and gaps that cover a trading day stay open. Evidence:
  - `holidayOnlyGapIds` is in `price-gaps.ts` and never looks at stored prices. Tests cover Tết resolves, the 2026-02-13…02-23 gap stays open, weekend-only, an empty holiday list, and sorted/unique output.
  - `resolveGaps` adds `resolved_reason` only when a reason is given and keeps `.is('resolved_at', null)`. The test asserts no `delete` call.
  - The EOD step splits gaps by reason. The tests "…resolved with reason non_trading_day, not deleted" and `reason: 'data_stored'` pass.
  - `resolve-holiday-gaps` job tests cover: dry-run writes nothing, only holiday-only ids get `non_trading_day`, unwatched and NULL-symbol gaps are included, chunking, and the empty case.
  - `listAllOpenGaps` has no symbol filter and pages by id (test).
- [x] AC4: the unit tests listed above exist and pass, and typecheck, lint and test are green (my run).

### Issues
None.

### Rules R1–R10
No violations found.
- R1: the calendar, union and gap rule are in core.
- R3: worker and service client only; no web change.
- R4: gaps are resolved, never deleted; a reason is recorded; real trading days stay open.
- R5: the calendar is configuration, with the seed as default plus `settings.holidays`.
- R6: suspended; no auth added.
- R7: every changed file is in the plan's list (plus workflow files).
- R8: green, and the new core logic has tests.

### Nits (do not block)
- `apps/worker/src/jobs/resolve-holiday-gaps.ts:6` re-exports `PRICES_GAP_TYPE`, but nothing imports it from there (`store.ts` takes it from `./jobs/eod-sync`). It can be dropped.
- `checks.sql` asserts only `data_gaps_resolved_reason_check` by name. The `_needs_resolved` constraint is covered only by its `expect_fail`. That is enough, but a name assertion would be symmetric.
- `settings.test.ts` "getSettings" union case is vacuous, because 2026-01-01 is already seeded. Union behaviour is covered elsewhere.

### Follow-ups (out of scope)
- Re-check HOSE/HNX notices for 2026-11-24 by about 2026-11-17 (D3). Remove the date in code if the market trades.
- Verify every seeded date against the original hsx.vn / hnx.vn notices before go-live. Replace the 2027 provisional entries when the exchanges publish their calendar.
- Deploy order: apply migration `20261105000100` before the worker image runs. The PR body must repeat this.
- The security auditor should run at REVIEW, because a migration is in the diff.

# STK-046 security review, attempt 1

## Security review: STK-046 attempt 1

**Verdict: no blocking findings (no 🔴).** Two 🟡 items to note in the PR and two 🟢 nits.

Limits: I had no shell, so I could not run `git diff`. I read the files the plan lists, I did not run `pnpm db:check`, and I opened no `.env` files.

### Findings

**🟢 RLS and grants are fine.** `/home/user/stoktok/supabase/migrations/20261105000100_data_gaps_resolved_reason.sql:2-5`
- The migration only adds a nullable column and two check constraints. It changes no grants or policies.
- Access stays as STK-003 set it in `/home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql:6-10`: RLS is on, there are no policies, anon and authenticated have all access revoked, and service_role has table-level select/insert/update/delete. Those table-level grants cover the new column, so no column grant is needed. anon cannot read or write it.

**🟢 The migration is safe to run.**
- Adding a nullable column with no default only changes table metadata.
- Both checks pass on existing rows, because every existing `resolved_reason` is NULL.
- The `needs_resolved` check stops a row from carrying a reason while still open.
- The rollback at `/home/user/stoktok/supabase/rollback/20261105000100_data_gaps_resolved_reason.down.sql:1` uses `drop column if exists`, which also drops both constraints. The only data it loses is the reasons, which is acceptable.

**🟢 Service role stays server-side (R3).**
- `createServiceClient(process.env)` appears only in the worker entry point (`/home/user/stoktok/apps/worker/src/cli.ts:69`).
- The new store wiring is at `/home/user/stoktok/apps/worker/src/store.ts:54-60`.
- No web, `NEXT_PUBLIC_*`, env or compose files change.

**🟢 Gaps are resolved, never deleted.**
- `resolveGaps` at `/home/user/stoktok/packages/db/src/repos/data-gaps.ts:60-65` is an `update`, filtered by `.in('id', ids)` and `.is('resolved_at', null)`, so a rerun cannot overwrite an earlier `resolved_at`.
- No `.delete()` on `data_gaps` exists anywhere in apps, packages, supabase or scripts.
- `listAllOpenGaps` (`data-gaps.ts:35-50`) only reads.
- The job at `/home/user/stoktok/apps/worker/src/jobs/resolve-holiday-gaps.ts:48-53` makes no write in dry-run. Every chunk of a real run uses the same `resolvedAt`, so one run can be reversed precisely.
- The financials store still calls `resolveGaps` without a reason (`store.ts:71`), so that job is unchanged.

**🟢 CLI input handling is fine.** `/home/user/stoktok/apps/worker/src/cli.ts:21-57`
- Jobs come from an allowlist, and unknown flags print usage and exit with code 2.
- `--dry-run` cannot be given twice.
- `--backfill` and `--source` are rejected for `resolve-holiday-gaps` (lines 33 and 47).
- No user-supplied value reaches SQL. Ids come from DB rows, and PostgREST parameterizes the filters.

**🟡 A wrong holiday date hides a real gap, with no tool to undo it (R4).**
- `holidayOnlyGapIds` (`/home/user/stoktok/packages/core/src/market/price-gaps.ts:76-79`) trusts the effective calendar, which is the seed plus Ming's stored `settings.holidays` (`effectiveHolidays`, `holiday-calendar.ts:87-89`, with no validation of stored dates).
- If a provisional date turns out to be a trading day (2026-11-24 and all of 2027, decision D3), any open gap covering only that day gets resolved. The EOD job also never records a new gap for that date.
- The data is not destroyed, only marked resolved. Undoing it is a manual SQL step: `update public.data_gaps set resolved_at = null, resolved_reason = null where resolved_reason = 'non_trading_day' and resolved_at = '<run ts>'`.
- Recommendation: put this one-line undo in the README/PR next to the first-run procedure (dry-run, then Ming reviews the list, then the real run). Keep the "re-check 2026-11-24 by ~11-17" follow-up. Related to AC3 and R4.

**🟡 If the new worker image runs before the migration, gap updates fail.** `eod-sync.ts:245-246`
- Without the column, the EOD job's `resolveGaps(..., 'data_stored' | 'non_trading_day')` fails with an unknown-column error after the prices have already been upserted, and the job exits 1.
- This is planned and documented. Make sure the PR body says "apply the migration before deploying the image".

**🟢 Nit: one db-check error lacks the standard prefix.** `/home/user/stoktok/scripts/db-check/checks.sql:106`
- It raises `'data_gaps_resolved_reason_check missing'` without the `CHECK FAILED:` prefix that the header (line 1) and every other check use.
- The `data_gaps_resolved_reason_needs_resolved` constraint is not checked by name. Its behaviour is covered by the expect_fail case at lines 281-283.
- Not blocking.

**🟢 Not from this diff (follow-up only).** `/home/user/stoktok/deploy/deployment-repo/apps/stoktok/run-job.sh:3`
- The usage comment does not list the new job. The script forwards whatever job name it gets, so the new job works.
- `$JOB` is used unsanitized in the log path (line 16). The operator runs this script, so the risk is low.

### Recommendations
1. In the README/PR, add the targeted undo SQL for a wrong holiday-only resolution (AC3, R4).
2. Keep the PR note "migrate before image" (D2).
3. Optionally fix the `CHECK FAILED:` prefix at `checks.sql:106` and assert the second constraint by name.

### Risks
- Provisional seed dates can silently resolve real gaps. A dry-run review by Ming before the first real run reduces this risk.
- Stored `settings.holidays` entries are not validated as ISO weekday dates. A bad entry is harmless, but a wrong weekday has the same effect as a wrong provisional date. STK-047 should validate entries on input.

### Open questions
- Should STK-047 add a "re-open gaps resolved as non_trading_day for date X" action when a seeded or stored date is removed? Without it, removing a date does not bring back the gaps it resolved.

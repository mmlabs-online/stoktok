STK-084 consult (data / worker / jobs side of the cutover). Read-only; I ran no commands against the host.

## Findings

**What writes during the dump and restore window**
1. **Scheduled jobs.** launchd agent `online.mmlabs.stoktok.jobs` fires Mon-Fri at 18:30 and 21:00 (/home/user/deployment/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist:21-73). It runs `run-schedule.sh`, which runs `eod-prices financials signals` before 21:00 and `eod-prices signals` from 21:00 (run-schedule.sh:15-27). All of these write: `prices_daily`, `data_gaps`, `financials`, `signals`.
2. **Jobs outside the schedule.** `news`, `financial-statements` and `resolve-holiday-gaps` exist in the CLI (apps/worker/src/cli.ts:23-30) but are not in `run-schedule.sh`. They run only when someone starts them by hand. The ticket's "news" verification therefore needs a manual `run-job.sh news`, unless STK-084 or another ticket adds it to the schedule. Open question 3 covers this.
3. **Job lock.** `run-job.sh` serialises all jobs with an atomic `mkdir /tmp/stoktok-jobs.lock`. It waits up to 30 minutes and then exits 1 (run-job.sh:21-37). Each run is `docker compose ... --profile jobs run --rm stoktok-worker` (run-job.sh:41-42). The worker has `restart: "no"`, so `up -d` never starts it (compose.yml:45-52).
4. **Web writes.** `stoktok-web` has `restart: unless-stopped` (compose.yml:22-24) and also writes (transactions, settings, ai keys, and `ai_usage` through `ai_reserve`). Worker and web share the AI budget ledger (baseline.sql:379, "web and worker"). Stopping only the scheduler is not a write freeze. In the current Supabase release, anything Ming does in the web UI after the dump is lost.
5. **Hand-started jobs.** Someone can run `run-job.sh` by hand at any time. The `bootout` in rec. 1 does not stop that.

**Gaps and the recovery model**
- EOD recomputes the last 20 trading days on each run (config.ts:17; eod-sync.ts:86). Financials recompute 12 quarters. Writes are idempotent upserts (deploy.md:150-153). A downtime of hours or a few days therefore heals itself on the first post-cutover run.
- Missed launchd slots are not queued while the agent is booted out. Coalescing happens only for sleep (deploy.md:153).
- `data_gaps` are recorded only when the source lacks trading days in the window. They are never recorded merely because the system was down (eod-sync.ts:217-244, "a gap is a recorded condition").
- A downtime longer than 20 trading days needs `eod-prices --backfill` (default 260 days, max 520; config.ts:27-29). The financials window is 12 quarters. ADR 0003 states the same limit: "up to the window" (docs/adr/0003-deploy-and-scheduling.md:30).
- Signals read open gaps (medium-signals.ts:90-96). Stale or gapped data produces no signal (R4). Open gaps and old `fetched_at` values restored from Supabase therefore behave as before.

**AI ledger**
- `ai_usage.id` is `generated always as identity`. Spend is `sum(coalesce(cost, reserved))` over `created_at` in the month window, in both `ai_month_spend` and `ai_reserve` (baseline.sql:354-435).
- The ledger continues correctly only if `created_at` is restored unchanged and the sequence is set past `max(id)`. `pg_dump -Fc` and `pg_restore` preserve `created_at`.
- `ai_summaries.usage_id` references `ai_usage(id)` (baseline.sql:452), so restore order matters. `pg_restore` orders by dependency, so this is fine in a single transaction.
- The baseline has exactly 6 identity columns, matching the ticket's "6 identity sequences": `transactions.seq` (baseline.sql:13, a non-primary-key identity), `data_gaps` 103, `signals` 164, `news` 326, `ai_usage` 355 and `ai_summaries` 445. If the sequence is not advanced, the first post-cutover insert fails with a duplicate key. The same happens for `transactions.seq`, which is `unique`.
- `ai_keys` is excluded from the dump, so AI has no provider keys until Ming enters new ones on Settings. Check what the worker and web do when `ai_usage` is full but there are no keys. A refusal row or a hard failure would both be wrong. The `ai_keyring_invalid` acceptance item depends on this.
- A `reserved` row that was never settled stays counted at its worst-case reservation (baseline.sql:375). Rows left behind by a killed worker are carried across and keep eating budget. This is expected, so verify rather than "fix" them.

**Auth dependency**
- Login stays on Supabase Auth in the same stoktok Supabase project (CLAUDE.md Stack, Auth row; deploy.md:56-59). If Supabase Free pauses the project, login breaks even though data is on the shared Postgres. The ticket says "Supabase Free pausing accepted". That acceptance covers the data, but the web would be unusable. Make sure Ming accepted this consequence too.

**Rollback**
- `deploy-stoktok` auto-rollback restores the previous `apps/stoktok/` when web is unhealthy within 120 s, and republishes the scheduler directory (deploy.md:118). That is a rollback to the Supabase release. After the cutover, any data written to the new Postgres is not in Supabase.
- The health check does not touch the DB (ADR 0003 line 15; deploy.md:97). A healthy `/healthz` therefore does not prove the cutover works. Add `/readyz`, as the ticket allows, or use the job dry-run in the smoke list below.

## Recommendations

**1. Freeze order (acceptance 1, "Production keeps working")**
1. Pick a window that avoids the slots: Friday after 21:00 (when the second run has finished), or Saturday/Sunday. A weekend gives about 3 days without a missed slot.
2. Check that no job is running: `ls /tmp/stoktok-jobs.lock; docker ps` (project `stoktok`). Wait for it to finish. Do not `docker kill` mid-run unless you accept re-running it (idempotent, deploy.md:151).
3. Stop the scheduler: `launchctl bootout gui/$(id -u)/online.mmlabs.stoktok.jobs` as `mingming`. Verify with `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs`, which should error. Do not only delete the plist.
4. Stop web: `docker compose -p stoktok stop stoktok-web`. Web has `restart: unless-stopped`, so `stop` holds, but a Docker or OrbStack restart can bring it back. Write "do not reboot" in the runbook. Cloudflare will show a 502.
5. Do not run any deploy in between. `deploy-stoktok` re-loads the LaunchAgent "only when it is new or changed" (deploy.md:46). Check that it compares plist content and not loaded state, or you may find the agent re-enabled unexpectedly.
6. Dump, restore, verify (script `scripts/db-migrate-from-supabase.sh`).
7. Cut the release. The first release deploy runs `migrate` on the already-restored database. The runbook must record that `migrate` after restore has to be a no-op (checksums in the migrations table equal the baseline). Check that the baseline is recorded as applied in the target before the data restore, or `migrate` will try to re-create it. Question: does the dump order allow `pg_restore --single-transaction` into a database where baseline schema + migrations table already exist? That is the plan (schema via the runner, data via the restore).
8. Start web, run verification, then re-enable the scheduler.

**2. Re-enabling jobs**
- Re-run `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/online.mmlabs.stoktok.jobs.plist`, or let the first release deploy do it. The deploy checks whether the plist is "new or changed" (deploy.md:46). Verify with `launchctl print`.
- Re-enabling the scheduler is not the same as the jobs working. Run `run-job.sh eod-prices --dry-run` (deploy.md:97 pattern) before the next slot.
- Check the time zone guard: `run-schedule.sh` refuses to run if `date +%z` is not `+0700` (run-schedule.sh:10-13). It logs to `schedule.log`.

**3. First post-cutover run verification**
- Run once by hand, before the next scheduled slot, in this order: `eod-prices --dry-run`, `eod-prices`, `financials`, `signals`, and `news` if you want it checked (not scheduled).
- Capture counts of `prices_daily`, `financials`, `signals`, `data_gaps`, `news` before the first run. Run the job twice. Row counts must be unchanged after the second run, except for new trading days on the first (deploy.md:150).
- Gaps: `data_gaps` must have no new rows from downtime. Compare open gaps before and after with `select data_type, count(*) from data_gaps where resolved_at is null group by 1`. If the column is not called that, use whichever column the gap table has for "open". New rows are acceptable only for days the source really lacks.
- Signals: one row per symbol per day, and `computed_at` on the new run. A signal for a symbol with an open gap or stale data is a bug (R4).
- Logs: `tail /Users/mingming/stoktok/logs/<job>.log`. Look for `exit=0` and a version equal to the new release (run-job.sh:40,44).

**4. AI budget ledger**
- Before the dump, record on Supabase: `select count(*), max(id), sum(coalesce(cost_micro_usd, reserved_micro_usd)) from ai_usage where created_at >= date_trunc('month', now())`, plus the same without the month filter. After restore, compare on the target. Spend and counts must match exactly.
- After the `setval` step: `select last_value, is_called from <seq>` for `ai_usage`. Next id must be above `max(id)`. For an empty table, `setval(seq, 1, false)`, not `setval(seq, max)`, since `max` is null. Apply the same to all 6 sequences, including `transactions.seq`.
- Prove the ledger continues: after Ming has entered new provider keys, trigger one AI action in the web (or a worker call) and check that a new `ai_usage` row appears with an id above the migrated max and that the Settings card spend equals the old spend plus the new row.
- Check `ai_summaries.usage_id` does not become null for migrated rows (`on delete set null` could mask a restore-order problem): `select count(*) from ai_summaries where generator='model' and usage_id is null` before and after.
- Confirm the logs never contain `ai_keyring_invalid` (acceptance criterion 3), after the new keys are entered on the new master key.

**5. Checks for the migration script (feed to the implementer)**
- Verification must cover `ai_usage` and `ai_summaries` as well as the main tables. Per-table count plus ordered md5 (ticket) is right. Exclude volatile columns only where the ticket says so, which is none.
- Do not run the verification while a job or web could write (they are stopped by then).
- Add a verification that no job lock or in-flight `docker ps` entry exists before the dump. A short script check is cheap: `test ! -d /tmp/stoktok-jobs.lock`.

**6. Smoke checks for Ming after cutover**
1. `docker compose -p stoktok ps`: web healthy, a new start time.
2. `https://<APP_HOSTNAME>/healthz` shows the new version. Then a page that reads the DB (dashboard) loads. `/healthz` alone proves nothing about the DB (deploy.md:97).
3. Log in (Supabase Auth, still on Supabase).
4. Holdings, P&L and transaction history match what you wrote down before the freeze (screenshot or totals for 3-4 numbers).
5. Add and delete one test transaction (or edit a setting) to prove web writes work. Delete it afterwards, or note it.
6. Settings: fee rate and other settings intact. AI keys empty, so enter the new Anthropic/Google keys. The spend card shows the migrated month spend.
7. `run-job.sh eod-prices --dry-run`, then a full `eod-prices` and `signals` by hand (see above).
8. `pg-backup` ran (02:00) and produced a dump of `stoktok`, and the pre-migration dump from the deploy exists.
9. Logs: no `ai_keyring_invalid`, no repeated lock timeouts.
10. Keep the Supabase tables read-only for the rollback window (proposed 14 days). Remember that a rollback loses everything written since cutover.

## Risks
- **Lost writes (high).** If web is not stopped (rec. 1.4), Ming's transactions entered during the window go only to Supabase and are not in the dump. Because transactions are the one table that is not recomputed from market data, that loss cannot be healed by the jobs.
- **Scheduler comes back unexpectedly (medium).** A deploy run, a reboot or a LaunchAgent reload could start a job in the middle of the window. A job writing to Supabase after the dump is harmless to the new database but wastes the run; a job writing to the new database before the verification invalidates the md5 check.
- **Sequences (medium).** A missed `setval` shows up only on the first insert after cutover, probably from the first job or the first web write.
- **Unsettled `reserved` rows (low).** They carry over and keep counting at their worst case.
- **Downtime longer than 20 trading days or 12 quarters (low for a one-evening window).** Needs `--backfill`.
- **First release with a wrong DB URL (medium).** `/healthz` passes with a bad database URL, and the auto-rollback only triggers on an unhealthy web. Without a `/readyz` or a post-deploy dry-run the failure surfaces at the next slot. Open question 1.
- **Free-tier pausing breaks login (medium).** See Auth dependency above.
- **Release rule.** No stoktok release is cut before STK-084 (ticket line 26). The jobs and web therefore run the Supabase release right up to the freeze, so no code change affects the dump window.

## Open questions
1. Should the deploy treat an exit-0 `migrate` when the database is ahead of the image (ticket line 43) as blocking? From the jobs side: yes, block. Otherwise an older worker image keeps running against a newer schema until the next slot.
2. Does the deploy's `agent` step compare the plist content or the loaded state (deploy.md:46)? This decides whether `bootout` survives a deploy in the window.
3. Is `news` meant to be scheduled? It is not in `run-schedule.sh` today (run-schedule.sh:17,19), yet the ticket asks to verify "news". If it is manual, say so in the runbook.
4. Is there a `/readyz` planned (ticket line 15, "if the deploy health check needs it")? From the jobs side I recommend yes, so that a bad URL stops the deploy.
5. Rollback window: 14 days (ticket line 40). Confirm whether Supabase Free pausing (a Free project pauses after a week of inactivity) is acceptable given login stays on it.
6. Can Ming do the cutover on a weekend? It removes any slot conflict and any 20-day window concern.

Files read: /home/user/stoktok/work/tickets/STK-084/ticket.md, /home/user/stoktok/docs/deploy.md, /home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md, /home/user/stoktok/apps/worker/src/cli.ts, /home/user/stoktok/apps/worker/src/config.ts, /home/user/stoktok/apps/worker/src/ai.ts, /home/user/stoktok/apps/worker/src/jobs/eod-sync.ts, /home/user/stoktok/apps/worker/src/jobs/medium-signals.ts, /home/user/stoktok/db/migrations/20261111000200_baseline.sql, /home/user/deployment/apps/stoktok/run-job.sh, run-schedule.sh, compose.yml, launchd/online.mmlabs.stoktok.jobs.plist.

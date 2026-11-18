# STK-096 review

## Attempt 1 — 2026-11-18
Verdict: REWORK

Reviewed commit 5e8f370 (implementation). The branch head is 5fb472e, which adds only `security-review.md`. Diff: `git diff origin/main...HEAD`.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` passes (exit 0).
- lint: `pnpm lint` passes (exit 0).
- test: `pnpm test` passes. core 834, sources 35, ai 184, db 158, worker 310, web 360. The per-package counts match impl-log.
- test:db: run against a throwaway local PG 16.15 on 127.0.0.1:55497 (`DB_TEST_URL`). 26 files, 148 tests passed. The server was stopped and its data dir deleted afterwards.
- db:check: `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n` passes on both scripts. The `t_static` bash-4/GNU pattern list has 0 hits on both files.
- test:move, local run. There is no Docker daemon here, so I used a reviewer-owned host `docker` stand-in in the scratchpad. It runs the PG 16 client tools on the host, maps `/work`, `/secrets` and `/certs/root.crt`, reports client 17, and answers `image inspect` with a fake `@sha256` digest. Tests ran from a scratch copy of the repo. That copy has the two scripts copied, and its copy of the script has `-ge 170000` changed to `-ge 160000`; everything else is symlinked. The committed scripts were not touched (`git status` is clean).
  - I ran 12 tests: `t_usage_guards t_schema_migrations_mismatch t_dry_run_happy t_verify_only t_refuse_non_empty t_force t_schema_drift t_column_pipe t_column_pipe_newline t_extra_source_table t_client_image_pin t_sslrootcert`. Result: 110 ok, 0 FAIL, `test:move OK`.
  - `t_static` and `t_freeze` were not run here (they need real docker).
- test:move, CI. PR #74 run 44218849058 on head 5fb472e, job `ci`: every step succeeded, including typecheck, lint, test, test:db, check:service-key, check:deploy-env, db:check and test:move. The test:move log lists all 14 tests, including `t_static` and `t_freeze`, with no `FAIL` and no `skip:`. So `t_client_image_pin` really ran with the pulled `postgres:17` digest.
  - **These rest on CI only:** `t_static`, including the bash:3.2 `bash -n`; `t_freeze`; test:move against PG 17 with real docker; `t_client_image_pin` with a real RepoDigest.
  - At review time the `images (web)` job of that run was still in progress; `images (worker)` had succeeded.

### Focus items from the orchestrator
**(a) The `cleanup()` deviation (script:146).**
- Every `usage_err` call is before `trap cleanup EXIT` (script:152). `grep` finds no `usage_err` and no `exit 2` after line 140.
- Usage errors still exit 2 and print no `FAILED at step`. Measured with `setsid -w`:
  - no source password and no tty: rc=2;
  - unknown flag: rc=2;
  - `--target postgres`: rc=2.
  - `t_usage_guards` (16 exit-2 asserts plus "no docker call") passes.
- After the trap, the only new behaviour is that a tool exit code 2 now prints `FAILED at step: <step>` and exits 1. Example: psql cannot connect.
  - Before, an unreachable pooler exited 2 silently. That contradicted the doc's "2 usage error (nothing was contacted)".
  - Paths that already printed `FAILED` are unchanged: `fail`, INT/TERM/HUP, and `dry run FAIL` followed by `FAILED at step: summary`.
  - I found no new misleading message.
- Mutation M5: restoring `&& [ "$rc" -ne 2 ]` makes `t_client_image_pin` fail (3 FAIL). So the deviation is needed for the plan's own test spec. It is justified in impl-log and stays in a planned file.

**(b) Runbook commands and messages against the script and the deployment repo.**
- Every message the runbook quotes is in the script (`grep -cF`):
  - `dry run OK`, `dry run FAIL: schema check found differences`, `schema check: no unexpected differences`;
  - `schema_migrations matches db/migrations`, `identity sequences`, `sequences: `, `verified `, `ai_keys is empty on the target`;
  - `move OK`, `dump kept:`, `FAILED at step:`, `freeze the apps first`, `is not empty`;
  - `verification failed; writers may be running`, `the worker image migrations differ from this checkout`, `PG_CLIENT_IMAGE must be pinned by digest`, `current_database=`.
- Flags in the section (`grep -oE -- '--[a-z-]+'`): the script flags `--target --worker-image --dry-run --schema-check --force --confirm --keep-dump --verify-only`, plus the git/docker flags `--branch --depth --tags --exact-match --filter`.
- These match `/home/user/deployment` (and the drafts, which are byte-identical to the live files):
  - `postgres` service, `pgvector/pgvector:pg17-trixie` (postgres/compose.yml:26,31), `pg-backup`;
  - `PROJECT: stoktok`, `SCHED_DIR: /Users/mingming/stoktok/current`, `AGENT_LABEL: online.mmlabs.stoktok.jobs`, the plist under `~/Library/LaunchAgents` (deploy-stoktok.yml:48-53,359-404);
  - the step names pull/backup/migrate/deploy/publish/agent, `--wait-timeout 120`, and the notify texts "deployed: … healthy", "Scheduler NOT installed", "Database is ahead" (yml:439-447);
  - `restore-unpushed`;
  - the lock `/tmp/stoktok-jobs.lock`, `end job=… exit=… version=vX.Y.Z` (run-job.sh), and `STOKTOK_VERSION=vX.Y.Z` in release.env;
  - the `stoktok-web` service and `:3000`;
  - `/healthz` returning `version` and `/readyz` returning `{"status":"ok"}` (apps/web/app/*/route.ts);
  - `up to date` (packages/db/src/pg/migrate.ts:181);
  - the table and column names in every `pgro` query (baseline migration);
  - the `last/` 24 h retention and offsite `daily/weekly/monthly` only (RESTORE.md, rclone-sync.sh:74-84).
- Mismatch: `schedule.log`. See Issue 2.

**(c) No Supabase write, no secret.**
- The AC 13 grep hits only prose, the create/drop of `stoktok_scratch` via the shared Postgres container, and stage 9.3. Stage 9.3 is STK-095's Vault deletion, in prose; see nit N5.
- `pgro` is a read-only transaction on the shared Postgres.
- The `--worker-image` migrate gets only `MOVE_DST_*` (script:243-244).
- The AC 14 secret grep prints nothing on `docs/deploy.md` and `work/ming-todo.md`. `MOVE_SRC_PGPASSWORD=` never appears with a value. `docker inspect` is used only with `-f`.

**(d) Regression tests fail against the old code.**
- I ran the new harness against the ba1f2b5 (STK-091 attempt 2) script, in the scratch copy:
  - `t_column_pipe_newline`: FAIL on "says so". The old code let `a|b<LF>c|d` through to SQL generation: `ERROR: syntax error at or near "C" … ROW(b)::text) collate "C"`. That is the F3 bypass reproduced.
  - `t_extra_source_table`: FAIL on "says it is not a target data table". The old code reached `permission denied for table zzz`.
- Both pass against the new script, and both pass when run alone from a fresh harness.
- Mutations on the current script:
  - drop the line/list checks → `t_column_pipe_newline` gets 2 FAIL;
  - drop the membership `case` → `t_extra_source_table` gets 2 FAIL;
  - neutralise the F4 `usage_err` → `t_usage_guards` gets 3 FAIL (exit 2, "pinned by digest", no docker call);
  - put the cert on every leg → `t_sslrootcert` gets 3 FAIL.

### Acceptance criteria
- [x] 1. Section and stages 0-9 in order: docs/deploy.md:128-234 (`### 0. Preconditions` … `### 9. Day +14 (STK-095)`).
- [x] 2. Real flags, env names and messages: evidence under (b).
- [x] 3. Dry run: docs/deploy.md:153-161. It covers the scratch DB created as owner `stoktok`, `/bin/bash` and tmux (stage 0.10), the schema check, the drop `with (force)`, and dump and pgpass leftovers.
- [ ] 4. Freeze: the content is at docs/deploy.md:163-170, but the check for "the 21:00 run has finished" points at a log that never records it. See Issue 2.
- [x] 5. Move: docs/deploy.md:172-179.
- [x] 6. Release: docs/deploy.md:181-184. The step names and texts match deploy-stoktok.yml.
- [x] 7. Verify and smoke: docs/deploy.md:186-198. Every `pgro` query is a SELECT.
- [x] 8. AI keys: docs/deploy.md:200-205.
- [x] 9. After a successful cutover: docs/deploy.md:207-211.
- [ ] 10. Rollback per stage: the row "Release, `migrate` failed" is unsafe; see Issue 1. The "Inside the 14 days" re-cutover wording is also risky; see Issue 3.
- [x] 11. Day +14: docs/deploy.md:225-232.
- [x] 12. Work dir mode 700, `tmutil addexclusion`/`isexcluded`, offsite scope: docs/deploy.md:146.
- [x] 13. No Supabase write: evidence under (c).
- [x] 14. No secret: evidence under (c).
- [x] 15. F4: script:102-105. `t_usage_guards` asserts at harness:178-180, `t_client_image_pin` passes (local and CI), and mutation M3 fails it. The runbook step is stage 0.6.
- [x] 16. F7: script:106-114 and 183-210. `t_usage_guards` cert asserts and `t_sslrootcert` pass, and mutation M4 fails it. See nit N1 about `pg_restore -l`.
- [x] 17. `t_column_pipe_newline` and `t_extra_source_table` are self-contained and fail on ba1f2b5: evidence under (d).
- [x] 18. docs/deploy.md:124: "The verify step reads the target in a read-only transaction too."
- [x] 19. docs/deploy.md:95,103,108,115-117 and the Roll back line at :260.
- [x] 20. ming-todo stages 0-7 have the same names and order. Day +14 equals stage 9. `grep srv/apps` prints nothing.
- [x] 21. check:deploy-env OK.
- [x] 22. Checks green: local runs plus CI run 44218849058.

### Issues
#### Issue 1 — 🔴 blocker — data integrity (rollback row "Release, `migrate` failed")
- **Where**: docs/deploy.md:219.
- **Expected**: the rollback leaves deployment `main` and the server consistent, so that no later deploy can move production to a stale database.
- **Actual**:
  - When `migrate` fails, `deploy`, `publish` and `rollback` are skipped (deploy-stoktok.yml:291-315; `rollback` only runs when `steps.deploy.outcome == 'failure'`). Deployment `main` still pins vX.Y.Z.
  - The row says to start v0.2.1 web by hand, bootstrap the agent, and "Do not merge again".
  - The next `deploy-stoktok` run would migrate and deploy vX.Y.Z on Postgres (frozen copy) while v0.2.1 has been writing to Supabase. Production would silently switch to stale data, and the writes would be split. Triggers for that run: any `apps/stoktok/` merge, or the `workflow_dispatch` that stage 6.3 and the key-rotation sections tell Ming to run.
  - The workflow's error "the old release is still running" (yml:283) is also false during the freeze, because web is stopped.
  - The security review raised the same point as S1. I confirmed it independently against the workflow.
- **Fix instruction**: rewrite the row's "Do" cell.
  1. Revert the release PR's merge commit in a deployment PR and merge it. That redeploys v0.2.1 (no migrate service) and runs `agent`, which restarts web and the scheduler.
  2. Only if that run does not start web, start it and bootstrap the agent by hand as in Freeze.
  3. Report the failure.
  
  Add one line to stage 4.1: during the freeze, ignore the workflow's "the old release is still running"; web is stopped.

#### Issue 2 — 🟡 should-fix — wrong check command in the freeze window
- **Where**: docs/deploy.md:164 (also plan.md:169).
- **Expected**: the command shows whether Friday's 21:00 run has finished.
- **Actual**: `schedule.log` is written only on a wrong time zone (deployment `apps/stoktok/run-schedule.sh:11`). Each job's start and end lines go to `<job>.log` (run-job.sh `LOG="$LOG_DIR/$JOB.log"`). The 21:00 run is `eod-prices` then `signals` (run-schedule.sh:15-20), so `tail schedule.log` cannot show that it finished.
- **Fix instruction**: replace `tail /Users/mingming/stoktok/logs/schedule.log` with `tail -n 2 /Users/mingming/stoktok/logs/signals.log`. Expect an `end job=signals exit=… ` line timestamped after today's 21:00 run started (UTC timestamps, 14:00Z). Keep stage 2.4's lock and `docker ps` checks as the real gate.

#### Issue 3 — 🟡 should-fix — re-cutover `--force` can destroy the only copy of post-cutover data
- **Where**: docs/deploy.md:221 (and :217, "Before the next attempt … use `--force --confirm stoktok`").
- **Expected**: after a revert inside the 14 days, Postgres still holds rows that exist nowhere else until Ming has re-entered them on v0.2.1. The runbook must keep them safe before anything truncates `stoktok`.
- **Actual**: the row says a later re-cutover repeats stages 2-4 with `--force --confirm stoktok`, which truncates every table. It does not say to save a dump first or to wait for the re-entry. The revert itself is also not preceded by a freeze, so a job can still write to Postgres during it.
- **Fix instruction**: in the "Inside the 14 days" row:
  1. Do the stage 2 freeze first.
  2. Copy the newest `~/srv/backups/postgres/last/stoktok-*.dump` (or take one with `pg-backup /backup.sh` first) into `~/srv/backups/stoktok-cutover/` with mode 600.
  3. Then revert.
  4. Use `--force --confirm stoktok` for a re-cutover only after the hand re-entry is confirmed.
  
  The security review raised this as S2.

### Rules R1–R10
- No violations found.
- R3: no credential reaches docs, output or argv. The `pgpass` file stays as in STK-091, and the cert content is never printed.
- R7: the files changed in 5e8f370 are all in the plan's file list. The `cleanup()` change is justified (see (a)).
- R8: the script change is covered by test:move. There is no `packages/core` change.
- R10: Supabase is read only via `src_dump`/`src_ro`.
- R1, R2, R4, R5, R6 and R9 do not apply.

### Nits (do not block)
- N1: script:359 `pg_run none pg_restore -l` inherits `PG_CERT_CUR="$SRC_CERT"` from the preceding `src_dump`, so the CA file is mounted into the TOC container too. This is harmless: network `none`, a public CA, read-only. But docs/deploy.md:115 and the header say "source legs only". Add `PG_CERT_CUR=""` (and `PG_SSL_CUR="prefer"`) before line 359.
- N2: the `t_usage_guards` cert asserts (harness:183-193) check only `rc_is 2`, not each guard's message. A guard firing for the wrong reason would still pass. Add `out_has` for each message.
- N3: docs/deploy.md:182 `ls -t …/last/stoktok-*.dump | head -n 1` can pick the `stoktok-latest.dump` symlink (RESTORE.md: "plus `<app>-latest.dump` symlinks"). `cp` follows it, so the content is right but the name is `stoktok-latest.dump`. Use `ls -t …/last/stoktok-[0-9]*.dump`.
- N4: the scratch DB is created without `revoke all on database stoktok_scratch from public`, unlike `app-db.sql`. Other app roles can connect to it, though they cannot read its tables. Consider adding the revoke to stage 1.1.
- N5: stage 9.3 (Vault deletion) reads as a runbook action on Supabase. Label it as Ming's dashboard step per STK-095 (security S4).
- N6: stage 0.6 does not say what to do when the running Postgres image ID differs from the local tag's ID. For example: use the digest of the running container's image, `docker image inspect -f '{{index .RepoDigests 0}}' <that id>`.

### Follow-ups (out of scope)
- Ming verification after merge, which the PR should carry:
  - the live dry run: pooler reachability from OrbStack with `require`/`verify-*`, the source major version, the FK order of the real restore, the schema-check result, and pgpass/work-dir bind-mount permissions with `--user`;
  - the `--worker-image` leg with the real release image;
  - one run under macOS `/bin/bash` 3.2 inside tmux;
  - `docker compose -p stoktok stop|start stoktok-web` by project name alone.
- Security review S3 (F7 fallback to `require`), S5 (do not use the site before the deploy comment arrives) and S6 (digest-enforce `--worker-image`): for the orchestrator to fold in or ticket. S6 is a follow-up by its own wording.
- CLAUDE.md "Current state" changes after the cutover (STK-094/095).

### Security blockers (orchestrator, from security-review.md Attempt 1)
- 🔴 S1 (`docs/deploy.md:219`): same as Issue 1 — revert the release PR's merge commit before starting v0.2.1 by hand; "the old release is still running" is false during the freeze.

## Attempt 2 — 2026-11-18
Verdict: REWORK

I reviewed rework commit 1d7304b, which changes only `docs/deploy.md`; its impl-log is "Attempt 2". The local branch head is c33fc24, which adds only `security-review.md` Attempt 2 on top of 6a5f969 (`work/backlog.md` and `ticket.md`). `git diff --name-only 09c0ee4..HEAD` lists `docs/deploy.md`, `work/backlog.md`, `work/tickets/STK-096/impl-log.md`, `work/tickets/STK-096/ticket.md` and, through c33fc24, `security-review.md`. No script and no code changed.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exited 0.
- lint: `pnpm lint` exited 0.
- test: `pnpm test` exited 0. Counts: core 834, sources 35, ai 184, db 158, worker 310, web 360. They match the impl-log, except that the impl-log does not list the core and sources counts.
- check:deploy-env: `OK: deploy env lists consistent`, exit 0.
- `bash -n` passes on every file in `scripts/*.sh`, including `db-migrate-from-supabase.sh` and `test-db-migrate-from-supabase.sh`.
- test:db, db:check and test:move: I did not re-run them, because no script, migration or package changed since Attempt 1 (5e8f370). The Attempt 1 evidence still applies: CI run 44218849058 was green.
- CI on PR #74:
  - The PR head is no longer 6a5f969. It is now c33fc24 (`security review attempt 2`, which changes only `security-review.md`).
  - Run 44219855477 on 6a5f969 was **cancelled** after typecheck and lint succeeded; `test` was cancelled and later steps were skipped. A newer push superseded it.
  - Run 44220032081 on c33fc24 was `in_progress` (typecheck running) when I wrote this review.
  - **So there is no green CI result for the current head yet.** The only code-relevant CI evidence is 44218849058 on 5fb472e, and the diff since then is docs and work files only.

### Verification of the rework against the real workflow
I compared against `/home/user/deployment/.github/workflows/deploy-stoktok.yml` and `apps/stoktok/*`. The drafts in `deploy/deployment-repo/apps/stoktok/` (`compose.yml`, `run-job.sh`, `run-schedule.sh`) are byte-identical to them (`cmp`).

- **Issue 1 / S1, fixed.** `docs/deploy.md:219` now reverts the release PR's merge commit first. I traced the revert run:
  - Its push touches `apps/stoktok/`, so the workflow is triggered (yml:33-36).
  - The reverted compose is the current deployment compose. It has no `migrate` service (compose.yml:21-22, services `stoktok-web` and `stoktok-worker` [profile jobs]). So `pull` sets `migrate=false` (yml:252-257), and `backup` and `migrate` are skipped (`if: steps.pull.outputs.migrate == 'true'`). Nothing is migrated.
  - `deploy` runs, because its condition is `migrate != 'true'` (yml:291-300). `up -d --wait --wait-timeout 120` starts the stopped `stoktok-web` with the v0.2.1 image from `release.env` (v0.2.1, digest-pinned).
  - `publish` copies the v0.2.1 job files to `SCHED_DIR` (yml:302-311).
  - `agent` (yml:359-404) runs because publish succeeded. It finds the label not loaded, since it was booted out at freeze, and bootstraps it. So web and the scheduler restart, on Supabase.
  - The claim "deploy, publish and rollback are skipped" on the failed run is correct:
    - `deploy` is skipped because migrate failed.
    - `publish` has no status function, so `success()` is implied and it is skipped.
    - `rollback` needs `steps.deploy.outcome == 'failure'`, and deploy was skipped.
    - `agent` needs `publish == success`, so it is skipped too.
  - The stage 4.1 sentence about "the old release is still running" is right. That string is in the backup error, the migrate error and the notify `migrate-failed` text (3 hits in the yml).
  - Remaining gap: see Issue 1 below.
- **Issue 2, fixed.** Stage 2.1 now says `tail -n 2 /Users/mingming/stoktok/logs/signals.log`.
  - `run-job.sh` writes `LOG="$LOG_DIR/$JOB.log"`, and its last line is `end job=$JOB exit=$code version=…` (run-job.sh:16,44).
  - The 21:00 run is `eod-prices signals`, in sequence (run-schedule.sh:15-20). So signals ending means the run has finished.
  - `now()` is `date -u`, so "UTC, so 14:00Z" is correct for 21:00 +07.
  - `schedule.log` no longer appears in the runbook.
- **Issue 3 / S2, fixed.** `docs/deploy.md:221` now orders the steps as freeze, then copy a dump, then revert, and allows `--force` only after the re-entry is confirmed.
  - The glob `stoktok-[0-9]*.dump` matches `<app>-YYYYMMDD-HHMMSS.dump` in `last/`. It excludes `stoktok-latest.dump` and `stoktok_scratch-*` (RESTORE.md:18-19).
  - The `:217` Freeze row's `--force` is now scoped to "no post-cutover data exists yet".
- **S3, fixed.** `:148` now says to re-download the cert and re-check `MOVE_SRC_HOST`, and to treat the password as exposed if falling back. Remaining gap: see Issue 2 below.
- **S4, fixed.** `:228` is labelled as Ming's Supabase-dashboard step.
- **S5, fixed.** `:181` says "Do not use the site until that deploy comment arrives".
- **Quoted messages.** Every script message the runbook quotes is still in `scripts/db-migrate-from-supabase.sh` (`grep -cF` ≥ 1 for all 17). The workflow strings are in deploy-stoktok.yml: "the old release is still running", "Scheduler NOT installed", "Database is ahead", "deployed: ", `restore-unpushed` and `wait-timeout 120`. `up to date` is at migrate.ts:181, and `end job=` at run-job.sh:44.
- **No secrets.** `git show 1d7304b` adds placeholders only. It adds no `sb_secret_` value, no JWT, no 64-hex digest, no credential URL and no `MOVE_SRC_PGPASSWORD=` value. The security review Attempt 2 grep agrees.
- **ming-todo.** It agrees with the runbook. "Move to the shared Postgres" stages 0-7 and Day +14 have the same names and order as runbook stages 0-7 and 9. The rework changed nothing that the checklist states: the cert fallback, the rollback rows and the signals check are not in it, and "optional root cert" still holds. Stage 9.3 is a Supabase-dashboard step in both.

### Acceptance criteria
- [ ] 1. Every stage, with real flags and messages. The flags and messages are verified above. But the rollback rows are not complete; see Issues 1 and 2.
- [x] 2. No Supabase migration or write, and no secret. Stage 9.3 is now labelled as Ming's dashboard step. The secret grep is clean.
- [ ] 3. Checks green. Local typecheck, lint, test, check:deploy-env and `bash -n` are green. CI for the current PR head (c33fc24) has not finished. The run for 6a5f969 was cancelled.

### Issues
#### Issue 1 — 🟡 should-fix — rollback: the revert run can bring back vX.Y.Z, and the runbook does not check for that (security Attempt 2 N1)
- **Where**: `docs/deploy.md:219` (row "Release, `migrate` failed") and `:221` (row "Inside the 14 days").
- **Expected**: after the revert, Ming checks that v0.2.1 is the release running before production is called rolled back.
- **Actual**:
  - In the revert run, `github.event.before` is the release merge commit, so `previous` is the vX.Y.Z web image (yml:123-128).
  - If v0.2.1 fails its 120 s `--wait`, `rollback` restores `apps/stoktok/` from that commit. It starts vX.Y.Z on Postgres without `migrate` (in the migrate-failed case, Postgres may be half-migrated), republishes the vX.Y.Z scheduler, reinstalls the agent and pushes "Restore stoktok vX.Y.Z" (yml:313-356, 359).
  - Row `:219` only says "Only if that run does not start web …". In this case web did start, but on the release Ming meant to back out of. That is the S1 split-database harm again, through an unlikely route.
- **Fix instruction**: in both rows (`:219` after "restarts web and the scheduler", and `:221` after step (3)), add one sentence:

  > The revert run's PR comment must read `deployed: ...v0.2.1... healthy`; on `restored` or `restore-unpushed` (vX.Y.Z is back), or anything else, freeze again (stage 2.3-2.5) and report; do not use the site.

  Change "Only if that run does not start web" to "Only if that run ends without starting any web (e.g. `did-not-complete`)".
#### Issue 2 — 🟡 should-fix — the S3 fallback relies on a rotation that only runs after a successful cutover (security Attempt 2 N2)
- **Where**: `docs/deploy.md:148` (stage 0.8) and `:209` (stage 7.1).
- **Expected**: if the dry run falls back to `require`, the Supabase DB password is rotated whatever the cutover outcome.
- **Actual**:
  - `:148` says "treat the Supabase DB password as exposed: the rotation in stage 7.1 covers it".
  - Stage 7 is "After a successful cutover". After a Freeze, Move failed or Release rollback, 7.1 never happens, so the possibly exposed password stays valid.
- **Fix instruction**: in `:148`, replace "the rotation in stage 7.1 covers it" with:

  > rotate it as in stage 7.1 after the last script run, whatever the outcome (also after a rollback)

  Optionally add "do 7.1 if stage 0.8 fell back" to the Freeze and Move failed rows.

### Rules R1–R10
- No violations found.
- R7: the rework touched only `docs/deploy.md` plus work files, all within the plan.
- R3: no credential appears.
- R10: Supabase is only read. Stage 9.3 is marked as a dashboard step.
- R8: no code changed.

### Nits (do not block)
- N1 (from Attempt 1 N3, still open): stage 4.2 `:182` still uses `ls -t …/last/stoktok-*.dump`. It can pick the `stoktok-latest.dump` symlink. Use `stoktok-[0-9]*.dump`, as `:221` now does.
- N2: `:221` step (2) makes the fresh `pg-backup /backup.sh` optional. After the freeze it is the only dump that holds the writes made since 02:00. Make it "take one with `docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T pg-backup /backup.sh`, then copy the newest". Postgres itself is not wiped before `--force`, so this is not a blocker.
- N3: `:221`: if a fix-forward release was merged after vX.Y.Z, reverting the release PR no longer gets back to v0.2.1. With Issue 1's check in place, this would be caught.
- N4: the impl-log check results omit the core and sources test counts. They are correct (834 and 35).

### Follow-ups (out of scope)
- These carry over from Attempt 1 and stay as they were: S6 (digest-pin `--worker-image`), nits N1, N2, N4, N6 → STK-094 notes; Ming's post-merge verification list.
- The PR needs a green CI run on its final head before DONE. The run for 6a5f969 was cancelled; 44220032081 on c33fc24 is pending.

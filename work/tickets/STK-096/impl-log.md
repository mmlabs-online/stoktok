# STK-096 impl-log

## Attempt 1

### Files touched
- `docs/deploy.md`: new `## Cutover runbook (STK-096)` (stages 0-9, after "Data move script"); line 95/103/108 now point to it; `MOVE_SRC_SSLROOTCERT` and the digest rule added to the script reference; verify-step sentence split (AC 18); one line in "Roll back". Required because: AC 1-14, 18, 19.
- `scripts/db-migrate-from-supabase.sh`: F4 digest guard (remote source only), F7 `MOVE_SRC_SSLROOTCERT` guards and source-only mount (`PG_CERT_CUR`), header comment. Required because: Ming's F4/F7 note.
- `scripts/test-db-migrate-from-supabase.sh`: new `t_usage_guards` asserts, `drift_set_last_col` helper, `t_column_pipe` and `t_column_pipe_newline` rewritten self-contained (newline case is `a|b<LF>c|d`), new `t_extra_source_table`, `t_client_image_pin`, `t_sslrootcert`; `ALL` extended. Required because: AC 15-17.
- `work/ming-todo.md`: cutover block = one checkbox per runbook stage 0-7, day +14 = stage 9, `run-job.sh` path fixed. Required because: AC 20.

### Deviation from the plan (one line, in-scope file)
`cleanup()` in the script treated exit code 2 as a usage error and printed no `FAILED at step:`. After the trap is installed only a tool can return 2 (psql connection failure), so a pooler that is unreachable exited 2 with no step. Removed the `rc != 2` condition so any failure after the trap prints `FAILED at step:` and exits 1. All `usage_err` calls run before the trap, so exit 2 for usage is unchanged. Without it `t_client_image_pin` (exit 1, `FAILED at step: preflight`) could not hold and the runbook's "any other FAILED at step" would not cover an unreachable source.

### Tests added
See files above. Mutation proofs (run, not committed): removing the two `list_re` checks makes `t_column_pipe_newline` FAIL; removing the membership `case` makes `t_extra_source_table` FAIL; disabling the F4 guard fails the new `t_usage_guards` digest asserts; mounting the cert in target legs fails `t_sslrootcert`. `t_column_pipe_newline` and `t_extra_source_table` each pass when run alone.

### Check results
- typecheck, lint: green. test: ai 184, db 158, worker 310, web 360 pass (core, sources also green).
- test:db (throwaway local PG 16 on 127.0.0.1:55496, data dir deleted afterwards): 26 files, 148 tests passed. db:check OK. check:deploy-env: OK. `bash -n` on both scripts: ok. t_static's bash-4/GNU grep list: clean on both files. No `pnpm format` script exists in this repo.
- test:move: no Docker daemon. Ran `t_usage_guards t_schema_migrations_mismatch t_dry_run_happy t_verify_only t_refuse_non_empty t_force t_schema_drift t_column_pipe t_column_pipe_newline t_extra_source_table t_client_image_pin t_sslrootcert` with a host stand-in `docker` outside the repo (runs PG 16 client tools on the host, maps /work and /secrets, reports pg_dump 17, answers `image inspect` with a fake `postgres@sha256:<64 hex>` digest) against throwaway PG 16, with the `-ge 170000` guard relaxed in the working script for the run only and restored (`grep -c 'ge 170000'` = 1). Result: `test:move OK`, 110 assertions ok, 0 FAIL. NOT run: t_static, t_freeze (need real docker; CI). The `--worker-image` leg is untested here.
- Doc greps: no secret patterns in docs/deploy.md or work/ming-todo.md; every quoted script message exists in the script; the section's flags are only the real ones plus docker/git flags.

### Out-of-plan files
None.

### Follow-ups
- Ming verification after merge (listed in the plan and in `work/ming-todo.md`): live dry run, `--worker-image` leg, bash 3.2, `docker compose -p stoktok stop|start stoktok-web` by project name.
- CLAUDE.md "Current state" must change after the cutover (STK-094/095).

### Scope self-check
Only the listed files, plus the one-line `cleanup()` change above.

## Attempt 2 (REWORK)

### Files touched
- `docs/deploy.md` only. Required because: review Issues 1-3 and security S1, S3, S4, S5.
  - Issue 1/S1: rollback row "Release, `migrate` failed" now reverts the release PR's merge commit first (deploy/publish/rollback are skipped on a failed migrate, deployment `main` still pins vX.Y.Z; checked against deploy-stoktok.yml:270-315), by-hand start only if that run does not start web. Stage 4.1 notes to ignore "the old release is still running" during the freeze.
  - Issue 2: stage 2.1 uses `tail -n 2 .../logs/signals.log` (`end job=signals exit=...`; run-job.sh writes `$LOG_DIR/$JOB.log`, schedule.log only on a wrong time zone).
  - Issue 3: "Inside the 14 days" row: freeze first, copy newest `last/stoktok-[0-9]*.dump` (or `pg-backup /backup.sh` first) to `stoktok-cutover/` mode 600, then revert; `--force --confirm stoktok` only after the hand re-entry is confirmed. Freeze row's `--force` note scoped to "no post-cutover data yet".
  - S3: stage 0.8 re-downloads the cert and re-checks `MOVE_SRC_HOST` before falling back; fallback means the password is treated as exposed (stage 7.1).
  - S4: stage 9.3 labelled "Ming, Supabase dashboard, per STK-095; not run from this runbook".
  - S5: stage 4.1 "do not use the site until the deploy comment arrives".

### Tests added
None (docs only).

### Check results
typecheck, lint, test (ai 184, db 158, worker 310, web 360), check:deploy-env OK, `bash -n` on both scripts ok. test:db not run (nothing outside docs changed). Doc greps: no secrets (only the existing `sb_secret_...` prose); quoted script messages still present in the script. `work/ming-todo.md` needed no change (it has no rollback/stage 0.8 text affected).

### Out-of-plan files
None.

### Follow-ups
Unchanged (S6 and review nits N1-N6 go to STK-094 notes, per the orchestrator).

### Scope self-check
Only docs/deploy.md plus this log; scripts untouched.

## Attempt 3 (REWORK)

### Files touched
- `docs/deploy.md` only. Required because: review Attempt 2 Issues 1 and 2 (security N1, N2).
  - N1: rollback rows "Release, `migrate` failed", "Release, web unhealthy" and "Inside the 14 days": the revert run's PR comment must read `deployed: ... v0.2.1 ... is running and healthy.` (notify text at deploy-stoktok.yml:439); on `restored` / `restore-unpushed` (vX.Y.Z back) or anything else, freeze again (stage 2.3-2.5), stop and report. By-hand start only if the run ends without starting any web.
  - N2: stage 0.8 now rotates the Supabase DB password (stage 7.1) after the last script run whatever the outcome; pointer added in the Freeze and Move failed rows.
- `work/ming-todo.md`: no change (no affected line).

### Tests added
None (docs only).

### Check results
typecheck, lint, test (core 834, sources 35, ai 184, db 158, worker 310, web 360) green; check:deploy-env OK; `bash -n scripts/*.sh` ok; secret grep on docs/deploy.md empty; quoted notify text exists in the workflow.

### Out-of-plan files
None.

### Follow-ups
Unchanged.

### Scope self-check
Only docs/deploy.md plus this log; scripts untouched.

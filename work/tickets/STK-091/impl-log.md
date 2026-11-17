## Attempt 1 — 2026-11-17 (slice A2a)

### Files touched
| File | Required because |
|---|---|
| `scripts/db-migrate-from-supabase.sh` | Create: the data-move script (plan Approach 1-13) |
| `scripts/test-db-migrate-from-supabase.sh` | Create: harness with all `t_*` cases (S7); optional test-name args to run a subset |
| `scripts/test-fixtures/move-source-data.sql` | Create: seed rows for all 18 baseline tables (17 moved) |
| `package.json` | `test:move` script |
| `.github/workflows/ci.yml` | `pnpm test:move` step after `db:check` with `MOVE_TEST_URL` |
| `docs/deploy.md` | "Data move script (STK-091)" reference section; Shared Postgres step 3 points to it and STK-096 |

### Tests added / changed
- `scripts/test-db-migrate-from-supabase.sh`: t_usage_guards, t_static, t_schema_migrations_mismatch, t_dry_run_happy, t_verify_only, t_refuse_non_empty, t_force, t_freeze, t_schema_drift.

### Checks (actual output summary)
- typecheck: green. lint: green. test: all packages pass (core 834, sources 35, ai 184, db 158, worker 310, web 359).
- test:db (throwaway local PG 16 on a TCP port): 26 files, 148 tests passed. db:check (same server): `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`.
- check:service-key: FAILS here at `next build` in apps/web (exit 1); it fails identically on the unmodified tree (verified with git stash). Not caused by this change; CI will tell.
- `bash -n` on both scripts: ok. shellcheck: not installed, NOT run. The bash-4/GNU grep list from t_static: clean on both files (run by hand). Legacy-reference guard text: absent.
- test:move: NOT run as written. No Docker daemon here (`docker` CLI only), so the real path (`postgres:17` containers, `--network host`, `bash:3.2 bash -n`, t_static docker leg, t_freeze container leg) was NOT executed. CI runs it.
- What WAS run: the harness (t_usage_guards, t_schema_migrations_mismatch, t_dry_run_happy, t_verify_only, t_refuse_non_empty, t_force, t_schema_drift) against a throwaway local PG 16 with a stand-in `docker` (outside the repo) that executes the pg client tools on the host and maps /work and /secrets. For that run the script's two PG 17 guards were relaxed in a temporary copy (the 170000 server check, and the stand-in reported pg_dump 17); the committed script keeps them (`grep -c 'ge 170000'` = 1). Result: `test:move OK`, every assertion passed, including the independent oracle, sequences, source fingerprint, sentinel leak checks and the drift cases. t_static and t_freeze were not run.
- Bugs found and fixed by that run: src_ro needed a `;` before `rollback`; bare `ANALYZE` touched system catalogs (now lists the public tables); the schema check must exclude `schema_migrations` (added `--exclude-table=public.schema_migrations` to the schema dumps).

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- First CI run of `pnpm test:move` on a real Docker daemon: check the `--network host` and pgpass bind-mount permissions on the runner (the `--user` uid owns the mounted files).
- PG 17 vs 16 pg_dump normalisation (S6) was only exercised on 16 dumps; a PG 17 dump may add lines (e.g. `\restrict`, handled) worth watching in the first CI run.
- The `--worker-image` leg (image migrations listing and `migrate`) is untested here, as the plan expected (Ming verification after merge).
- `check:service-key` fails locally on the base tree (build step); unrelated.

### Scope self-check
- Could the diff be smaller? No: each file is in the plan's list.
- Diff size: +4 tracked lines in package.json/ci.yml, docs section ~+30; new files: script 359 lines, harness ~285, fixture ~75.

## Attempt 1 — 2026-11-17

### Files touched
stoktok repo (commit `647c476`):
| File | Required because |
|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | one line: `IFS= read -r pw < "$pwfile" \|\| true` |
| `scripts/check-deploy-env.sh` | literal updated; password-guard order check (AC 6); no-echo checks for `$pw` / `STOKTOK_DATABASE_URL` (AC 7); comment on the `config` guard (AC 8) |
| `deploy/deployment-repo/README.md` | CODEOWNERS line already exists live; B merged, C is this PR |
| `docs/deploy.md` | Shared Postgres step 2 (before / what happens / checks / rollback); AI-keys step 2 note |
| `apps/web/app/readyz/route.ts` | `Date.now()` to `performance.now()` |
| `apps/web/test/readyz.test.ts` | new failed-result expiry test |

deployment repo, branch `stoktok/expand-shared-postgres` from origin/main `24983f0` (commit `da06996`, not pushed): `apps/stoktok/compose.yml` and `.github/workflows/deploy-stoktok.yml`, copied byte for byte (`cmp` exit 0 for both). `git diff --stat` lists exactly those 2 files; `release.env` untouched.

### Tests added / changed
- `apps/web/test/readyz.test.ts` › memoises a failed result for 3 s, then retries. Vitest 5 fakes `performance` by default, so no `toFake` change was needed; the existing memo test and the new one pass with `performance.now()`.

### Mutation proofs (scratch copy, each run of `check-deploy-env.sh` on one mutated draft)
Baseline OK, exit 0. All below exit 1:
1. delete `exit 1` after the guard: `FAIL: the password guard (...) must follow IFS= read and precede STOKTOK_DATABASE_URL=, mktemp and the printf`
2. URL assignment above `re_pw=`: same FAIL
3. `IFS= read` to `read`: `FAIL: secrets step lacks (before mktemp): IFS= read -r pw ...` plus the guard FAIL
4. `re_pw=` moved below the guard: guard FAIL
5. `echo "$pw"` in secrets: `FAIL: in the secrets step $pw may appear only on the guard and the URL assignment`
6. `echo "::notice::$STOKTOK_DATABASE_URL"` in a step after `publish`: `FAIL: the database password or URL is referenced outside the secrets step`
7. `set -x`: `FAIL: set -x in workflow`
8. `echo "$STOKTOK_DATABASE_URL"` in secrets: `FAIL: ... $STOKTOK_DATABASE_URL may appear only on the single printf`

### Checks (actual output summary)
- typecheck: green (web, worker, packages).
- lint: green.
- test: all green (web 360, core 834, sources 35 + 1 skipped file, ai 184, db 23 files).
- test:db: `DB_TEST_URL` on a throwaway local PG16 (initdb under /tmp, stopped, data dir deleted): 26 files, 148 tests passed.
- db:check: `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`; `bash -n scripts/check-deploy-env.sh` OK.
- check:service-key: the script run directly exits 0 and prints `OK: no secret or AI SDK material in client bundle`; run through `pnpm check:service-key` the exit code was 1 here, also with my changes stashed (pre-existing sandbox quirk, output shows the same OK line).
- No `format:check` script exists; `pnpm format` run, it changed only the files above.
- deployment: `bash ops/check-volume-safety.sh .` prints "No volume-deleting commands found."
- Secrets: no match of the password file contents in work/docs/deploy/scripts/apps; `git diff origin/main...HEAD | grep -cE '[A-Za-z0-9+/]{43}='` prints 0.

### Live drift check (AC 3)
`git fetch --depth=50 origin main`: origin/main = `24983f0` (PR #88). `git log --oneline -3 origin/main -- apps/stoktok .github/workflows/deploy-stoktok.yml` shows only `dfe4daa` (release v0.2.1). The diff live vs drafts has only the hunks in plan.md's table (compose: header 14-22, `networks`, `db` network; workflow: header, `DB_APP`, secrets step and AI-key env, pull/backup/migrate, deploy guard, notify). run-job.sh, run-schedule.sh, plist and runner-check.yml are identical to the drafts.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Short per-query timeout on the `/readyz` ping (`packages/db`).
- Draft `notify` lacks a `backup:failed` message; add when STK-094 activates the step.
- Offsite-sync size floor for an empty dump: only if Ming reports the `stoktok` dump is <= 1 KiB.

### Deployment PR body (no values)
Title: `stoktok: expand to the shared Postgres (STK-093)`

- The 2 files (`apps/stoktok/compose.yml`, `.github/workflows/deploy-stoktok.yml`) are copied verbatim from `mmlabs-online/stoktok` `deploy/deployment-repo/` (stoktok PR: <link>).
- **It also ships the STK-072 AI-key env lines that never reached the live workflow**: `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` from the optional secrets `STOKTOK_ANTHROPIC_API_KEY` / `STOKTOK_GOOGLE_AI_API_KEY`. Unset means empty, so that provider is off. A value outside `^[A-Za-z0-9._-]*$` stops the run at `secrets` with nothing changed.
- `STOKTOK_AI_KEYS_MASTER_KEY` is now required (base64 of 32 bytes).
- `STOKTOK_DATABASE_URL` is derived from `postgres/secrets/apps/stoktok.password` (STK-092). The env file stays mode 600 in a 700 dir.
- The `SUPABASE_*` lines stay for the rollback window.
- Backup and migrate steps stay dormant (no `migrate` service until STK-094).
- Server behaviour on merge: the push touches `apps/stoktok/`, so `deploy-stoktok` starts by itself. `secrets` rewrites the 8-name env file; `pull` is a no-op; `deploy` recreates v0.2.1 web on `web` + `db` (seconds of downtime, `/healthz` touches no DB so the `stoktok` role need not exist yet); `publish` copies the compose for the launchd jobs. Bad secret or password file: the run fails at `secrets`, nothing started.
- Ming checks after merge (never print the env file; `docker inspect` only with `-f`): the run is green and says `deployed ... v0.2.1 ... healthy`; `ls -l ~/.config/stoktok/stoktok.env` is `-rw-------`; `cut -d= -f1` of it lists 8 names; `docker compose -p stoktok ps` web healthy, networks `db web`; site shows the same data; `run-job.sh eod-prices --dry-run` exits 0; report the size of `~/srv/backups/postgres/daily/stoktok-*.dump` after one `pg-backup /backup.sh`.
- Rollback: web unhealthy within 120 s restores the previous `apps/stoktok/`; the revert push is refused on protected `main` (`restore-unpushed`), so revert this PR's merge commit in a PR. Secret-only problems: fix and `workflow_dispatch` on `main`. Supabase and the empty `stoktok` database are not affected.

### Scope self-check
- Could the diff be smaller? No.
- Diff size (stoktok): about +120 / -15 lines over 6 files; deployment: +109 / -11 over 2 files.

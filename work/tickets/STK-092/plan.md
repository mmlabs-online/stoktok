Status: READY

# Plan — STK-092: Deployment repo: register stoktok on the shared Postgres (STK-084 slice B)

## Spec summary
- ticket.md Goal: "deployment repo PR: `bash postgres/scripts/add-app-db.sh stoktok` (role + DB + password file + config/databases entry); after Ming merges, run `/backup.sh` and `restore-test.sh stoktok` once. Orchestrator may open the PR (Ming, 2026-11-17)."
- STK-084 plan, Split proposal row B: "`bash postgres/scripts/add-app-db.sh stoktok` → `postgres/config/databases` + `postgres/secrets/apps/stoktok.password`; PR opened by the orchestrator, Ming merges; then `deploy-postgres` green and one `pg-backup /backup.sh` run (avoids the offsite false failure, DB consult §9)".
- CLAUDE.md Stack: "database and role `stoktok`". Conventions: "The database password is `postgres/secrets/apps/stoktok.password` in the deployment repo (shared-Postgres standard)".
- Precedent: deployment commit 282e955 (TuDoCuaTui, PR #38, branch `postgres/add-tudocuatui`). Only its `postgres/config/databases` + `postgres/secrets/apps/<app>.password` part applies; the app workflow/compose part is STK-093.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Deployment branch `postgres/add-stoktok` (from `origin/main`) adds exactly one line `stoktok` at the end of `postgres/config/databases` and one new file `postgres/secrets/apps/stoktok.password`; nothing else changes | In `/home/user/deployment`: `git diff --stat origin/main...postgres/add-stoktok` lists exactly those 2 files; `git diff origin/main...postgres/add-stoktok -- postgres/config/databases` shows `+stoktok` only (no merged line like `tudocuatuistoktok`); `postgres/secrets/postgres_password` and the other app password files are unchanged |
| 2 | The password file is valid for the script and the workflows, without its value ever being shown | `grep -Ecx '[0-9a-f]{48}' postgres/secrets/apps/stoktok.password` prints `1` and `wc -l <file>` prints `1` (count only, never `cat`). Same regex the script checks (`add-app-db.sh:31`) |
| 3 | The script's own validation passes and the change is idempotent | Re-run `bash postgres/scripts/add-app-db.sh stoktok` on the branch: exit 0, no `generated ...` and no `added stoktok ...` line, prints "no running postgres here" (no local container), `git status --porcelain` empty afterwards |
| 4 | The password value appears nowhere except that one file | `grep -rF -f postgres/secrets/apps/stoktok.password /home/user/stoktok/work /home/user/stoktok/docs` finds nothing; impl-log, review, PR title/body and commit message contain only the path, never the value (reviewer reads them) |
| 5 | Deployment CI on the PR green (`volume-safety`; `pr-scope` is a no-op for non-release branches) | PR checks on `mmlabs-online/deployment` |
| 6 | Nothing touches the Supabase project; no secret committed to the stoktok repo | stoktok diff is at most the `docs/deploy.md` line below; `git -C /home/user/stoktok diff` contains no password-like value |
| 7 | stoktok repo checks green | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm db:check` (record in impl-log if `test:db`/`db:check` cannot run in the sandbox for lack of a DB, as previous tickets did) |

## Ming verification after merge
Not reviewer-verifiable (needs the Mac server):
1. Merging the PR triggers `deploy-postgres` (path `postgres/**`). Expected behaviour, from `.github/workflows/deploy-postgres.yml`:
   - `host`: checks `stoktok.password` exists (lines 72-78), `db` network and `pgdata` volume exist.
   - `publish`: `rsync -a --delete postgres/ ~/srv/postgres/` in place; bind mounts stay valid.
   - `deploy`: `up -d --wait postgres pg-backup`. `compose.yml` is unchanged, and the secrets/config are directory bind mounts (`compose.yml:48-50`), so **neither container is recreated and nothing restarts**. No pull. The glibc check compares equal images.
   - `app databases`: runs `add-app-db.sh` for every app in the list. This creates role `stoktok` (LOGIN, no special rights), database `stoktok` owned by it, and revokes PUBLIC connect (`sql/app-db.sql`). For the existing apps it only re-applies their unchanged passwords, which is harmless.
   - `agent`: the LaunchAgent is unchanged, so this is a no-op. `deploy-pgadmin` is not triggered (it watches only `postgres/secrets/postgres_password`, which does not change).
   - No app container is touched. stoktok production stays on v0.2.1 / Supabase.
2. Run one backup right away, so the 03:30 offsite sync does not fail because `stoktok` has no dump under 26 h old (`RESTORE.md:21-23`, DB consult §9):
   `docker compose -p postgres -f ~/srv/postgres/compose.yml exec pg-backup /backup.sh`
3. `bash ~/srv/ops/backup/restore-test.sh stoktok` (or from a deployment checkout, `bash ops/backup/restore-test.sh stoktok`). It must exit 0. The database is still empty, so this only proves the dump/restore path.
4. Optional: the next nightly offsite sync healthcheck is green.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `/home/user/deployment/postgres/config/databases` | append `stoktok` (by the script) | init, deploy-postgres and the pg-backup sidecar read this list |
| `/home/user/deployment/postgres/secrets/apps/stoktok.password` | new, generated by the script (`openssl rand -hex 24`) | role password; later read by `deploy-stoktok` (STK-093) to build `STOKTOK_DATABASE_URL` |
| `/home/user/stoktok/docs/deploy.md` | step 1 under "Shared Postgres (STK-084)": add the two post-merge commands (`pg-backup /backup.sh`, `restore-test.sh stoktok`) | the current line 95 stops at "wait for `deploy-postgres` green". Without the backup, the offsite sync reports one false failure |

Do not edit any deployment workflow, `apps/stoktok/`, `postgres/compose.yml` or the SQL/scripts. Workflow changes for stoktok belong to STK-093.

## Tests to write
None. This is a config/secret registration, and no code changes. Verification is by command (table above).

## Approach
1. In `/home/user/deployment`: `git fetch origin`, `git switch -c postgres/add-stoktok origin/main`. Make sure no local Docker `postgres` project container is running (the script would otherwise apply the change to it). In the sandbox there is none.
2. `bash postgres/scripts/add-app-db.sh stoktok`. Expected output: `generated .../stoktok.password`, `added stoktok to ...`, and "no running postgres here". The script never prints the value.
3. Run AC 1-3 checks. Commit both files in one commit, following the precedent: `postgres: add stoktok database (STK-092)`. Push and open a PR into `main` of `mmlabs-online/deployment`. The PR body states: 2 files; merging runs deploy-postgres, which creates role and database `stoktok` and restarts nothing; Ming's post-merge steps 2-3. It names the password only by its path.
4. In stoktok: the one-line `docs/deploy.md` edit, impl-log, then run the checks.
5. Rules: R3 is met because the password lives only in the deployment repo file, which CLAUDE.md names as its home, and is never echoed, logged or put in argv (the script pipes it via stdin). Nothing else in R1-R10 applies. R7: only the files listed.

## Specialist input used
No new consult. From STK-084:
- database-optimizer §9 / item 9 ("add `stoktok` with `add-app-db.sh`, run `/backup.sh` immediately, run `restore-test.sh stoktok` once"): adopted as Ming's post-merge steps.
- database-optimizer, the cutover-dump archiving part of §9: left to STK-094.
- database-optimizer note that `restore-test.sh stoktok` works unchanged and its role grep matches nothing: relied on.
- software-architect note that `/backup.sh` dumps every database in `config/databases`: relied on.

## Assumptions
- The ticket's "no secret is committed" refers to the stoktok repo. Committing `postgres/secrets/apps/stoktok.password` to the private deployment repo is the shared-Postgres standard (CLAUDE.md Conventions; `postgres/compose.yml:7-10`; every other app). This is not a conflict.
- `postgres/config/databases` on `origin/main` ends with a newline (it does in the clone: 4 lines). If it does not, the script's `echo >>` would join two names. AC 1 catches this. The fix is to add the missing newline as part of the same line change.
- The deployment repo clone's `origin/main` is current. If `origin/main` already lists `stoktok`, stop and report instead of creating a duplicate.
- No other open ticket edits these deployment files. STK-093 edits `apps/stoktok/` and `deploy-stoktok.yml` and depends on this ticket being merged.

## Blocking questions
None.

## Split proposal
None. This ticket is already slice B of STK-084.

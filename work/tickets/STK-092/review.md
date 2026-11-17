## Attempt 1 — 2026-11-17
Verdict: PASS

### Checks (run by reviewer)
- typecheck: pass (`pnpm typecheck`, exit 0, all workspaces)
- lint: pass (`pnpm lint`, exit 0)
- test: pass (`pnpm test`, exit 0). core 834, sources 35, ai 184, db 158, worker 310, web 359 passed, 0 failed. This matches impl-log.
- test:db: pass. Ran on a throwaway local Postgres 16 cluster (127.0.0.1:55432, trust auth) and deleted the data dir afterwards. 26 files, 148 tests passed. This matches impl-log.
- db:check: `db:check OK` (exit 0; the script's own throwaway cluster). `scripts/db-check/app-db.sql` is byte-identical to deployment `postgres/sql/app-db.sql` (`cmp`).
- format:check: no such script in this repo.
- Deployment `ops/check-volume-safety.sh` on a `git archive HEAD` copy of the branch: "No volume-deleting commands found." (exit 0)

### Acceptance criteria (plan verification table)
- [x] 1. 2-file diff, `+stoktok` only. Evidence: `git -C /home/user/deployment diff --stat origin/main...HEAD` shows `postgres/config/databases | 1 +` and `postgres/secrets/apps/stoktok.password | 1 +` (2 insertions). The databases diff is exactly `+stoktok` after `tudocuatui`, with no joined name. `postgres/secrets/postgres_password` diff has 0 lines, and the other app password files are untouched (`--name-status`: M databases, A stoktok.password). The branch base `4c2c9fc` equals `origin/main`, which equals the remote `main` (`ls-remote`). `origin/main` did not already list stoktok (count 0).
- [x] 2. Password file valid. Evidence: `grep -Ecx '[0-9a-f]{48}'` gives 1, `wc -l` gives 1, `wc -c` gives 49. Git mode is 100644, the same as the other app password files. The value was never printed.
- [x] 3. Script validation and idempotency. Evidence: re-running `bash postgres/scripts/add-app-db.sh stoktok` exits 0. The output has 0 `generated`/`added` lines and 1 "no running postgres here" line, and the password appears in the output 0 times. `git status --porcelain` is empty afterwards. There is no Docker daemon in the sandbox, so nothing was applied anywhere.
- [x] 4. Value appears only in its file. Evidence, as counts: in the whole stoktok tree (excluding node_modules/.git) 0 files match. The stoktok branch history patch (`origin/main..HEAD -p`) has 0 matches, and so does the working diff. `git grep -lFf` over deployment HEAD finds only `postgres/secrets/apps/stoktok.password`, so it collides with no other secret file. The deployment commit message has 0 matches and names only the path. impl-log names only the path.
- [x] 5. Deployment CI. The branch `postgres/add-stoktok` is pushed (remote head `57a136c` = local HEAD), but no PR exists yet (REST `pulls?head=` is empty). That is expected: the orchestrator opens the PR at DONE. Local equivalent: `volume-safety`'s checker passes on the branch content (above). `pr-scope` is a no-op for non-release branches (`pr-scope.yml:28-29`). **The orchestrator must confirm the PR's `volume-safety` check is green after opening it.**
- [x] 6. Nothing touches Supabase, and no secret is in stoktok. Evidence: the stoktok diff is `docs/deploy.md` (1 line) plus `work/` files (backlog, STK-092 ticket/plan/impl-log), and 0 password matches (AC 4). No migration or Supabase command is involved.
- [x] 7. stoktok checks green. See Checks.

Post-merge command paths checked: `/backup.sh` in `pg-backup` matches `ops/backup/RESTORE.md:191`. `~/srv/ops/backup` is where deploy-postgres publishes `ops/backup/` (`deploy-postgres.yml:9,47`). deploy-postgres's host check (`deploy-postgres.yml:72-78`) needs `stoktok.password` to be non-empty, and it is. The pg-backup sidecar re-reads `config/databases` on every run (`postgres/compose.yml` comment), so no restart is needed.

### Ming verification after merge (carry into the PR)
1. `deploy-postgres` green (creates role and database `stoktok`; no container recreated).
2. `docker compose -p postgres -f ~/srv/postgres/compose.yml exec pg-backup /backup.sh`
3. `bash ~/srv/ops/backup/restore-test.sh stoktok` exits 0.
4. Optional: the next nightly offsite sync healthcheck is green.

### Issues
None.

### Rules R1–R10
No violations found. R3: the password lives only in the deployment repo file that CLAUDE.md Conventions names as its home. It is not in stoktok, not in `NEXT_PUBLIC_*` and not in logs. R7: the deployment diff has exactly the 2 planned files, and the stoktok diff is the planned `docs/deploy.md` line plus workflow bookkeeping in `work/`.

### Nits (do not block)
- impl-log says the deployment branch was "not pushed", but it is now on the remote (pushed later by the orchestrator, same commit). This is informational only.
- test:db and db:check ran on Postgres 16 here (production is 17). db:check only warns outside CI. The same caveat applied to earlier tickets.

### Follow-ups (out of scope)
- Open the deployment PR into `mmlabs-online/deployment` main, then confirm `volume-safety` is green on it.

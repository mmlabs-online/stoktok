## Attempt 1 — 2026-11-18
Verdict: PASS

Scope: the implementer part only (commit 8b94b36; branch HEAD 13d98cb adds only `work/` files on top: backlog, ticket and security-review). Plan steps A to I are outward actions and are not reviewed here.

### Checks (run by reviewer)
- typecheck: rc 0 (all workspaces).
- lint: rc 0.
- test: rc 0. Tests passed: core 834, sources 35, ai 184, db 169, worker 310, web 360.
- test:db: rc 0, 27 files and 154 tests passed. Run against a throwaway PG 16 cluster: `postgres` superuser with a random password, scram over TCP 127.0.0.1:55439, data dir `/var/tmp/stk094rev-pg`. The cluster was stopped and the dir deleted afterwards. The password was never printed.
- db:check: `db:check OK` (PG_BIN=16; the server-major-17 check only warns locally).
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n` on `scripts/*.sh` and `deploy/deployment-repo/apps/stoktok/*.sh`: all pass.
- `docker compose config`: the compose CLI is present here (v5.6.1; it needs no daemon). I ran it on a scratch copy of the draft, with `env_file` pointed at a dummy file and a dummy `release.env` holding 64-zero digests.
  - `--profile jobs --profile migrate config --quiet`: rc 0.
  - `--profile migrate config --services | grep -qx migrate`: true. This is the workflow `pull` detection.
  - `config --services` with no profile lists only `stoktok-web`, which is what `up -d --wait` starts.
  - `--profile jobs` lists web and worker, which is what the rollback `pull` pulls.
  - The resolved `migrate` service has `cap_drop [ALL]`, `no-new-privileges:true`, `command [migrate]`, network `db`, no ports.
  - The live (expand) compose gives no `migrate`, so it takes the "no migrate service yet" notice path.
- test:move, local: run on a scratch tree with my own host `docker` stand-in (no daemon) and the scratch-only change `-ge 170000` → `-ge 160000`. The stand-in runs the PG 16 clients with `/work`, `/secrets` and `/certs` mapped, fakes `pg_dump --version` as 17 and fakes the `image inspect` digest. Ran all tests except `t_static` and `t_freeze`: 125 ok, 0 FAIL, `test:move OK`.
- test:move, CI. **This evidence depends on GitHub:** PR #76 run 44227228807, job 134543281654 on e8874c1, which is code-identical to 8b94b36. All steps are green: typecheck, lint, test, test:db, check:service-key, check:deploy-env, db:check, test:move. The log shows the real `bash:3.2` `t_static` checks of both scripts as ok. `t_client_image_pin` ran with the real `postgres:17` RepoDigest, not skipped: "a digest-pinned worker image passes the S6 guard" ok, "no worker pin complaint" ok. The CI run on 13d98cb (adds only security-review.md) was still in progress when I wrote this.

### Acceptance criteria
- [x] AC 1, compose cutover state.
  - `deploy/deployment-repo/apps/stoktok/compose.yml:43` has the `/readyz` health check with `AbortSignal.timeout(3000)`; the other healthcheck keys are unchanged.
  - The `migrate` block at `:66-76` matches the plan line by line.
  - The header at `:8` and `:44-49` has the hand-run line and the cutover paragraph.
  - It matches the TuDo precedent (`deployment/apps/tudocuatui/compose.yml`, the `migrate` service and the healthcheck string are identical).
  - `docker compose config` evidence is above.
  - The worker image runs `node dist/cli.js` as `node` (`apps/worker/Dockerfile:29-31`). `cli.ts:70-72` dispatches `migrate`, and `resolveMigrationsDir` finds `/app/migrations`.
- [x] AC 2, check-deploy-env pins the state. The real drafts pass. I re-ran the mutations in my own scratch copy and every one FAILs:
  - (a) `/healthz` back; (b) timeout removed;
  - (c) `[default, db]`; (d) `[tunnel, db]`;
  - (e) profiles removed; (f) `STOKTOK_WEB_IMAGE`;
  - (g1) command removed; (g2) `["migrate","--x"]`;
  - (h) service deleted; (i) worker `[db]` with `migrate` after the worker; (j) no `env_file`.
  - Extra: cap_drop removed, `restart: unless-stopped`, `environment:` added, a `/healthz` comment in web, `profiles` on web, and the service renamed.
  - A valid reorder (`migrate` before the worker) passes, as it should.
  - The `svc_block` parser stops at the next 2-space key or a top-level key. Indented comments stay inside the block.
- [x] AC 3, workflow draft byte-identical to live.
  - I fetched the files from `mmlabs-online/deployment` `main` (563d1e2) via the REST API. `cmp` against the drafts shows no difference for `deploy-stoktok.yml`, `run-job.sh` and `run-schedule.sh`.
  - The plist dir equals the local checkout, which is da06996: one merge commit behind 563d1e2, and the compare API shows 0 changed files.
  - The live compose equals `origin/main`'s draft.
  - `git diff --stat origin/main...HEAD -- deploy/deployment-repo/` lists only `apps/stoktok/compose.yml` and `README.md`.
- [x] AC 3, extra: would the live workflow run this compose correctly and fail safe? Yes (`deploy-stoktok.yml:246-301`).
  - `pull` validates and pulls both profiles and detects `migrate`.
  - `backup` runs the pg-backup dump, and its failure stops before migrate.
  - `migrate` runs `--profile migrate run --rm migrate` and checks rc and the ahead prefix (`MIGRATE_AHEAD_PREFIX` matches `packages/db/src/pg/migrate.ts:32`).
  - `deploy` runs only if migrate succeeded. `up -d --wait` starts web only.
  - On a migrate failure, `deploy` is skipped, so `rollback` (which needs `deploy == failure`) does not run and the old release keeps running. The notify path is `migrate-failed`, and the runbook "`migrate` failed" row covers it.
  - On a web failure, the rollback restores `$BEFORE:apps/stoktok/`. That is the expand compose with no `migrate`, together with v0.2.1, so it is one push.
- [x] AC 4, S6.
  - The guard is at `scripts/db-migrate-from-supabase.sh:107-109`. It sits before the cert checks, the password read and `command -v docker`, so it is a usage error (exit 2) and makes no docker call.
  - Harness asserts are at `scripts/test-db-migrate-from-supabase.sh:181-185` and `:376-381`.
  - My mutations:
    - Guard removed: 4 FAILs (exit 2 cases, message, no docker call).
    - Regex unanchored: 2 FAILs (the `:x` case).
    - Guard refuses even pinned refs: 3 FAILs in `t_client_image_pin`.
- [x] AC 5, N1. `PG_SSL_CUR="prefer"; PG_CERT_CUR=""` is at script `:363`, right before the TOC `pg_restore -l`, and `t_sslrootcert` is green. No test reaches that leg with a cert (nit 3).
- [x] AC 6, N2. There are five message asserts at harness `:191-202`. Changing the PEM guard's message fails "says: is not a PEM certificate".
- [x] AC 7, runbook fixes. I read the diff:
  - `2.3-2.6` count is 3, and `2.3-2.5` count is 0.
  - N2 has a compose-lookup `docker inspect` (`stoktok-stoktok-web-1` naming handled).
  - The N3 suffix sentence is there. Both quoted suffixes and "is running and healthy." exist verbatim in `deploy-stoktok.yml:439-448`.
  - Stage 4.2 uses `stoktok-[0-9]*.dump` and a timestamp check. That glob excludes the `stoktok-latest.dump` symlink; naming per deployment `ops/backup/RESTORE.md:18`.
  - The 14-day dump is mandatory, and the fix-forward revert note is there.
  - Stage 1.1 has the `revoke`; stage 0.6 has the fallback digest; stage 0.3 has the two-file check.
  - The literal `grep 'stoktok-\*\.dump'` still matches 3 lines: the cutover-dir chmod and two `daily/` lines. That is intentional and noted in impl-log.
- [x] AC 8, Flow, Shared Postgres and the new "Cutover release (STK-094)" (`docs/deploy.md:137-144`, no digests). "Cut a release" step 8 is updated. check:deploy-env is OK.
- [x] AC 9, ming-todo: the item 7 wording, the stage 0 two-file and `pr-scope` check, and the new "Approve the cutover release" item. The stage order still matches runbook stages 0 to 7.
- [x] AC 10, ADR 0003: status, the worker network line, the health line, and the STK-084/STK-094 amendment (`docs/adr/0003-deploy-and-scheduling.md:3,11,15,36-37`).
- [x] AC 11, `deploy/deployment-repo/README.md:14-18`: release PR second commit only; never in a setup PR while v0.2.1 is pinned; the workflow is not copied.
- [x] AC 12, release review. I re-ran the rows on origin/main 23b38b3; each matches impl-log.
  - R-1: the only supabase imports outside tests are `@supabase/ssr` in `apps/web/server/auth/authen-client.ts`. Its callers use only `client.auth.signInWithPassword`, `signOut` and `getClaims` (`login/actions.ts:24,36`, `proxy.ts:28`, `require-user.ts:22`). There is no `.from(` or `.rpc(` on a Supabase client and no `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_URL`. No supabase dependency in `apps/worker` or `packages/*`.
  - R-2: same file list as impl-log.
  - R-3: the env names resolve to exactly the 6 app names, plus `STOKTOK_VERSION` and `NODE_ENV`.
  - R-5: 30 merges, 303 non-merge commits, and no non-DONE ticket in that range.
  - R-6: v0.2.1 has `requireUser` in 32 files. `ALLOWLIST_USER_IDS` appears only in a test that asserts it is ignored.
  - R-9: no tag v0.2.2 or v0.3.0. `release/v0.2.2` (2a61290) exists. The orchestrator confirmed no deployment PR for `release/stoktok-v0.2.2`.
  - No BLOCKING-FOR-CUT row.
- [x] AC 13, no secrets. The grep of added lines for `sb_secret_`, `eyJ`, real 64-hex digests and `postgres://u:p@` finds only the impl-log and plan lines that describe the grep. No Supabase action. No change in `/home/user/deployment` (its working tree is clean at da06996).
- [x] AC 14: all checks green. Evidence is in the Checks section above; test:move is CI evidence.

Ming verification after merge (not reviewer-verifiable; carried to the PR): plan steps A to I. These are: merge and hold unrelated merges; Ming's OK, then cut v0.3.0 and add the compose commit to `release/stoktok-v0.3.0`, with the two-file, `pr-scope` and `cmp` checks; runbook stages 0 to 7, including real `docker compose config` and `run --rm migrate` on the Mac, `/readyz` healthy, new AI keys and `ai_keyring_invalid` count 0; then the CLAUDE.md "Current state" line. Note: per the ticket, deploy-postgres #9 FAILED. Stage 0 must see it green first.

### Issues
None blocking.

### Rules R1–R10
No violations found.
- R1, R2, R5: no app code changed.
- R3: no credential in a committed file or argv. `migrate` gets the DB URL only from `env_file`. S6 narrows which image receives the target password.
- R4, R6, R9: not touched.
- R7: every changed file is in the plan table. `work/backlog.md`, `ticket.md` and `security-review.md` are orchestrator workflow files.
- R8: script changes are covered by test:move and check:deploy-env with mutation proof.
- R10: n/a.

### Nits (do not block)
1. `scripts/check-deploy-env.sh:278`: the `migrate` image check is an unanchored `grep -F`. A commented `# image: ${STOKTOK_WORKER_IMAGE:?x}` next to `image: ${STOKTOK_WEB_IMAGE:?…}` passes; I tested this mutation. Anchor it as `grep -q '^image: \${STOKTOK_WORKER_IMAGE:?'` on the trimmed lines. This fits with security 🟡3 (allow-list) in STK-097.
2. The plan Approach step 2 says the worker check covers `profiles: [jobs]`, but no such check existed on `origin/main` and none was added. Without it, losing the profile would let `up -d` start the worker. This is not a regression. Add it in STK-097.
3. The N1 reset (script `:363`) is not exercised: `t_sslrootcert` stops at preflight, so no test runs the TOC leg with a cert configured.
4. `work/ming-todo.md:39` says "Close any stale `release/stoktok-v0.2.2` PR unmerged", but the orchestrator confirmed that no such PR exists. The line is harmless and can be dropped when ticked.
5. The `/home/user/deployment` checkout is one (file-less) merge commit behind deployment `main`. Use the API or a fresh fetch for the step C `cmp`.

### Follow-ups (out of scope)
- The security-review.md 🟡1–🟡6. These are: the draft-PR guard against an early merge before step C; migrate detection that fails closed; the allow-list for the migrate block; repository pinning for S6; an S6 message assert; optional `read_only` on migrate.
- The CLAUDE.md "Current state" line after stage 5 (text in plan Follow-ups).
- Deploy workflow header line 5 "(/healthz)" (STK-097, together with the live file).
- `news`, `financial-statements` and `resolve-holiday-gaps` are still unscheduled (R-7).
- ming-todo lines 13-16 ("Login — before the next release") are historical per R-6. The "runner offline" and "STK-094 waits for STK-090" items are stale too.
- ADR 0003 line 10 still says "because R6 is suspended". R6 was restored in STK-048/STK-060.

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

## Attempt 2 — 2026-11-18
Verdict: REWORK

Scope of this attempt: Ming's note "after attempt 1 PASS" (security 🟡1, 🟡3 with review nit 1, 🟡4, 🟡5, and the stale ming-todo item). The rework commit is 70f205a. HEAD is c720ae0, which adds only security-review.md on top of c78380b (backlog/ticket state). One issue blocks PASS: the 🟡3 allow-list can be bypassed with valid compose YAML (Issue 1). Everything else in the rework is correct and tested.

### Checks (run by reviewer, on c720ae0)
- typecheck: green (`pnpm typecheck`, exit 0).
- lint: green (`pnpm lint`, exit 0).
- test: green (`pnpm test`, exit 0).
  - core 834, sources 35, ai 184, db 169, worker 310, web 360.
- test:db: green, 27 files and 154 tests.
  - Server: a throwaway PG 16 with a password superuser over TCP on 127.0.0.1:55433, data dir under /var/tmp. It was stopped and deleted afterwards.
- db:check: `db:check OK` against the same server (`DB_CHECK_URL`; it warns that the server is 16, not 17).
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n`: clean on `scripts/*.sh` and `deploy/deployment-repo/apps/stoktok/*.sh`.
- test:move, local: run on a scratch `git archive` copy with the same host `docker` stand-in as attempt 1, and the scratch-only change `-ge 170000` → `-ge 160000`.
  - Every test except `t_static` (needs bash 3.2) and `t_freeze` (needs a daemon): 128 ok, 0 FAIL, `test:move OK`.
  - The S6 asserts ran: "text after digest" exit 2 + message, "another repository" exit 2 + message, and the positive `mingming21400/stoktok-worker:v0.3.0@sha256:…` case "passes the S6 guard" and "no worker pin complaint".
  - The implementer's run had 23 FAILs because the PG 16 target tripped the version guard. With the guard relaxed in scratch only, those failures go away.
- test:move, CI. **This evidence depends on GitHub:** PR #76 (still a draft), run 44230207722, job 134553170419 on c720ae0.
  - Every `ci` step is green: typecheck, lint, test, test:db, check:service-key, check:deploy-env, db:check, test:move.
  - The log shows 137 `ok:` lines, `test:move OK`, the real bash 3.2 `t_static` checks of both scripts, `t_freeze`, and all S6 asserts listed above.
  - The `images (web/worker)` jobs were still running when I wrote this. They do not touch the changed scripts.
- impl-log vs my run: they match. The impl-log is honest that the full move did not run locally, and that the `docker run … migrate` hardening flags have no test.

### Mutation proofs (scratch copies only, tree restored)
- **check-deploy-env allow-list.** Each line was inserted after `networks: [db]` in the migrate block. Results:
  - FAIL as intended: `privileged: true`, `cap_add: [SYS_ADMIN]`, `pid: host`, `user: root`, `network_mode: host`, `ipc: host`, `volumes: [/:/host]`, `devices:`, `entrypoint:`, and `privileged: true` placed after a `# comment` line.
  - **Exit 0, a bypass:**
    - `"privileged": true`
    - `'cap_add': [SYS_ADMIN]`
    - `privileged : true` (space before the colon)
    - `<<: *priv` with a top-level `x-priv: &priv {privileged: true}`
  - I confirmed with `docker compose -f … --profile migrate config` (no daemon needed) that all four are valid compose. The effective `migrate` service has `privileged: true` or `cap_add: [SYS_ADMIN]`.
  - The security review attempt 2 (🟡7) also reports a 6-space re-indent of the whole block. I agree from reading `:113`.
  - Two cases are rejected by compose itself, so they are not bypasses: indent-6 lines under a flow value (parse error) and a duplicate `security_opt` key ("mapping key already defined").
- **S6 regex (`db-migrate-from-supabase.sh:109`).**
  - Accepted: `mingming21400/stoktok-worker:v0.3.0@sha256:<64>` and `…:v0.3.0-rc.1@…`.
  - Rejected:
    - registry or path prefixes: `docker.io/…`, `evil/mingming21400/…`
    - lookalike repositories: `stoktok-worker-evil`, `stoktok-workers`, `mingming21400x/…`
    - a missing tag or `:latest`
    - a 65-hex digest
    - a trailing newline
    - an `@` inside the tag
    - an uppercase namespace
  - It is the same pattern as `deploy-stoktok.yml:105`, and `release.yml:134` writes `$NAMESPACE/stoktok-worker:$TAG@$WORKER_DIGEST`, which matches it.
  - Reverting `:109` to the generic regex in scratch makes "a digest of another repository (exit 2)" and its message assert FAIL. The test catches the regression.

### Acceptance criteria (this attempt: Ming's 2026-11-18 list)
- [x] 🟡1, draft release PR.
  - `docs/deploy.md:113`: step 5 runs `gh pr ready --undo` after the compose commit, as Ming specified.
  - `:149`: stage 0.3 requires "open, not merged, and a draft" and gives the `isDraft` check.
  - `:190`: stage 4.1 starts with `gh pr ready`.
  - `work/ming-todo.md:39`: says the PR is a draft and is marked ready at 4.1.
  - The ming-todo stage rows are only partly done: see Issue 2.
- [ ] 🟡3, allow-list of keys on the `migrate` block plus a `privileged: true` mutation. FAILED, see Issue 1.
  - The `privileged: true` mutation proof exists (impl-log, and my run reproduces it).
  - But the allow-list accepts other valid ways of writing the same key.
- [x] Review nit 1, anchor the migrate image check. `scripts/check-deploy-env.sh:101` uses `^image: \$\{STOKTOK_WORKER_IMAGE:\?[^}]*\}$` on whitespace-trimmed lines. A commented `# image: ${STOKTOK_WORKER_IMAGE:?x}` no longer matches, because the trimmed line starts with `#`.
- [x] 🟡4, S6 repository pin, flags and header.
  - `scripts/db-migrate-from-supabase.sh:109-110`: the repository pin (mutation proofs above).
  - `:250`: `--cap-drop ALL --security-opt no-new-privileges:true`.
  - `:8-10`: header comment on the source-local exemption.
- [x] 🟡5, the S6 message is asserted. `scripts/test-db-migrate-from-supabase.sh:186`, plus the new other-repository case at `:188-189`. Both are green locally and in CI.
- [x] Stale ming-todo item. The `release/stoktok-v0.2.2` sentence is gone from `work/ming-todo.md:39`.
- [x] Nothing applies a migration to Supabase, and no secret is committed. The diff touches no source-side code path. The only sha256 strings are all-zero test digests.
- [x] Repo checks green: see Checks. test:move is CI evidence.

**On the untested `docker run … migrate` flags (`db-migrate-from-supabase.sh:250`): acceptable, not a gap that blocks.**
- The worker image runs as `USER node` (`apps/worker/Dockerfile:30`). It reads `/app/migrations` and opens a TCP connection, which needs no capability. So `--cap-drop ALL` and `no-new-privileges` cannot change its behaviour.
- The compose `migrate` service already has the same two settings.
- The first real run is runbook stage 1, the dry run, which happens before any production change. A failure there is harmless and blocks the cutover.
- A harness test would need a `--worker-image` run with a real image, which the harness has never had. The impl-log states this openly.

Ming verification after merge (carried to the PR, unchanged from attempt 1): plan steps A to I.
- That includes the step C `gh pr ready --undo` and the stage 0.3 `isDraft` check.
- Open question from the security review: whether the orchestrator's token may convert the deployment PR to a draft. If it cannot, Ming does it before stage 0.

### Issues
#### Issue 1 — 🟡 should-fix — the 🟡3 allow-list misses valid YAML spellings of a key
- **Where**: `scripts/check-deploy-env.sh:113`, `sed -n -E 's/^    ([A-Za-z_]+):.*/\1/p'`.
- **Expected**: Ming asked for an allow-list. Any top-level key of the `migrate` block that is not one of `image restart profiles env_file cap_drop security_opt command networks` must FAIL, however it is written.
- **Actual**: the sed only extracts unquoted `[A-Za-z_]+` keys at exactly 4 spaces, followed immediately by `:`. Every other line is ignored, so these pass with exit 0:
  - `    "privileged": true` and `    'cap_add': [SYS_ADMIN]` (quoted keys)
  - `    privileged : true` (space before the colon)
  - `    <<: *priv` (a YAML merge key pointing at a top-level `x-…: &priv` mapping)
  - the whole block re-indented to 6 spaces (security 🟡7c)

  I verified the first four with `docker compose config`: the resulting `migrate` service is privileged or has `cap_add`. Merge keys are a common compose idiom, so this is a realistic accidental edit, not only a hostile one.
- **Fix instruction**:
  1. Replace the sed/grep at `:113-117` with a per-line deny-by-default check. Every line of `$migrate_block` after the `  migrate:` header that is not blank and not a comment (`^[[:space:]]*(#|$)`) must match `^    (image|restart|profiles|env_file|cap_drop|security_opt|command|networks): [^[:space:]]`. Print every non-matching line in the FAIL message. Note that `svc_block` includes the header line, so skip it, or match it as `^  migrate:$`.
  2. All allowed values in the draft are single-line, so no continuation lines need to be allowed. I ran this rule against the current draft and it reports no offending lines.
  3. Record mutation proofs in the impl-log, each giving exit 1:
     - `"privileged": true`
     - `privileged : true`
     - `<<: *x` with a top-level `x-x: &x {privileged: true}`
     - the block re-indented to 6 spaces

     Also record that `privileged: true` still FAILs and the unmodified tree gives exit 0.
  4. The fix stays inside `check-deploy-env.sh`. Do not change the compose draft.

#### Issue 2 — 🟡 should-fix — ming-todo stage rows do not mention the draft
- **Where**: `work/ming-todo.md:42` (stage 0) and `:46` (stage 4).
- **Expected**: Ming's 🟡1 note says that "stage 0.3 and ming-todo check 'PR is a draft'". The runbook does this at `docs/deploy.md:149,190`.
- **Actual**: `:42` says "open and not merged" with no draft check. `:46` says "merge the STK-094 release PR" with no "mark ready" step. Only the approval item at `:39` mentions the draft.
- **Fix instruction**:
  - In `:42`, change "STK-094 release PR open and not merged" to "STK-094 release PR open, not merged and a draft (`isDraft` true)".
  - In `:46`, change "merge the STK-094 release PR" to "mark the STK-094 release PR ready (`gh pr ready`), merge it".
  - Doc only.

### Rules R1–R10
No violations found.
- R1, R2, R4, R5, R6, R9: no app code changed.
- R3: the target URL reaches the worker container only through the inherited `-e STOKTOK_DATABASE_URL` (`:249-250`). It is never on argv, and S6 now limits which repository receives it.
- R7: every changed file is in the plan or is required by Ming's listed findings. `security-review.md`, `backlog.md` and `ticket.md` are orchestrator workflow files.
- R8: the S6 change has mutation-proven tests. The allow-list's mutation proof does not cover the bypasses (Issue 1).
- R10: n/a.

### Nits (do not block)
1. `scripts/test-db-migrate-from-supabase.sh:373`: the first `wdigest=` assignment is dead, because `:381` assigns it again before its only use. Drop `:373`.
2. Security 🟡8 (open the PR as a draft right after `release.yml` creates it, not after the compose commit) contradicts Ming's own wording ("converts … to draft after the compose commit"). I do not ask for it here. It is for Ming to decide, or for STK-097.
3. `/var/tmp/stk094-*.log` are leftovers from earlier runs, outside the repo. They are harmless and can be removed.

### Follow-ups (out of scope)
- 🟡2 (migrate detection that fails closed) and 🟡6 (`read_only`, "no internet egress" wording) are in STK-097 as Ming decided. The same goes for security 🟡8 if Ming wants it.
- Optional, more robust allow-list: `docker compose config --format json` plus `jq` on `.services.migrate | keys`, if CI has compose. STK-097.
- Carried from attempt 1: the CLAUDE.md "Current state" line after stage 5; the `profiles: [jobs]` check on the worker; the web/worker network checks being "contains"; the unscheduled jobs (R-7); the stale ming-todo lines 13-16; ADR 0003 line 10.

## Attempt 3 — 2026-11-18
Verdict: PASS

Scope of this attempt:
- Attempt 2 Issues 1 and 2, security 🟡8, and the `wdigest` nit (orchestrator note of 2026-11-18). Rework commit 9603f59.
- HEAD is 8caedfc. It adds only workflow files on top of the rework: `security-review.md` Attempt 3 and the backlog/ticket state.

Every finding from attempt 2 is closed. I found new ways around the migrate check, and so did the security review (🟡9). They work by changing how the `migrate` block is found, not what the block may contain. So they fall outside what Ming asked for in 🟡3 (an allow-list of keys on the `migrate` block). I record them as a 🟡 should-fix for STK-097, not as a blocker; see "Remaining gap". Ming should read that section before merging.

### Checks (run by reviewer, on 8caedfc)
- typecheck: green (`pnpm typecheck`, exit 0).
- lint: green (`pnpm lint`, exit 0).
- test: green (`pnpm test`, exit 0). Counts: core 834, sources 35, ai 184, db 169, worker 310, web 360. These match impl-log Attempt 3.
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n`: clean on `scripts/*.sh` and `deploy/deployment-repo/apps/stoktok/*.sh`.
- test:db and db:check: not re-run locally. Nothing under `packages/` or `db/` changed since attempt 2, where both were green. CI ran both on 8caedfc (below).
- CI, read through the REST API: PR #76 is open and still a draft, head 8caedfc. Run 44231139163 `ci` completed with conclusion success.
  - Every step is green: typecheck, lint, test, test:db, check:service-key, check:deploy-env, db:check, test:move.
  - The job log (134556308466) shows `OK: deploy env lists consistent`, 137 `ok:` lines and `test:move OK`.
  - `images (worker)` and `images (web)` are success. The push was skipped, as on any PR.
- impl-log vs my run: they match.

### Mutation proofs (scratch `git archive` copy only)
For each case below I edited the draft compose. Then I ran `check-deploy-env.sh` and `docker compose config --profile migrate` (Compose v5.6.1, no daemon; env_file pointed at an empty scratch file) to see the effective `migrate` service.

**Attempt-2 and security-7 cases: now all FAIL.** Each line was added after `networks: [db]`.

| Case | Check result |
|---|---|
| `"privileged": true` | rc 1 (compose: privileged) |
| `'cap_add': [SYS_ADMIN]` | rc 1 (compose: cap_add) |
| `privileged : true` | rc 1 |
| plain `privileged: true` | rc 1 |
| `<<: *priv` with `x-priv: &priv` placed before `services:` | rc 1, by both the allow-list and the anchor/merge check (compose: privileged) |
| `<<: *1p` (anchor name starts with a digit) | rc 1, by the allow-list (the anchor regex misses it, but the `<<` matches) |
| block re-indented to 6 spaces, with or without `privileged` | rc 1 |

**New cases from the orchestrator's list.**

| Case | Check result |
|---|---|
| flow-style `  migrate: {image: …, privileged: true, …}` | rc 1 ("lacks migrate", env_file count) |
| tab-indented key, or a tab after 4 spaces | rc 1 (compose also refuses to parse it) |
| `command: >-` / `  migrate` / `privileged: true` | rc 1 (needs the exact `command: ["migrate"]` line) |
| `command: \|` added as a second key | rc 1 (compose: duplicate key) |
| `!!str privileged: true` | rc 1 |
| `? privileged` / `: true` | rc 1 |
| `extends: stoktok-worker`, or `extends:` as a block | rc 1 |
| `  migrate:` with trailing spaces or a trailing comment | rc 1 ("lacks migrate"), so it fails closed |

**Indent-6 list items** pass the check, as they should, but none of them gets past compose:
- `      - privileged: true` under migrate's `env_file:` gives rc 0 from the check, but compose rejects it ("path attribute … is missing").
- `      - privileged: true` under a second `networks:` is a duplicate key, which compose rejects.
- The required exact lines force flow values on every allowed key except `env_file`, so no list item can reach any other key.

**A second `migrate:` definition inside `services:`** (unquoted or quoted) is a duplicate key, which compose rejects. One placed after `networks:` becomes a network, which compose rejects ("additional properties").

**False positives:**
- The real draft passes (rc 0).
- The anchor regex `(^|[[:space:]:,{[-])[&*][A-Za-z_]` matches nothing in the draft. Common shell or cron values (`a && b`, `*/5`, `"*.json"`) do not match it either.

### Remaining gap: the `migrate` block can be found in the wrong place (🟡 should-fix, carried to STK-097)
`svc_block` (`scripts/check-deploy-env.sh:58-62`) checks the first line equal to `  migrate:`. Nothing ties that line to `services:`, nothing checks that it is the only one, and the check reads only one YAML document. For each of the following I verified that `check-deploy-env.sh` exits 0 while `docker compose config` shows `migrate` with `privileged: true`:
1. **Decoy under an `x-` key:** an `x-note:` before `services:` holding a clean copy of the migrate block, plus `privileged: true` added to the real one. This is security 🟡9a.
2. **Decoy as a block scalar:** the same, with the decoy as the text of `x-doc: |`.
3. **Second YAML document:** `---`, then `services:` / `  migrate:` / `    privileged: true` appended at the end. Compose v5.6.1 merges the documents, which confirms security 🟡9b. I did not check the runner's compose version.
4. **`include:`** at the top level, pointing at a file that defines `migrate` with `privileged: true`. Compose merges it, and the check never reads the included file.
   - In the deployment repo this needs a second file under `apps/stoktok/`. Runbook stage 0.3 and step 4 accept exactly two changed files, so an include from the deployment repo would be caught there.
   - Cases 1 to 3 would not be caught that way: they would already be in the stoktok draft, and the step 4 `cmp` only compares the release PR's compose with that draft.

Why this does not block PASS:
- What Ming asked for in 🟡3 is now met. Every line inside the `migrate` block is allow-listed, every spelling raised in attempt 2 FAILs, and the `privileged: true` mutation is proven.
- None of the four cases is a realistic accidental edit, unlike a merge key. Each one deliberately adds a second definition of the service.
- `check-deploy-env.sh` is a tripwire, not a security boundary (STK-097 says so). The real protection is review of the stoktok PR and Ming's merge of the deployment PR.
- The security review rates this low and says it does not block PASS.

**Fix for STK-097** (about four lines plus mutation proofs for cases 1 to 4):
- FAIL on any `^(---|\.\.\.)` line.
- Allow only `name`, `services` and `networks` as top-level keys (`^[^[:space:]#][^:]*:`). This also blocks `x-*` and `include:`.
- Require exactly one line matching `^[[:space:]]*["']?migrate["']?[[:space:]]*:`.
- Start `svc_block` only after `^services:$`.
- Or, more robustly: `docker compose config --format json` with dummy env, then `jq '.services.migrate | keys'`. Compose is available on GitHub-hosted runners.

### Acceptance criteria (this attempt)
- [x] **Attempt 2 Issue 1 / security 🟡7**, migrate allow-list:
  - `scripts/check-deploy-env.sh:112-119`: deny-by-default per line, and the offending lines are printed.
  - `:121-124`: merge keys, anchors and aliases are rejected anywhere.
  - Evidence: the mutation tables above. The draft passes.
- [x] **Attempt 2 Issue 2**, ming-todo stage rows:
  - `work/ming-todo.md:42` says "open, not merged, and a draft".
  - `:46` says "mark the STK-094 release PR ready (`gh pr ready`), then merge it".
- [x] **Security 🟡8**, draft timing:
  - `docs/deploy.md:110` (step 2) converts the PR to a draft right after `release.yml` opens it, before the compose commit (step 3), with a fallback to Ming at stage 0.3.
  - `:113` (step 5): "stays a draft".
  - `:149` (stage 0.3): the `isDraft` = `true` check is still there.
  - `:190` (stage 4.1): `gh pr ready` before the merge.
- [x] **`wdigest` nit**: `scripts/test-db-migrate-from-supabase.sh:373` is now the only assignment, and its only use is `:382`. test:move is green in CI.
- [x] Nothing applies a migration to Supabase, and no secret is committed. The diff is check script, docs and a test line. The only sha256 strings are all-zero test digests.
- [x] Repo checks are green: see Checks above.
- Scope: the four files in 9603f59 are exactly the ones the rework note asked for. `backlog.md`, `ticket.md`, `review.md` and `security-review.md` are workflow files.

Ming verification after merge (carried to the PR): plan steps A to I, unchanged from attempts 1 and 2. These include the step 2 `gh pr ready --undo` (or Ming at stage 0.3 if the orchestrator's token cannot do it), the stage 0.3 `isDraft` check, and `gh pr ready` at stage 4.1.

### Issues
None that block. The remaining gap above is 🟡 should-fix and goes to STK-097.

### Rules R1–R10
No violations found.
- R1, R2, R4, R5, R6, R9: no app code changed.
- R3: no new credential path.
- R7: the diff stays within the rework note.
- R8: the guard change has mutation proofs (impl-log Attempt 3, and the tables above).
- R10: not applicable.

### Nits (do not block)
1. `docs/deploy.md:114` (step 6): "cut the next version and repeat step 3" should be "repeat steps 2-5". Otherwise a retry PR is not converted to a draft until stage 0.3 catches it. This is security 🟡10.
2. `work/ming-todo.md:39` still reads in the old order: "adds the compose commit … converts that PR to a draft". Reword it to "converts it to a draft as soon as it opens, then adds the compose commit".
3. `docs/deploy.md:149` (stage 0.3) gives the `isDraft` check but does not say "if `false`, run `gh pr ready --undo` now", which is the fallback that step 2 points to.
4. The anchor regex at `scripts/check-deploy-env.sh:121` misses names that start with a digit (`&1`, `*1`). This does no harm today, because the merge still needs `<<`, which is caught.

### Follow-ups (out of scope)
- STK-097:
  - the remaining gap above (security 🟡9)
  - 🟡2 and 🟡6, as Ming decided
  - allow-lists for the web and worker blocks, which still use only deny-lists
- Carried from attempts 1 and 2:
  - the CLAUDE.md "Current state" line after stage 5
  - the `profiles: [jobs]` check on the worker
  - the web/worker network checks being "contains"
  - the unscheduled jobs (R-7)
  - the stale ming-todo lines 13-16
  - ADR 0003 line 10

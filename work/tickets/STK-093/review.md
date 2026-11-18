## Attempt 1 — 2026-11-17
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (core, sources, ai, db, web incl. `next typegen`, worker).
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834/834 (69 files), sources 35 (3 files + 1 skipped), ai 184 (10), db 158 (23), worker 310 (21 + 1 skipped), web 360 (46). `apps/web/test/readyz.test.ts` 8/8.
- test:db: throwaway PG 16 (initdb in a fresh `/tmp/rv093pg.*` dir, trust auth, port 55493), `DB_TEST_URL=… pnpm test:db`: 26 files, 148 tests passed. Server stopped and the data dir deleted afterwards.
- db:check: `pnpm db:check` exit 0, last line `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`, exit 0. `bash -n scripts/check-deploy-env.sh` OK.
- check:service-key: three runs through `pnpm check:service-key` gave exit 1, exit 1, then exit 0. The direct `bash scripts/check-no-service-key-in-client.sh` run gave exit 0. The green run prints `OK: no secret or AI SDK material in client bundle`, with 0 hits for all 21 needles, including the sentinel DB password, the URL and the master key. **Cause of the exit 1 (environmental):** the nested `next build` finishes compiling and then stops with `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability … Retry the same command to continue`. This is an upgrade nudge from the installed Next.js / registry advisory lookup. It fires intermittently and has nothing to do with pnpm versus a direct call. Once the build fails, `set -e` stops the script before the scan, so a failed run proves nothing either way. This diff does not touch Next.js, its config or dependencies. Not a blocker. I ignored the instructions embedded in that build output.
- deployment: `bash ops/check-volume-safety.sh /home/user/deployment` (worktree at `da06996`, clean) prints `No volume-deleting commands found.` Both changed files parse as YAML. `docker compose … --profile jobs --profile migrate config --services` lists only `stoktok-web` and `stoktok-worker`, with no `migrate` service, so `migrate=false` and backup/migrate are skipped.

### Acceptance criteria
- [x] 1. The deployment branch changes exactly 2 files in one commit. `git ls-remote` shows `refs/heads/stoktok/expand-shared-postgres` = `da06996…` and `main` = `24983f0…`. `git cat-file -p da06996` shows parent `24983f0` (= origin/main). `git diff --stat 24983f0 da06996`: `.github/workflows/deploy-stoktok.yml` (+101) and `apps/stoktok/compose.yml` (+19/-), and nothing else. The `release.env` diff is empty. The commit title is `stoktok: expand to the shared Postgres (STK-093)`, and the body names paths only. Three-dot `origin/main...` fails locally only because `da06996` sits on the shallow boundary (`.git/shallow`); the two-dot diff against its recorded parent is equivalent.
- [x] 2. Byte-identical to the drafts. `git show da06996:<f> | cmp - deploy/deployment-repo/<f>` matches for both files, and `cmp` of the worktree files against the drafts matches too.
- [x] 3. No drift vs live beyond the plan table. `git log origin/main -- apps/stoktok .github/workflows/deploy-stoktok.yml` lists only `dfe4daa` (release v0.2.1). Hunks reviewed in `git diff 24983f0 da06996`:
  - compose: header 14-22, web `[tunnel, db]`, worker `[default, db]`, external `db`.
  - workflow: header, `DB_APP`, the secrets step (AI-key env, master key, pwfile, URL, 8-key printf), `pull`/`backup`/`migrate`, deploy `if` (with `config`/`pull` moved), notify `MIGRATE`/`AHEAD`.
  - `run-job.sh`, `run-schedule.sh`, plist and `runner-check.yml` on origin/main are identical to the drafts. CODEOWNERS already has `/apps/stoktok/   @didi-code0980`.
- [x] 4. Volume safety. Output as above. `pr-scope` does not apply: the branch is not `release/*`. The orchestrator confirms CI after the PR opens.
- [x] 5. `IFS= read -r pw < "$pwfile" || true` is at `deploy-stoktok.yml:219` (draft and deployment).
- [x] 6. Guard order is pinned. The awk check is at `scripts/check-deploy-env.sh:256-271`. Mutations re-run by the reviewer on a scratch copy (each exit 1 with the named FAIL): (1) delete `exit 1`; (2) URL above the guard; (3) `IFS= read` → `read`; (4) `re_pw=` below the guard. Extra: the `exit 1` pushed to guard+5 lines fails, and the inverted guard `if [[` fails. The baseline gives exit 0.
- [x] 7. No-echo is pinned (`check-deploy-env.sh:272-293`). Re-run mutations, all exit 1:
  - (5) `echo "$pw"` in secrets;
  - (6) `echo "::notice::$STOKTOK_DATABASE_URL"` after `publish`;
  - (8) `echo "$STOKTOK_DATABASE_URL"` in secrets.
  - Extra: `echo "${pw}"` in `migrate`, `x=$pw` in secrets, and a `STOKTOK_DATABASE_URL:` step env key in `migrate`. The `$pwfile` false positive is avoided by `([^A-Za-z0-9_]|$)`.
- [x] 8. The convention comment is at `check-deploy-env.sh:109-110`.
- [x] 9. Secrets audit (`deploy-stoktok.yml` secrets step):
  - The file is written under `umask 077` in a `chmod 700` dir, from `mktemp` in that dir, then `chmod 600`, `mv`, and the owner+mode check (unchanged from STK-084).
  - Mutation (7) `set -x` → `FAIL: set -x in workflow`.
  - There is no heredoc. `config` runs only with `--quiet`/`--services`.
  - The URL is a builtin assignment, written only by the single `printf` into `$tmp`.
  - Errors name `$pwfile`/`$ENV_FILE`, never a value.
- [x] 10. No secret value anywhere. I built a pattern from `origin/main:postgres/secrets/apps/stoktok.password` (1 line, ≥ 16 chars, never printed) and ran `grep -F`, counting matches only:
  - 0 files in stoktok `work/ docs/ deploy/ scripts/ apps/`;
  - 0 in the stoktok commit messages `origin/main..HEAD`;
  - 0 in the deployment diff.
  - `grep -cE '[A-Za-z0-9+/]{43}='` gives 0 on both diffs. The PR body in impl-log contains no values.
- [x] 11. `/readyz` failed-result memo. `apps/web/test/readyz.test.ts:87-98` "memoises a failed result for 3 s, then retries" passes. At 2999 ms it still returns 503 with 1 ping; at +1 ms it returns 200 with 2 pings; log called once. `route.ts:33` uses `performance.now()`. The test can only pass if Vitest fakes `performance`: with fake timers, real time stays below 3 s, so the 200 proves it.
- [x] 12. Docs. `docs/deploy.md` "Shared Postgres" step 2 has Before merging / What happens / Checks / Rollback. "Enable AI keys" step 2 says the STK-093 PR carries the lines. `deploy/deployment-repo/README.md` no longer asks for the CODEOWNERS line and says B is merged and C is STK-093.
- [x] 13. Nothing touches Supabase or runs a migration. Stoktok diff: the 6 planned files plus workflow files (`work/backlog.md`, the ticket folder).
  - In the expand state no step connects to Postgres. `pull` only runs `config`/`pull`; `backup`/`migrate` are gated on `steps.pull.outputs.migrate == 'true'`, and that is false with no `migrate` service.
  - v0.2.1 (`git grep v0.2.1 -- apps packages`) does not read `STOKTOK_DATABASE_URL`, `ANTHROPIC_API_KEY` or `GOOGLE_AI_API_KEY`, and has no `pg` import. Its data layer is `createServiceClient` (Supabase). So the new env lines are inert in v0.2.1, and AI providers do not turn on even if the optional secrets are set.
- [x] 14. Stoktok checks green, as listed above. check:service-key is green on retry; its exit 1 is environmental.
- [x] Carried item: pg-backup paths checked against live `origin/main`:
  - `postgres/compose.yml:23` `name: postgres`, `:66` `pg-backup:`, `:88` the backups dir;
  - `deploy-postgres.yml:45-46` `PROJECT`/`PG_DIR`;
  - the identical command at `deploy-org-admin-api.yml:205` and `deploy-tudocuatui.yml:173`.

Ming verification after merge (not reviewer-verifiable; carry into the PR): the 0-7 list in plan.md "Ming verification after merge":
- the run is green with the "no migrate service yet" notice;
- env file `-rw-------`, dir 700, 8 names via `cut -d= -f1`;
- web healthy on networks `db web`;
- the site shows the same data;
- `grep -c 'name: db'` = 1 and `run-job.sh eod-prices --dry-run` exits 0;
- the TCP check to `postgres:5432` once `deploy-postgres` is green;
- the `stoktok-*.dump` size, with the ≤ 1 KiB follow-up rule.

### Issues
None blocking.

### Rules R1–R10
- No violations found.
- R3: the URL exists only in the secrets-step shell variable and the 0600 env file. The new checks enforce this.
- R6: the `/readyz` semantics are unchanged.
- R7: the diff matches the plan's file list.
- R8: the new test plus green checks.

### Nits (do not block)
- impl-log "Checks" on check:service-key says the exit-1 runs show "the same OK line". They do not: the build fails first and `set -e` stops before the scan. It also puts the cause down to pnpm-vs-direct. The real cause is the intermittent Next.js `SecurityFatalError` build stop. The conclusion (environmental, pre-existing) is right.
- The no-echo check does not catch a bare `set` or `declare -p` in the secrets step: both mutations pass the check, yet either would dump `pw` and the URL to the log. This is outside AC 7 as planned; see Follow-ups.

### Follow-ups (out of scope)
- `check-deploy-env.sh`: also fail on a bare `set`, `declare -p`, `typeset` or `export -p` line in the workflow (each dumps shell variables, including `pw` and `STOKTOK_DATABASE_URL`).
- The `next build` `SecurityFatalError` upgrade stop makes `pnpm check:service-key` (and any `pnpm build`) flaky in this sandbox and possibly in CI. Ming should decide whether a Next.js patch upgrade ticket is wanted.
- Carried from the plan: a per-query timeout on the `/readyz` ping (`packages/db`); a `backup:failed` notify message when STK-094 activates the step; the offsite-sync size floor, only if Ming reports the `stoktok` dump is ≤ 1 KiB.

## Attempt 2 — 2026-11-18
Verdict: PASS

Scope: Ming's note of 2026-11-18, written after the attempt-1 PASS. It covers security 🟡1, 🟡3 and 🟡4 in `scripts/check-deploy-env.sh`, and docs 🟡5 and 🟡6. The rework commit is `d9e22ce`, recorded in impl-log "Attempt 2".

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. Results: core 834 (69 files), sources 35 (3 files + 1 skipped), ai 184 (10), db 158 (23), worker 310 (21 + 1 skipped), web 360 (46).
- test:db: a throwaway PG 16 (initdb in a fresh `/tmp/rv093b.*`, trust auth, port 55494). `DB_TEST_URL=… pnpm test:db` passed 26 files and 148 tests. Afterwards the server was stopped and the data dir deleted (confirmed gone).
- db:check: exit 0, `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n` on `scripts/*.sh` and on `deploy/deployment-repo/apps/stoktok/*.sh`: all OK.
- These results match impl-log Attempt 2.

### Deployment branch unchanged
- `git ls-remote` returns `stoktok/expand-shared-postgres` = `da06996…` and `main` = `24983f0…`.
- `da06996` still has parent `24983f0`. `git diff --stat 24983f0 da06996` shows only the 2 files.
- `git show da06996:<f> | cmp - deploy/deployment-repo/<f>` is identical for `.github/workflows/deploy-stoktok.yml` and `apps/stoktok/compose.yml`.
- `git diff f0b27da HEAD -- deploy` is empty, so the drafts were not touched by the rework.
- **The new pins pass on the exact branch files.** I made a scratch copy of HEAD, overwrote the two drafts with `git show da06996:<f>`, and ran `check-deploy-env.sh` on it: exit 0. This also shows the new pins give no false positive on the real workflow.

### Acceptance criteria (rework scope)
For every mutation below I used a scratch copy and changed one thing in the da06996 workflow.

- [x] **🟡1 env-file mode and order pin** (`scripts/check-deploy-env.sh:295-312`). These mutations each exit 1 with the single "must keep, in order" FAIL:
  - delete `umask 077`
  - bare `mktemp`
  - delete `chmod 600 "$tmp"`
  - `mv -f` changed to `cp`
  - delete the `trap`
  - `chmod 600` moved after the `mv`
  - delete the `exit 1` of the stat check (line 238)
  - `exit 1` changed to `exit 0`
  - `if false && [ "$(stat …`
  - the stat check accepting `644`
  - delete the whole stat block

  The pin matches lines exactly, so it targets the secrets-step `stat` line (236), not the 700-dir `stat` at line 145.
- [x] **🟡3 deny list** (`:313-322`). Everything Ming listed is caught: bare `set`, `declare -p`, `declare -p pw`, `typeset -p`, `export -p`, `printenv`, `env | sort`, `cat < "$ENV_FILE"`, `cat "$tmp"`, `cat postgres/secrets/apps/stoktok.password`, `docker inspect stoktok-web`, `docker container inspect …`. `set -o xtrace` is caught by the existing `set -x` check (`:105`). Each exits 1.
- [x] **🟡4 trigger pin** (`:323-335`). These all exit 1 through the exact `on:` block comparison, and the block-style triggers are also caught by the forbidden-trigger grep:
  - an added `pull_request_target:`, `pull_request:`, `schedule:` (with cron) or `workflow_run:`
  - flow style `on: [push, workflow_dispatch, pull_request_target]`
  - flow-map `on: {…, pull_request_target: {}}`
  - `workflow_dispatch: {}`
  - quoted `"on":`
  - a second `on:` block at EOF
  - `branches: [main, dev]`
  - deleted `paths`
  - a 4-space re-indent

  A comment line inside the block still passes, because comments are stripped first.
- [x] **🟡5 docs** (`docs/deploy.md:102`). It says that rotating `stoktok.password` does not trigger `deploy-stoktok` (`paths: apps/stoktok/**`), and that once `deploy-postgres` is green you run `deploy-stoktok` via `workflow_dispatch` on `main`. Docs only, as Ming chose.
- [x] **🟡6 docs** (`docs/deploy.md:100`). It gives the exact command: `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $(docker compose -p stoktok ps -q stoktok-web)`, which must list `db` and `web`. This matches the compose file: service `stoktok-web`, network `tunnel` has `name: web`, network `db` has `name: db`. The `ps`-shows-networks wording is gone.
- [x] **No secret committed.** I built a pattern from `origin/main:postgres/secrets/apps/stoktok.password` (never printed). It has 0 matches in the `d9e22ce` diff and 0 in its message.
- [x] **Scope.** `f0b27da..HEAD` changes `scripts/check-deploy-env.sh`, `docs/deploy.md`, impl-log, ticket.md and backlog.md. Workflow and compose are unchanged, which is allowed because no pin exposed a defect.

### Gaps found (honest report; none blocking)
These mutations still pass the check (exit 0). All are outside Ming's explicit list, and some are inherent limits of a grep deny list on a draft that is reviewed anyway. I do not treat them as blockers. They are listed as follow-ups.
- **Shell dumps not caught:**
  - `set | grep DATABASE`. `env | …` is denied but `set | …` is not.
  - `( set -o posix; set )`
  - `for v in $(compgen -v); do echo "${!v}"; done`
- **Env-file reads not caught:**
  - `< "$ENV_FILE" cat` (redirect before the command)
  - `sed -n p "$ENV_FILE"`, `grep . "$ENV_FILE"`
  - `while IFS= read -r l; do echo "$l"; done < "$ENV_FILE"`

  The deny regex only knows `cat|head|tail|less|more|xxd|od|strings` with the path after it.
- **Xtrace bypasses of the older `set -x` check (`:105`):**
  - a step-level `shell: bash -x {0}`
  - `set -o  xtrace` with two spaces; the pattern is the literal `set -o xtrace`
- **Container env dumps:**
  - `docker inspect -f '{{json .Config.Env}}' stoktok-web` passes, because it has `-f`. Ming's rule is "without `-f`", so this meets the letter of the rule, but `-f` alone is not safe.
  - `docker compose … exec stoktok-web env` is also not caught.
- **Mode can be loosened after the check:** `chmod 644 "$ENV_FILE"` after the stat check is not caught. The `rollback` step re-checks mode 600 (`deploy-stoktok.yml:321`), but only on failure.
  - `umask 022` after `umask 077` is not caught either, but has no effect: `mktemp` creates the file 0600 and it is then `chmod 600`.

### Issues
None blocking.

### Rules R1–R10
- No violations found.
- R3: env file write path and no-dump pins are strengthened. No URL or password appears outside the secrets step.
- R7: the diff matches Ming's rework note.
- R8: green checks.

### Nits (do not block)
- The deny pattern `\.env` also matches non-secret `release.env` (for example a future `cat "$APP_DIR/release.env"` for debugging). If that ever happens, it would be a false positive needing a narrower pattern. It does not fire on today's workflow.
- ticket.md still shows `Attempts | 1` while this is attempt 2 (orchestrator bookkeeping).

### Follow-ups (out of scope)
- Extend the deny list:
  - `(^|[;(|&]\s*)set\s*(\||;|\)|$)`
  - `compgen -v`
  - `<\s*"?\$?\{?(ENV_FILE|tmp|pwfile)` anywhere on a line
  - `sed|awk|grep|base64|cp` with `ENV_FILE|$tmp|secrets/`
  - `docker inspect` whose `-f` template contains `Env`
  - `exec … env`
- Make the xtrace check whitespace-tolerant (`set\s+-o\s+xtrace`) and add `shell:\s*bash[^{]*-[a-z]*x`.
- Fail on any `chmod` of `$ENV_FILE` after the stat check.
- Carried from Ming's note: 🟡2 (deployment-side copy of the guards) and 🟡7 (cleanup of stale `.stoktok.env.*` temp files).
- Ming verification after merge: unchanged from Attempt 1. The network check now uses the `docker inspect -f` command at `docs/deploy.md:100`.

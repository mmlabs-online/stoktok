# STK-094 security review

## Attempt 1

**Verdict: no 🔴, 6 🟡 (all low or medium).** The diff is sound and none of the findings blocks PASS. One of them (🟡1) is a cheap process change to make before step C.

### Findings

**Checked and OK**
- **`migrate` privileges** (`deploy/deployment-repo/apps/stoktok/compose.yml:66-76`). It has `cap_drop: [ALL]`, `no-new-privileges`, `restart: "no"`, `profiles: [migrate]`, no ports, no healthcheck and no `environment:`. The image is `${STOKTOK_WORKER_IMAGE:?}`, digest-pinned through `release.env` (the regex is in live `deploy-stoktok.yml:105`). The DB URL comes only from `env_file`: no interpolation, nothing on argv.
- **Network.** `db` is created `--internal` (`/home/user/deployment/postgres/compose.yml:15,115`), so `networks: [db]` means no internet egress.
- **Can the app deploy without a successful migrate?** In the live workflow, no:
  - `backup` and `migrate` have no status function, so they get the implicit `success()`. A failed backup skips migrate.
  - `deploy` requires `migrate.outcome == 'success'` whenever `migrate=true` (`deploy-stoktok.yml:293`).
  - On a migrate failure, `publish` and `rollback` are skipped too.
  - The runbook row "Release, `migrate` failed" (`docs/deploy.md:228`) correctly says main still pins vX.Y.Z and has to be reverted first.
- **Can the app write to two databases at once?** Not through the app. R-1 confirms v0.3.0 has no data path to Supabase. The `SUPABASE_*` lines that stay in the env file are only read by v0.2.1. The remaining windows are operational ones: the up-to-120 s `--wait` (runbook 4.1 says don't use the site), the 14-day revert (data loss is documented) and 🟡1 below.
- **Rollback.** A single merge of the two-commit PR means `BEFORE` brings back the expand compose and v0.2.1 together (`deploy-stoktok.yml:127,331`).
- **Health check exposure** (`apps/web/app/readyz/route.ts`):
  - The body is only `ok`/`unavailable`, and the log carries only the error code.
  - The DB ping is memoised for 3 s and times out at 2 s.
  - The public path is an exact match or a `/readyz/` prefix (`apps/web/proxy.ts:7-11`).
  - Stage 5.3 checks that Access answers 302/403, and `docs/deploy.md:105` forbids an Access bypass.
- **Release sequence:**
  - `release.yml` never force-pushes the deployment branch, and a rerun fails because the tag already exists (`release.yml:58-60,153`). The orchestrator's second commit cannot be overwritten silently.
  - `pr-scope` runs main's copy of the workflow through `pull_request_target` and checks nothing out.
  - Byte equality with the tag's draft is checked by `cmp` (`docs/deploy.md:112`, stage 0.3).
- **Runbook secret handling:**
  - The source password is prompted, not exported (stage 0.7).
  - `docker inspect` is used only with `-f`, and the env file is never printed.
  - Dumps go to 700 directories and are chmod 600.
  - Stage 7.1 rotation now also covers aborted runs.
  - I found no new place that prints a value.
  - No secret, real digest or `NAME=value` appears in the added lines.

**🟡1 (medium): merging the cutover release PR early puts production on an empty or stale Postgres. The only guard is a PR comment.**
- **Line:** `docs/deploy.md:113` and plan step C ("Do not merge before runbook stage 4") are text-only.
- **What happens:** if the PR is merged before stage 3:
  1. `backup` runs.
  2. `migrate` applies the baseline to the empty `stoktok` DB.
  3. `/readyz` passes, because it only does a round trip.
  4. v0.3.0 goes live on an empty DB, and `agent` restarts the scheduler, so jobs write market data into Postgres.
  5. Supabase keeps the history while new writes land in Postgres.
  6. The later move refuses the non-empty target. `--force --confirm stoktok` then truncates whatever was written in between.
- **Fix (no code):**
  - In step C, after pushing the compose commit, convert the PR to draft with `gh pr ready --undo <n> --repo mmlabs-online/deployment`. GitHub blocks merging a draft.
  - Ming runs `gh pr ready` at stage 4.1.
  - Add "PR is a draft" to the stage 0.3 check and the new ming-todo item (`work/ming-todo.md:39`).
- **Defence in depth (follow-up):** a `/readyz` or migrate-side check that refuses a DB with no data, e.g. a sentinel row written by the move.

**🟡2 (low; live workflow, outside this diff): migrate detection fails open.**
- **Line:** `deploy-stoktok.yml:252-257`.
- **What happens:** `if "${compose[@]}" … config --services | grep -qx migrate` treats any `config` error as "no migrate service". Backup and migrate are then skipped and `deploy` runs (`:293`).
- **Likelihood:** low, because `config --quiet` with the same profiles just succeeded at `:250`.
- **Same path, different cause:** a cutover PR without the compose commit (step C forgotten) deploys v0.3.0 with `/healthz` and no migrate. Only the manual two-file check at stage 0.3 catches it.
- **Fix (STK-097 deployment PR):** capture `services="$(… config --services)"` under `set -e`, then grep the variable. Optionally refuse a release whose worker image has `/app/migrations` when the compose has no `migrate` service.

**🟡3 (low): the check on the `migrate` block is a deny-list.**
- **Line:** `scripts/check-deploy-env.sh:100-116`.
- **What it checks:** that the required lines are present, and that `healthcheck|ports|environment` are absent.
- **What still passes:** `privileged: true`, `cap_add:`, `volumes:` (e.g. `/var/run/docker.sock`), `entrypoint:`, `user: root`, `pid: host`, `extra_hosts:`, `devices:`.
- **Fix:** allow-list the keys. Every non-comment top-level key of the `migrate` block must be one of `image restart profiles env_file cap_drop security_opt command networks`. Add one mutation proof (e.g. `privileged: true` must FAIL).
- **Related, pre-existing:** the web and worker network checks are "contains", so `[tunnel, db, default]` passes.

**🟡4 (low): the S6 guard pins a digest but not the repository.**
- **Line:** `scripts/db-migrate-from-supabase.sh:107-109`.
- **What it accepts:** the regex `^[A-Za-z0-9._/:-]+@sha256:[0-9a-f]{64}$` accepts any repository's digest.
- **Why it matters:** this image receives the target URL with the password (`:247-248`). The guard at `:244` compares only the migrations list, which a lookalike image can copy.
- **Fix:** use the deploy's own pattern for a remote source, `^mingming21400/stoktok-worker:v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?@sha256:[0-9a-f]{64}$` (`deploy-stoktok.yml:105`).
- **Two smaller notes:**
  - The exemption depends on whether the *source* is local, but the secret at risk belongs to the *target*. That is acceptable because production runs are always remote; state it in the header comment.
  - The script's own `docker run … migrate` (`:248`) has no `--cap-drop ALL --security-opt no-new-privileges:true`, unlike the compose service. Add them for parity, which would also make stage 1 a real test of the hardened `migrate` (the plan's assumption that "stage 4 is the first real test" goes away).

**🟡5 (nit): one S6 assert does not check its message.**
- **Line:** `scripts/test-db-migrate-from-supabase.sh:185`.
- **Problem:** the `@sha256:<64>:x` case checks only `rc_is 2`, so another usage guard could satisfy it.
- **Fix:** add `out_has "--worker-image must be pinned by digest"`, the same N2 pattern as the cert guards.

**🟡6 (low, wording or optional hardening): what `migrate` can reach and read.**
- **Reach:** "no egress" (`compose.yml:20,75`) is true for the internet. But `db` also holds cloudflared (`/home/user/deployment/proxy/compose.yml:18`), pgAdmin (`/home/user/deployment/pgadmin/compose.yml:57`) and every app's Postgres port. Better wording: "no internet egress".
- **Env:** through the shared `env_file`, `migrate` gets all 8 names, including `SUPABASE_SERVICE_ROLE_KEY`, both AI keys and the AI master key, none of which it needs. The plan accepts this (TuDo precedent), and it adds no exposure, because the same image already runs as the worker with egress and the same file.
- **Optional:** `read_only: true` (admin-pan precedent, `/home/user/deployment/apps/admin-pan/compose.yml:21`), if the migrate runner writes nothing to disk. That is outside P3, so it is a follow-up.

### Recommendations
- **Plan step C and the R3/R6 rollout:** do 🟡1 (draft PR) as part of step C, and add "PR is draft" to stage 0.3 and `work/ming-todo.md:39`. These are doc-only edits and fit this ticket.
- **AC 2 and AC 4 (R8 mutation proof):** 🟡3 (allow-list) and 🟡5 (assert the message) are small and testable. Do them in this attempt or in STK-097.
- **R3:** 🟡4 (repository pin, and parity flags on the script's `docker run`). Recommended in this ticket, because S6 is in scope.
- **Follow-ups (STK-097, deployment-side):** 🟡2 (fail closed when detecting migrate), 🟡6 (optional `read_only`), and the earlier STK-093 🟡2: the guards still check only the stoktok draft, and `cmp` at stage 0.3 is what covers the cutover compose.

### Risks
- The cutover safety now depends on Ming doing stages 0.3 and 4.1 in the right order. Nothing mechanical stops an early merge (🟡1) or a missing compose commit (🟡2).
- `cap_drop`/`no-new-privileges` for `migrate` is first exercised at stage 4. If it breaks, the outcome is the documented "migrate failed" path (old release still pinned, revert required), not data loss.
- Once the cutover lands, a Postgres outage during any later deploy turns into an automatic rollback, because health now depends on the DB. That is by design; keep it in mind for STK-095 timing.

### Open questions
1. Can the orchestrator convert the deployment PR to draft (🟡1)? Does the token it pushes with have that right?
2. Does the migrate runner write anything to the filesystem? This decides whether `read_only: true` is viable (🟡6).
3. Should S6 pin the repository name (🟡4), or is a digest of any image acceptable to Ming?

## Attempt 2

**Verdict: no 🔴. 🟡1, 🟡4 and 🟡5 are closed. 🟡3 is closed for the attempt-1 cases, but the allow-list can still be bypassed in three ways (🟡7). I found two new low-severity items (🟡8, plus a nit).** None of these blocks PASS. 🟡2 and 🟡6 are deferred to STK-097 as agreed. No secret values appear in any changed line or in this report.

### Closure of attempt-1 findings
- **🟡1, closed.**
  - `docs/deploy.md:113` adds the step `gh pr ready --undo` and says Ming marks the PR ready at stage 4.1.
  - Stage 0.3 (`docs/deploy.md:149`) now requires "open, not merged, and a draft" and gives the check: `gh pr view … --json isDraft` must say `true`.
  - Stage 4.1 (`docs/deploy.md:190`) starts with `gh pr ready`.
  - `work/ming-todo.md:39` repeats the draft and the stage-4.1 hand-off.
- **🟡3, closed for the cases I raised.**
  - `scripts/check-deploy-env.sh:101` anchors the image check: `^image: \$\{STOKTOK_WORKER_IMAGE:\?[^}]*\}$`, applied after stripping whitespace.
  - `scripts/check-deploy-env.sh:112-117` allow-lists the indent-4 keys.
  - The impl-log (`impl-log.md:75`) records these mutation proofs: `privileged: true` FAILs, `volumes:` FAILs, and an image line with an added prefix or suffix FAILs.
  - Bypasses remain; see 🟡7.
- **🟡4, closed.**
  - `scripts/db-migrate-from-supabase.sh:109` pins the repository with the same pattern as `deploy-stoktok.yml:105`. Because it is anchored, a registry-prefixed lookalike such as `evil.io/mingming21400/...` or `docker.io/...` is rejected.
  - `:250` adds `--cap-drop ALL --security-opt no-new-privileges:true` to the script's own `docker run … migrate`.
  - The header at `:8-10` explains why the exemption depends on the source.
  - The target URL still reaches the container only through `-e STOKTOK_DATABASE_URL` (inherited from the environment, not on argv).
  - I found no bypass of the S6 regex. Every character class is anchored, the digest must be exactly 64 lowercase hex, and the check at `:62` blocks shell metacharacters.
  - The only way around it is the local-source exemption (`MOVE_SRC_HOST=localhost|127.0.0.1`, matched case-sensitively). Using it requires controlling the operator's environment, so it is accepted as documented.
- **🟡5, closed.** `scripts/test-db-migrate-from-supabase.sh:186` asserts the message. A new case for another repository's digest (`:188-189`) also checks the message, and the positive case (`:383-385`) checks that no pin complaint is printed.

### New findings

**🟡7 (low): the migrate allow-list only sees unquoted keys indented by exactly 4 spaces.**
- **Line:** `scripts/check-deploy-env.sh:113`, `sed -n -E 's/^    ([A-Za-z_]+):.*/\1/p'`.
- **What still passes:**
  - a. **Quoted keys**, e.g. `    "privileged": true` or `    'volumes': [...]`. YAML accepts them and the sed does not match them.
  - b. **A YAML merge key**, e.g. `    <<: *hardening_off`, pointing at a top-level `x-…: &hardening_off {privileged: true, cap_add: [SYS_ADMIN]}`. `<<` is not in `[A-Za-z_]`, and the `x-` block is outside `svc_block`. Compose resolves merge keys.
  - c. **The whole `migrate` block re-indented to 6 spaces.** No line matches `^    [A-Za-z_]+:`, so `bad_keys` is empty. The required-line checks strip whitespace (`:100`), so they still pass.
- **Likelihood:** this targets accidental or AI edits rather than a hostile committer, so it is low.
- **Fix (one commit):**
  - Treat any line in the block that is not blank and not a comment, and is indented fewer than 6 spaces, as a top-level key. It must match `^    [a-z_]+:` exactly; anything else FAILs.
  - Fail the whole compose on any `<<:` or YAML anchor or alias (`&name` or `*name` in key or value position).
  - Add mutation proofs: a quoted `"privileged": true`, `<<: *x`, and a 6-space indent must each FAIL.
- **Optional, more robust alternative:** run `docker compose config --format json` on the draft with dummy env values, then use `jq` to compare `.services.migrate | keys` with the allow-list. This only works if CI has docker compose.

**🟡8 (low): the draft conversion comes after the compose commit, so a short window remains in which the PR can be merged.**
- **Line:** `docs/deploy.md:110-113`.
- **What happens:** `release.yml` opens `release/stoktok-vX.Y.Z` as a normal, mergeable PR at step 2. The PR becomes a draft only at step 5, after the compose commit and the check.
  - A merge between steps 2 and 3 deploys v0.3.0 without the `migrate` service. That is the 🟡2 path, and `/healthz` passes on the expand compose.
  - A merge between steps 3 and 5 is the original 🟡1 scenario.
- **Likelihood:** low. The window is short and the orchestrator controls it.
- **Fix (doc only):** move `gh pr ready --undo` to right after the PR appears in step 2, before the compose commit, and keep the `isDraft` check at step 4 and stage 0.3.
- **Open question 1 from attempt 1 is still open:** does the orchestrator's token have the write access that `gh pr ready --undo` needs? If it does not, step 5 fails, and Ming must do it at stage 0.3. The doc should say so.

**Nit: the stage rows in `work/ming-todo.md` do not mention the draft.**
- **Line:** `work/ming-todo.md:42` (stage 0) says "open and not merged" but not "draft". `:46` (stage 4) says "merge" with no "mark ready" step.
- **Why it matters little:** line 39 covers both, and the runbook is correct.
- **Fix:** add "and a draft" to `:42`, and "mark ready (`gh pr ready`), then" to `:46`. This keeps the to-do list in step with stage 0.3 and stage 4.1.

### Checked and OK
- The workflow always passes `-f "$APP_DIR/compose.yml"` (`deploy-stoktok.yml:249,276,299,332`). A stray `compose.override.yml` is therefore not loaded automatically, and that route around the allow-list does not exist.
- The `security_opt` and `cap_drop` checks are exact-line matches (`check-deploy-env.sh:105-111`). Adding a second item, e.g. `seccomp=unconfined`, FAILs.
- `scripts/db-migrate-from-supabase.sh:245`: the migrations-list `docker run` has no cap flags, but it runs with `--network none` and no secrets. Not a finding.
- Not mutation-tested: the new cap flags on the script's migrate `docker run` (`impl-log.md:77`). Stage 1 of the runbook (`docs/deploy.md:164`) is now the first real run of the hardened migrate, before production. This is acceptable for R8 because it is a shell-flag parity change, not core logic.

### Recommendations
- **AC "R8 mutation proof" / 🟡3:** fix 🟡7 in this ticket if a rework happens anyway; it is about five lines plus three mutations. If not, add it to STK-097.
- **🟡1 hardening:** fix 🟡8 and the ming-todo nit in this ticket. Both are doc-only.
- **Carry to STK-097:** 🟡2 (fail closed when detecting migrate, which also covers 🟡8's first window mechanically) and 🟡6.

### Risks
- An early merge is now blocked mechanically only after step 5. Before that it depends on ordering (🟡8).
- The allow-list can be bypassed with valid YAML (🟡7), so it is a guard against mistakes, not a security boundary.

### Open questions
1. Can the orchestrator's push token convert the deployment PR to draft? If not, who does it, and when?
2. Is `docker compose` available in the CI job that runs `check-deploy-env.sh`? This decides whether the `config --format json` allow-list is an option.

Files: /home/user/stoktok/scripts/check-deploy-env.sh, /home/user/stoktok/scripts/db-migrate-from-supabase.sh, /home/user/stoktok/scripts/test-db-migrate-from-supabase.sh, /home/user/stoktok/docs/deploy.md, /home/user/stoktok/work/ming-todo.md, /home/user/stoktok/work/tickets/STK-094/impl-log.md

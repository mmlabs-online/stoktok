# STK-093 security review

## Attempt 1

**Verdict: no 🔴. 7 🟡.** The workflow handles secrets correctly. The gaps are in what `check-deploy-env.sh` actually pins, plus two documentation and operations holes.

**Limits on what I checked.** I only had Read, Grep and Glob, so I could not run `git show origin/main:<path>` or `cmp`.
- Branch-vs-draft identity: I spot-checked key lines. Workflow lines 176, 219 and 229 and compose lines 48 and 59 are the same in both copies. For full byte identity and the live-vs-draft hunk list I relied on impl-log (`cmp` exit 0, drift check) and plan.md's diff table.
- The live `main` versions were not read independently.

### What I verified as correct
Paths are `/home/user/deployment/.github/workflows/deploy-stoktok.yml` (WF) and `/home/user/deployment/apps/stoktok/compose.yml`.
- **Env file creation (WF:176-243):**
  - `umask 077`, and the dir is kept at 700.
  - `mktemp` runs in the same dir as `$ENV_FILE`, so the `mv -f` is an atomic rename on one filesystem.
  - `trap rm` covers early exits, `chmod 600` is applied, and the owner+mode `stat` check runs after the move.
  - Every value is regex-validated before the `printf`. No value can contain a newline or `$`, so there is no env-line injection and no compose `env_file` interpolation.
  - The password regex `^[A-Za-z0-9_-]{16,}$` is URL-safe, so the URL needs no encoding.
  - `IFS= read -r` handles a missing trailing newline. CRLF fails the guard, which is correct.
  - A missing password file gives a bash redirect error that names only the path.
- **No argv or echo exposure:**
  - `STOKTOK_DATABASE_URL` and `pw` are unexported shell variables, written only by the `printf` builtin.
  - External commands (`mktemp`, `chmod`, `cmp`, `mv`, `stat`) receive only paths.
  - No `${{ secrets.* }}` or `${{ github.* }}` is interpolated into any `run:` text; everything goes through `env:`, so there is no script injection.
  - There is no `set -x` and no heredoc. `config` is called only with `--quiet` or `--services` (WF:250, 252).
- **Step order and failure behaviour:**
  - If `secrets` fails, the old env file stays, and `pull`, `deploy` and `publish` are skipped (implicit `success()`). The file is never half-written.
  - A failure after `secrets` (in `pull` or `deploy`) leaves the new env file with the old containers. Running containers keep their create-time env. Launchd jobs read the new file with the old published compose, and v0.2.1 ignores the extra keys.
  - `--force-recreate` only follows a successful `secrets` + `pull`, so no container is recreated with missing vars.
  - `rollback` keeps the new env file, which is harmless in the expand state.
- **Triggers:** only `push` (path `apps/stoktok/**`) and `workflow_dispatch`. There is no `pull_request` or `pull_request_target`. The job is gated by `github.ref == 'refs/heads/main'` and `environment: stoktok`.
- **Networks:**
  - `db` is created `--internal` (`postgres/compose.yml:15,115`), so it never supplies the default gateway. Web keeps egress via `web` and the worker via `default`.
  - `postgres/init/00-lockdown.sql` and `app-db.sql` revoke CONNECT from PUBLIC, so the `stoktok` role cannot reach other apps' databases.
- **`/readyz` (`apps/web/app/readyz/route.ts`):** `performance.now()` is used, failures are memoised the same way as successes, and the body and logs never carry the error message. The new test (`readyz.test.ts:87`) covers the 2999 ms / 3000 ms edge.

### Findings
- 🟡1 **The mode and atomicity of the env file are not pinned.**
  - Where: `/home/user/stoktok/scripts/check-deploy-env.sh:224-293`, against WF:176, 229-239.
  - AC 9 says the checks cover "umask 077 … chmod 600, owner+mode stat check", but nothing greps for `umask 077`, `chmod 600 "$tmp"`, `mktemp "$dir/…"` (same dir), `mv -f "$tmp" "$ENV_FILE"`, the `trap`, or the `stat -f '%Su %Lp' … 600` check.
  - These mutations all still pass: delete `umask 077`; change `mktemp "$dir/…"` to bare `mktemp`, so the temp file goes to `$TMPDIR` and the `mv` becomes a non-atomic cross-filesystem copy; delete the post-move `stat` check.
  - Fix: add literal or awk-order pins for `umask 077` (first line) < `mktemp "$dir/` < `trap 'rm -f "$tmp"' EXIT` < the printf < `chmod 600 "$tmp"` < `mv -f "$tmp" "$ENV_FILE"` < the `stat` check.
- 🟡2 **The guards only check the stoktok draft, not the file that runs.**
  - Where: `check-deploy-env.sh:92` (`WF=$ROOT/deploy/...`).
  - Deployment CI (volume-safety, pr-scope) does not run these checks. Any later edit made directly in `mmlabs-online/deployment` (for example a cross-app refactor) bypasses all of them.
  - Fix: a follow-up to add a deployment-side check (e.g. a CI job that compares against the stoktok draft, or a vendored copy of the secrets-step checks). At minimum, state this in the PR body and in `deploy/deployment-repo/README.md`.
- 🟡3 **The no-echo check is name-based only.**
  - Where: `check-deploy-env.sh:272-293`.
  - It catches `$pw` and `STOKTOK_DATABASE_URL` by name. It misses:
    - a bare `set` or `declare -p` (both dump the unexported shell variables);
    - `cat "$ENV_FILE"`, `cat "$tmp"`, or `cat postgres/secrets/apps/…`;
    - `docker inspect` without `-f`;
    - `config` through a differently named array (this last one is acknowledged by the new comment at line 109).
  - GitHub masking does not cover the derived URL or the password, because they are not secrets. The other env-file values are masked.
  - Impact is limited: the password is already readable by anyone with read access to the deployment repo, and that is the same audience as the Actions logs. The URL in a log is still a needless second copy.
  - Fix: add a deny-grep on `wf_nc` for `^\s*set\s*$|declare -p|typeset -p|printenv|cat .*(ENV_FILE|\$tmp|secrets/)|docker inspect` lines without `-f`. `::add-mask::` stays declined by Ming.
- 🟡4 **The trigger set is not pinned.**
  - `if: github.ref == 'refs/heads/main'` is also true for `pull_request_target`, where `ref` is the base branch. It is also true for `schedule` and for `workflow_run` on main.
  - Today `on:` is safe (WF:32-36), but nothing stops a later edit from adding such a trigger. That trigger would then run on the self-hosted runner with the `stoktok` environment secrets.
  - Fix: in `check-deploy-env.sh`, require the `on:` block to contain exactly `push` (with `branches: [main]`) and `workflow_dispatch`, and reject `pull_request_target`, `pull_request` and `workflow_run` anywhere.
- 🟡5 **Rotating the database password does not reach the env file.**
  - Where: WF:35 `paths: ['apps/stoktok/**']`.
  - A change to `postgres/secrets/apps/stoktok.password` triggers `deploy-postgres` (`deploy-postgres.yml:21`), which changes the role password, but `deploy-stoktok` does not run. After cutover, web and worker would fail to authenticate until a manual `workflow_dispatch`.
  - `docs/deploy.md` (lines 94-104 and the rotate sections) does not say this. It is the same pattern as the other apps, so it is not stoktok-specific.
  - Fix: one docs line in "Shared Postgres", e.g. "After rotating `stoktok.password`: once `deploy-postgres` is green, run `deploy-stoktok` via `workflow_dispatch` on `main`." Alternatively, add the password path to `paths:`, which would need Ming's decision for the deployment repo.
- 🟡6 **A doc step could lead Ming to print the env.**
  - Where: `/home/user/stoktok/docs/deploy.md:100`.
  - It says `docker compose -p stoktok ps` shows "networks `db web`". `ps` does not show networks.
  - Someone checking this may reach for a bare `docker inspect`, which prints the full env, including the unmasked URL and every key, to the terminal or scrollback.
  - Fix: paste the exact command from plan.md: `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $(docker compose -p stoktok ps -q stoktok-web)`.
- 🟡7 (low) **Leftover temp file and a misleading message.**
  - Where: WF:229-239.
  - If the runner kills the step hard (timeout or cancel escalating to SIGKILL), the EXIT trap does not run. That can leave a `.stoktok.env.XXXXXX` file (mode 0600, full secrets) in `~/.config/stoktok`. The dir is mode 700 and excluded from Time Machine, so the risk is small.
  - If the post-move `stat` check fails, the new file is already installed, so the message "Nothing was started" is accurate, but "file not changed" would not be.
  - Fix (optional): at the start of `secrets`, delete stale `"$dir"/.stoktok.env.*`, and add a docs note.

### Recommendations, by rule or criterion
- **R3 / AC 9:** do 🟡1, 🟡3 and 🟡4 in this ticket. They are small additions to `check-deploy-env.sh` with matching mutation proofs: remove `umask 077`, use bare `mktemp`, add a bare `set`, add `cat "$ENV_FILE"`, add `pull_request_target:`. This is in scope, because AC 9 claims these checks exist.
- **AC 12 (docs):** fix 🟡6 and add the 🟡5 rotation line. Both are one line each in `docs/deploy.md`.
- **Follow-ups (R7):** 🟡2, a deployment-side copy of the guards; 🟡7, cleaning up stale temp files.

### Risks
- **Web joins `db`:** the internet-facing web container can now open TCP to Postgres and to every other container on `db`. Those containers can in turn reach `stoktok-web:3000` without Cloudflare Access. Mitigations: per-app roles with CONNECT revoked, `requireUser()` on every route, and the 3 s memo on the public `/readyz` and `/healthz`. I accept this as the shared-Postgres standard.
- **The password is committed in the deployment repo** (the shared-Postgres standard, STK-092). Anyone with read access to that repo has stoktok's database credential. That is out of scope for this ticket, but it is the real ceiling on how much the 🟡3 log hardening is worth.
- **First delivery of the AI keys:** `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` reach the containers for the first time. Ming should confirm whether those environment secrets are set before merging (already in docs line 98).

### Open questions
1. Can Ming confirm that the `stoktok` GitHub environment has a deployment-branch rule of "main only"? The `if:` guard alone is not sufficient (see 🟡4).
2. Should a deployment-repo CI job enforce the stoktok guards on the live workflow (🟡2), or is reviewing the drafts accepted as the control?
3. For rotation (🟡5): docs only, or add `postgres/secrets/apps/stoktok.password` to `paths:` in `deploy-stoktok`?

### Files reviewed
- /home/user/deployment/.github/workflows/deploy-stoktok.yml
- /home/user/deployment/apps/stoktok/compose.yml
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/docs/deploy.md
- /home/user/stoktok/apps/web/app/readyz/route.ts
- /home/user/stoktok/apps/web/test/readyz.test.ts
- Context: /home/user/deployment/postgres/compose.yml, /home/user/deployment/postgres/init/00-lockdown.sql, /home/user/deployment/apps/stoktok/run-job.sh, /home/user/deployment/.github/CODEOWNERS

## Attempt 2

**Verdict: no 🔴.** Attempt 2 closes 🟡1, 🟡3, 🟡4, 🟡5 and 🟡6 as Ming scoped them. 🟡2 and 🟡7 stay deferred to the follow-up ticket. I found 3 new low 🟡 items: ways around the new pins that a careless edit could hit. None blocks PASS. Fix them in the 🟡2 follow-up or as small additions now.

**Limits:** I had read-only access (Read, Grep, Glob) and could not run anything. So the mutation proofs and the green `check:deploy-env` come from impl-log Attempt 2 (`/home/user/stoktok/work/tickets/STK-093/impl-log.md:76-85`). I checked the new pins by hand against the draft workflow `/home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` (WF), which is unchanged. I did not read the deployment branch again; impl-log says it was not touched.

### Closure of the attempt-1 findings
- **🟡1 closed.** `scripts/check-deploy-env.sh:295-313` pins this order using the first exact occurrence of each line:
  - `umask 077` (WF:176) < `pwfile=` (217) < `chmod 700 "$dir"` (228) < `tmp="$(mktemp "$dir/.stoktok.env.XXXXXX")"` (229) < `trap 'rm -f "$tmp"' EXIT` (230) < printf (231) < `chmod 600 "$tmp"` (232) < `mv -f "$tmp" "$ENV_FILE"` (234) < the `stat -f '%Su %Lp'` check (236) + `exit 1` within 4 lines (238).
  - The three attempt-1 mutations (delete umask, bare mktemp, delete stat) all fail now.
  - The `IFS= read -r pw` pin from Ming's note is in place at :245 and :260.
- **🟡3 closed** for every pattern Ming listed (bare `set`, `declare -p`, `typeset -p`, `export -p`, `printenv`, `cat` of the env file, `$tmp` or `secrets/`, `docker inspect` without `-f`), at :314-324.
  - The current workflow has no false positives: `git cat-file` (WF:126) is not matched because the regex needs whitespace after `cat`, and `set +e`/`set -e` are not bare.
- **🟡4 closed.** The `on:` block is compared exactly at :327-332, plus a forbidden-trigger grep at :333-336. I tried these bypasses and all are caught:
  - flow-style `on: [push, pull_request_target]` or `on: {…}`: the block becomes empty, so it fails;
  - a quoted `'on':`: the block is empty, so it fails;
  - a second `on:` block: the concatenation differs, so it fails;
  - extra `branches`, `tags` or `inputs`: not an exact match, so it fails.
  - This is the strongest of the three new checks.
- **🟡5 closed (docs).** `/home/user/stoktok/docs/deploy.md:102` says what Ming chose: no `paths:` change; once `deploy-postgres` is green, run `deploy-stoktok` via `workflow_dispatch` on `main`.
- **🟡6 closed.** `docs/deploy.md:100` now gives the exact `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}…'` command. It explicitly says "never print the env file; `docker inspect` only with `-f`", and the expected names `db` and `web` are right (`web` is the actual name of the `tunnel` network).

### New findings
- 🟡8 (low) **The `docker inspect` check can be met by a `-f` that dumps the env anyway.**
  - Where: `scripts/check-deploy-env.sh:321`.
  - The check only asks that `-f` or `--format` appears somewhere on the line. `docker inspect -f '{{json .Config.Env}}' …` or `-f '{{json .}}'` passes the check and prints the env into the log. That includes `STOKTOK_DATABASE_URL`, which GitHub does not mask.
  - The same command typed at the Mac from docs line 100's advice would do the same, so the doc pattern is safe but the guard is not.
  - Fix: also deny `Config\.Env` and `\{\{ *json +\. *\}\}` / `\{\{ *\. *\}\}` in `wf_nc`.
- 🟡9 (low) **The deny list is a fixed list of commands, so other ways to print the same data get through.** These pass `:315-317` and `:111`:
  - `set | grep …`, `set > "$GITHUB_STEP_SUMMARY"`, or `{ set; }`. The bare-`set` pattern requires `set` alone on its line; only `env` has a pipe variant.
  - Reading the files with tools outside the list, or without `cat`: `echo "$(<"$pwfile")"`, `grep . "$ENV_FILE"`, `sed -n p`, `base64`, `tac`, `cp "$ENV_FILE" <elsewhere>`.
  - `docker compose … convert`, which is an alias of `config` and prints the interpolated env.
  - `"${compose[@]}" exec -T stoktok-web env`, `… run --rm stoktok-web env`, or `cat /proc/1/environ`.
  - Impact stays as in attempt 1: the password is already readable by everyone with deployment-repo read access, which is the same audience as the logs. These are accidental-leak tripwires, not an adversarial control.
  - Fix (one regex each):
    - `(^|[;{(]\s*)set\s*([|>;]|$)`;
    - `\$\(<`;
    - `(grep|sed|awk|base64|tac|cp|rev|dd)\s+.*(ENV_FILE|\$pwfile|secrets/)`;
    - `compose.*\sconvert(\s|$)`;
    - `\s(exec|run)\s.*\s(env|printenv)(\s|$)`;
    - `/proc/[^ ]*/environ`.
  - Add a comment at :314 saying the list is a tripwire, so a later reviewer does not read it as complete.
- 🟡10 (low) **The order pin checks only the first occurrence of each line, so lines added later can undo it.**
  - Where: `scripts/check-deploy-env.sh:297-309`.
  - Two edits pass the pin and undo what it protects:
    - A second `tmp="$(mktemp)"` between `trap` and the printf. The temp file then lands in `$TMPDIR`, and the `mv` is no longer an atomic rename. The other awks also use `/mktemp/ && !m`, so they would not catch it.
    - A `chmod 644 "$ENV_FILE"` (or a `cp "$ENV_FILE" …`) after the stat check, or in a later step. The stat check only proves the mode at that one moment.
  - A later `umask 022` is harmless, because `mktemp` creates the file 0600 and the stat check covers anything before it.
  - Fix:
    - require exactly one `mktemp` and one `tmp=` assignment in `secrets_step`;
    - outside the secrets step, allow `$ENV_FILE` only on the envdir `dirname`/home-prefix lines, the rollback stat line, and the notify message;
    - deny any `chmod` that targets `$ENV_FILE`, except `chmod 600 "$tmp"`.
  - A step-level `env: ENV_FILE:` override inside `secrets` would also escape the `sed 's/^  ENV_FILE: //p'` pin (:119). The home-prefix check and the stat check limit the damage, but a one-line "no indented `ENV_FILE:`" grep closes it.

### Recommendations
- **R3 / AC 9:** 🟡8 is the only one that weakens a pin Ming asked for (attempt-1 🟡3, the `docker inspect` part). It is cheap to add to this attempt with one mutation proof.
- Put 🟡9 and 🟡10 into the 🟡2 follow-up ticket, because the deployment-side copy of the guards needs the same patterns anyway.

### Risks (unchanged from attempt 1)
- The checks only see the stoktok draft (🟡2, deferred). Edits made directly in `mmlabs-online/deployment` bypass all of these pins until the follow-up lands.
- Docs gap, not a finding: after the cutover, between `deploy-postgres` changing the role password and the manual dispatch, web and worker cannot authenticate. Line 102 implies this but does not call it downtime. Consider "rotate outside job slots".

### Open questions
1. Is 🟡8 fixed in this attempt or carried with 🟡2, 🟡7, 🟡9 and 🟡10 into the follow-up?
2. Still open from attempt 1: does the `stoktok` GitHub environment have a deployment-branch rule of "main only"? The trigger pin now covers the workflow side, but the environment rule is the server-side backstop.

### Files reviewed
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/docs/deploy.md
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/user/stoktok/work/tickets/STK-093/impl-log.md
- /home/user/stoktok/work/tickets/STK-093/security-review.md
- /home/user/stoktok/work/tickets/STK-093/ticket.md

## Attempt 1 — 2026-11-18
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (web, worker Done)
- lint: `pnpm lint` exit 0
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 169, worker 310, web 360 passed.
- check:deploy-env: `pnpm check:deploy-env` exit 0. It prints `OK: …/deploy-stoktok.yml`, `OK: deploy env lists consistent`, 66 `ok` lines and `OK: deploy guard mutation proofs`.
- `bash -n` on `scripts/*.sh`, `deploy/deployment-repo/ops/*.sh` and `deploy/deployment-repo/apps/stoktok/*.sh`: clean. With no argument the checker exits 2.
- CI on PR #77 (head 36add1d), read via the REST API:
  - `ci`: success.
  - `deploy-guards-macos`: success (job 134718400085). Image `macos-26-arm64`. It ran `/bin/bash -e` with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, so bash 3.2 and BSD grep/sed/awk. All 61 non-G cases printed `ok`.
  - `images (web|worker)`: cancelled. These are not part of the checks.
- Portability grep: `grep -nE '\\[swb]'` on the checker and the test script matches only the comment on line 6 of the checker. There is no `grep -P`, `sed -i`, `mapfile`, `${x,,}` or awk interval (other than inside regex literals).
- Secret scan: `grep -rlF -f <stoktok.password>` over work, docs, deploy and scripts found 0 files; the file was never printed. Both diffs have 0 matches for `[A-Za-z0-9+/]{43}=`. The working tree is clean.

### Acceptance criteria
- [x] 1: checker usage and exit codes; the moved checks are gone from `check-deploy-env.sh`.
  - Evidence: I compared 8ed5663 line by line with the removed block. It is a pure move. The only differences are:
    - `\s` → `[[:space:]]`. These are the same in GNU grep.
    - `diff <(…)` → string `!=` for the printf order check. Same result.
    - Printed lines are prefixed. Output only.
    - xtrace `grep -n` → `grep`. Output only.
  - The `secrets_step` extraction (comment lines stripped) is identical to `origin/main`. The draft passes before and after.
- [x] 2: portability. Evidence: the greps above, plus the green `deploy-guards-macos` job.
- [x] 3: mutation proofs. `bash scripts/test-deploy-guards.sh` gives 66 ok. I also broke three rules myself on a temporary copy (the tree was not touched):
  - Replaced `Config\.Env` in the inspect rule with a never-matching token → `FAILED M1`, exit 1.
  - Removed `rm` from the mode-order awk → `FAILED M38`, `FAILED M39`.
  - Disabled the `pull_ok` pin → `FAILED M37`.
- [x] 4: `pull` fails closed (STK-094 🟡2). I ran the extracted `pull` step myself with real `docker compose` v5.6.1. A wrapper stubbed only `pull`; `config` ran for real.
  - New step:
    - expand compose (live `origin/main` v0.2.1): rc 0, `migrate=false`, same notice
    - cutover draft compose: rc 0, `migrate=true`
    - `config --services` erroring: rc 1, no `migrate=` output
    - same error without `-e`: rc 1
    - list `stoktok-webx`/`migrate`: rc 1
  - Old step with the same error: rc 0 and `migrate=false`. That is the fail-open the ticket describes.
  - Shim cases B1-B5 pass.
- [x] 5: v0.2.1 behaviour is unchanged. Against the real expand compose, the old and new `pull` steps give byte-identical stdout/stderr and `GITHUB_OUTPUT` (`cmp` silent). The draft diff touches only:
  - the header,
  - `dir=` + `rm -f` at the start of `secrets` (the old `dir=` removed),
  - the `pull` body.
- [x] 6: 🟡7. The order `umask` < home-prefix < `dir=` < `rm -f` < `pwfile` < … < `mktemp` is pinned (`check-stoktok-workflow.sh:137-153`). M38 and M39 fail as required. The note is in `docs/deploy.md` line 99.
- [x] 7: the header names `/healthz` (expand), `/readyz` (cutover), fail-closed and `stoktok-guards` (draft lines 5-6 and 30-31).
- [x] 8: 🟡8, 🟡9, 🟡10, xtrace and the `release.env` nit.
  - M1-M34 fail as required; C1-C3 pass.
  - The tripwire comment is at `check-stoktok-workflow.sh:159-161`.
  - Extra cases I ran all exit 1: `--format="{{json .Config.Env}}"`, `{{ json . }}`, `{{range .Config.Env}}`, `set -euxo pipefail`, `head -c 999 "${ENV_FILE}"`, `cat <"$tmp"`, `cat ~/.config/stoktok/stoktok.env`, `xargs cat <<< "$ENV_FILE"`, `if true; then set; fi`.
- [ ] 9: output cannot become a workflow command. FAILED, see Issue 1.
- [ ] 10: `stoktok-guards.yml` pins. The file itself is least-privilege and safe (see Rules). The pins miss weakening edits, see Issue 2.
- [x] 11: live parity.
  - `origin/stoktok/stk-097-workflow-guards` is at 0428c97, with merge-base = `origin/main` 563d1e2.
  - `git diff --stat` lists exactly the 3 files, nothing under `apps/`.
  - `git show <branch>:<f> | cmp - <draft>` is silent for all 3.
  - Pre-edit: `origin/main:.github/workflows/deploy-stoktok.yml` is byte-equal to stoktok `origin/main`'s draft.
- [ ] 12: the deployment PR is open. NOT MET: `GET /repos/mmlabs-online/deployment/pulls?head=…stk-097-workflow-guards&state=all` returns nothing. The branch is pushed, but no PR exists yet. The impl-log still says "NOT pushed". See Issue 3. Running the checker on the live branch file passes (the branch file equals the draft, so the B0 result applies).
- [x] 13: README "Workflow guards (STK-097)" states what runs, where, what it covers, tripwire, updating, deletion fails, advisory until required. The table has the 2 new rows.
- [x] 14: step 6 says "repeat steps 2-5", stage 0.3 has the `gh pr ready --undo` fallback, and the ming-todo line is reworded.
- [x] 15: the `docs/deploy.md` subsection and the ming-todo STK-097 item are present.
- [x] 16: no secret printed or committed (scan above).
- [x] 17: all checks green (above).

Ming verification after merge (not verified here; the PR must carry them):
1. Read and merge the deployment PR before cutover stage 4.
2. Make `stoktok-guards / check` a required check after its first run.
3. Once `macbook-runner` is online, deployment PRs show the check green.
4. After `deploy-stoktok` #10, run `workflow_dispatch` and confirm:
   - the notice "has no migrate service yet",
   - `deployed: … v0.2.1 … healthy`,
   - `changed=false`,
   - no `.stoktok.env.*` in the env dir.

### Issues
#### Issue 1 — 🔴 blocker — carriage returns let PR content forge workflow commands and desync the line-based checks
- **Where**: `deploy/deployment-repo/ops/check-stoktok-workflow.sh`. This covers `show()`/`flag()` (lines 23-33) and every line-based check. Copied verbatim into the deployment branch.
- **Expected**: AC 9 and the orchestrator's item (3) say text from the PR's file can never become a workflow command on the self-hosted runner. Also, the checker should see the same lines that GitHub's YAML parser and bash see.
- **Actual**:
  1. Output injection. I inserted into `deploy` the line `set | true` + CR + `::error title=forged::stoktok-guards OK`. The checker exits 1, as it should, but it prints the raw CR. The runner reads step output with .NET `ReadLine`, which splits on `\r`, and it accepts commands after leading whitespace. Splitting the output on CR the same way gives the line `::error title=forged::stoktok-guards OK`. I emulated this with `tr '\r' '\n' | sed 's/^[[:space:]]*//' | grep '^::'`; I did not run it on a real runner. P1 does not catch this, because it greps for `^::` on newline-split lines.
  2. Check bypass. YAML treats a lone CR as a line break, and so does PyYAML (I checked: the run value becomes `…echo hi\nset\n`). grep does not. So `echo hi` + CR + `          set` in the `deploy` run block gives exit 0. Bash would run a bare `set`. The same trick defeats every order and count pin.
  - YAML parsers also treat NEL (U+0085), LS (U+2028) and PS (U+2029) as line breaks.
- **Fix instruction**:
  - In `check-stoktok-workflow.sh`, right after the usage/symlink block and before any other check, add a check that does `exit 1` with a fixed message ("FAIL: workflow contains a carriage return or a Unicode line break") if the file contains any of:
    - `$(printf '\r')`, checked with `LC_ALL=C grep -q`,
    - the UTF-8 sequences `\302\205`, `\342\200\250` or `\342\200\251`, checked with `LC_ALL=C grep -qF "$(printf '…')"` (bash 3.2 and BSD safe).
  - Do not print the offending line.
  - Also make `show()` strip CR (`tr -d '\r' | sed 's/^/  | /'`) as defence in depth.
  - Add two cases to `scripts/test-deploy-guards.sh`, then copy the checker verbatim to the deployment branch again and re-run `cmp`:
    - P2: `set | true` + CR + `::error::x` → exit 1, and no line of `tr '\r' '\n' < out` starts with optional whitespace then `::`.
    - M40: `echo hi` + CR + `          set` → exit 1.

#### Issue 2 — 🟡 should-fix — `stoktok-guards.yml` pins miss the edits that would break its safety
- **Where**: `scripts/check-deploy-env.sh:345-386`. The draft itself, `deploy/deployment-repo/.github/workflows/stoktok-guards.yml`, is fine.
- **Expected**: AC 10 says the pins keep the job "exactly the least-privilege job". `permissions:` is only `contents: read`, and the checker always comes from `main`.
- **Actual**: I ran each of these through `STK097_GUARDS_WF=<copy> bash scripts/check-deploy-env.sh`, and all exit 0:
  - `ref: ${{ github.event.pull_request.head.sha }}` added to the first checkout. The checker would then come from the PR, which means PR code runs on the self-hosted runner.
  - A job-level `permissions: contents: write`.
  - A job-level `env: GH_TOKEN: ${{ github.token }}`.
  - Both `sparse-checkout` lines removed. The whole PR tree would land in `pr/`.
- **Fix instruction**: in the `stoktok-guards.yml` block of `check-deploy-env.sh`, add these pins:
  - Exactly one `ref:` line in the file, and it is the merge-ref line.
  - Exactly one `permissions:` line, at column 0.
  - No `github.token` and no `GITHUB_TOKEN`.
  - No `env:`.
  - Exactly one `sparse-checkout: .github/workflows/deploy-stoktok.yml` and one `sparse-checkout-cone-mode: false`.
  - Add mutations G5-G8 for the four cases above to `scripts/test-deploy-guards.sh`.

#### Issue 3 — 🟡 should-fix — deployment PR not open; impl-log out of date (AC 12)
- **Where**: `work/tickets/STK-097/impl-log.md` (deployment section, "NOT pushed, no PR opened"); `mmlabs-online/deployment`.
- **Expected**: the deployment PR from `stoktok/stk-097-workflow-guards` is open, not a draft, with the body from impl-log, and its URL is in impl-log.
- **Actual**: the branch is on origin at 0428c97, but no PR exists (REST pulls query returns empty).
- **Fix instruction**: after Issues 1-2 are fixed, the orchestrator should open the PR into `main` with the recorded body. The body must state that the job does not run on its own PR and that the checker was run by hand. Then record the URL and the new branch commit in the next impl-log attempt.

### Rules R1–R10
- No violations found.
- R3: the guards protect it, and no secret is reachable from the new job (no `secrets.`, no `environment:`, `contents: read`, `persist-credentials: false` twice).
- R7: every changed file is in the plan or is workflow bookkeeping (backlog, ticket, plan, impl-log, the STK-099 split ticket the plan asked the orchestrator to create).
- R8: checks are green. No `packages/core` change.
- The `stoktok-guards.yml` draft as written is safe under `pull_request_target` on the self-hosted runner:
  - the checker comes from the base branch;
  - the PR side is a sparse checkout of one file from `refs/pull/<n>/merge`, only read by grep/awk/sed;
  - the PR number goes only into a `with:` input, not into `run:`;
  - the file and its two parent directories may not be symlinks (exit 2);
  - the job has one `run:`.

### Nits (do not block)
- `env > "$GITHUB_STEP_SUMMARY"` (bare `env` with a redirect) is not flagged; only `env |` and a bare `env` are. Same shape as the `set >` case M6.
- The impl-log claims "NOT pushed", which contradicts the remote. Update it in the next attempt.
- The `deploy-guards-macos` job uses `actions/checkout@v4`. Fine, but note it when the other jobs are bumped.

### Follow-ups (out of scope)
- Echoing a single secret variable (e.g. `echo "$SUPABASE_SERVICE_ROLE_KEY" | base64`) is not flagged. GitHub masks registered secrets but not encodings of them. Consider a "no `$SUPABASE_*`/`$STOKTOK_*` outside `secrets`" pin.
- From the plan: xtrace via `SHELLOPTS`/`BASH_ENV`; an optional runtime self-check in `deploy-stoktok`; the worker-image `/app/migrations` refusal.
- The cross-file part of `check-deploy-env.sh` is still GNU-only (G cases are skipped on macOS).

## Attempt 2 — 2026-11-18
Verdict: PASS

Scope: review Issues 1-2 and security 🟡1, 🟡2, 🟡4 (orchestrator note in ticket.md), rework commit 66bd190. Issue 3 (opening the deployment PR) belongs to the orchestrator and is not judged here.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 169, worker 310, web 360 passed.
- check:deploy-env: `pnpm check:deploy-env` exit 0. It prints `OK: …/deploy-stoktok.yml`, `OK: deploy env lists consistent`, 78 `ok` lines (11 of them G cases) and `OK: deploy guard mutation proofs`, with no `FAILED`.
- `bash -n` on `scripts/*.sh`, `deploy/deployment-repo/ops/*.sh` and `deploy/deployment-repo/apps/stoktok/*.sh`: clean.
- CI on draft PR #77 (head 9fd00b2), read via the REST API:
  - `deploy-guards-macos` (job 134725386243): success. Image `macos-26-arm64`. It ran `env PATH=/usr/bin:/bin:/usr/sbin:/sbin STK097_SKIP_CROSSFILE=1 /bin/bash scripts/test-deploy-guards.sh`, which means bash 3.2 and BSD tools. It printed 67 `ok` lines and no `FAILED`, including M40, M41, M42, M43, P2 and P3. This is the portability proof for the new `printf` octal / `LC_ALL=C grep -F` / `od` code.
  - `ci` (job 134725385179): success. Every step passed: typecheck, lint, test, test:db, check:service-key, check:deploy-env (`OK: deploy guard mutation proofs`), db:check and test:move. The `CHECK FAILED` lines in its Postgres container log come from db:check's negative probes; that step succeeded.
- Live parity:
  - `git ls-remote` shows the deployment branch `stoktok/stk-097-workflow-guards` at 02dec4d. Its parent is 0428c97 and its base is `main` 563d1e2.
  - `git diff --stat 563d1e2 02dec4d` lists exactly 3 files.
  - `git show 02dec4d:<f> | cmp - <draft>` is silent for `deploy-stoktok.yml`, `stoktok-guards.yml` and `ops/check-stoktok-workflow.sh`.
  - Running the branch's own checker on the branch's `deploy-stoktok.yml` gives exit 0 and `OK`, wrapped in the `::stop-commands::stk…` / `::stk…::` pair.
- Secret check: no secret was printed or read. The diff adds no credential material.
- Working trees: `git status` is clean in both `/home/user/stoktok` and `/home/user/deployment`. All my reproductions ran in the scratchpad.

### Acceptance criteria (rework scope)
- [x] Issue 1, CR and Unicode line breaks.
  - Evidence: `check-stoktok-workflow.sh:23-31` rejects the file before any output. `:38` `show()` strips CR. Cases M40-M43, P2 and P3 pass.
  - I re-ran my attempt-1 reproductions on a copy. Every one exits 1 with only the fixed message `FAIL: workflow contains a carriage return or a Unicode line break`. In each case, splitting the output on CR and stripping leading whitespace leaves 0 `::` lines, and 0 bytes of the injected text appear. The inputs were:
    - `set | true` + CR + `::error title=forged::stoktok-guards OK`
    - `echo hi` + CR + `set`
    - `echo hi` + NEL / U+2028 / U+2029 + `set`
    - CRLF
    - NEL + `::error::x`
  - Other encodings:
    - A UTF-16LE file (with BOM) exits 1. The required lines are not found, so it fails closed.
    - A UTF-8 BOM file passes, as it should, because a BOM hides no line.
    - VT, FF and a lone invalid `0x85` byte pass. None of them is a line break for YAML or for bash, so this is correct.
- [x] Security 🟡2, stop-commands.
  - Evidence: `:34-36`. The token is `stk` followed by 16 bytes of `/dev/urandom` as hex. It is new on every run, so the static PR file cannot contain it.
  - Start and end markers go to stderr. So do all FAIL and `show` lines, which keeps their order.
  - Before the marker, the only possible output is the usage message (the path comes from main's workflow) or the fixed CR message.
  - If `od` fails, `set -euo pipefail` aborts the assignment.
  - `check_rc` (`test-deploy-guards.sh:55-56`) now splits on CR and allows only the marker pair.
- [x] Security 🟡1, merge-parent check (`stoktok-guards.yml:37-44`). `HEAD_SHA` is passed as step env, not interpolated into the script.
  - I emulated the second checkout with a real git repo: `sparse-checkout --no-cone` of the one file, `fetch --depth=1` of `refs/pull/<n>/merge`, then the exact step script. The result is shallow, and only the one file is checked out.
    - Current merge (parents base and H2, event head H2): passes.
    - Stale merge (built from H1, event head H2): exit 1 with "merge ref is not current".
    - A 12-character prefix of the head: exit 1, because `-x` needs the full line.
  - The commit object, and therefore its `parent` lines, is present in a depth-1 clone.
  - G9 and G10 pin it.
- [x] Issue 2, guard-job pins (`check-deploy-env.sh:381-405`).
  - G5-G10 pass.
  - I also tried these, and each exits 1:
    - a job-level `permissions: write-all`;
    - a job-level `env: { A: 1 }`;
    - a second `sparse-checkout-cone-mode: true`.
  - A `ref:` in a full-line comment passes. That is correct, because a comment changes nothing.
  - Residual bypasses are under Follow-ups. None of them is in the ticket's requested cases.
- [x] Security 🟡4: `deploy/deployment-repo/README.md:49-54` states that the checker is protected only by CODEOWNERS and "Require review from Code Owners" on deployment main.
- [x] Scope: 66bd190 touches only the 5 rework files and impl-log, all listed in impl-log "Files touched". The other commits since attempt 1 are workflow bookkeeping (backlog, ticket, security-review). The deployment commit changes only the 2 re-copied files.
- [ ] Issue 3, the deployment PR is open: not judged here (it belongs to the orchestrator). Running `GET pulls?head=…` still shows no PR.

Ming verification after merge: unchanged from attempt 1, items 1-4. Add: confirm "Require review from Code Owners" and "Require branches to be up to date" on deployment `main`.

### Issues
None blocking.

### Rules R1–R10
- No violations found.
- R3: no secret is reachable from the guard job. It uses no `secrets.` and no `environment:`, has `contents: read`, and both checkouts set `persist-credentials: false`. Nothing from the PR is executed.
- R7: every changed file is within the rework scope.
- R8: checks are green, and there is no `packages/core` change.

### Nits (do not block)
- `README.md:52` and `stoktok-guards.yml:37` say "second parent", but the code accepts any `parent` line. This is safe, because the head can equal the first parent only if the PR has no commits. Align the wording (same as security N3).
- `impl-log.md` attempt 2 still says the deployment branch is "not pushed … still 0428c97". It is now pushed at 02dec4d. Record that in the next log entry or the PR body.
- `check_rc` accepts the marker lines anywhere and in any number (same as security N1).

### Follow-ups (out of scope)
- Guard-pin bypasses through YAML spellings that line greps do not see. With `STK097_GUARDS_WF=<copy> bash scripts/check-deploy-env.sh`, each of these exits 0:
  - `"ref": ${{ github.event.pull_request.head.sha }}` added to the first checkout. The checker would then come from the PR.
  - a job-level `"permissions": write-all`;
  - a job-level `"env": {…}`;
  - `token: ${{ github['token'] }}`.
  - Also see security 🟡5 (`continue-on-error`, `if:`, `shell:`, `working-directory:`, `repository:`).
  - Every one of these needs a deliberate edit to a reviewed file. The robust fix is to pin `stoktok-guards.yml` by exact content (compare it with an expected copy or hash) instead of key by key.
- The deploy-stoktok deny list can be bypassed through a double-quoted flow scalar. A new step with `run: "true\nset"` passes the checker (exit 0); YAML turns `\n` into a newline, so bash would run a bare `set`. The same applies to the `\r`, `\x85`, `\L` and `\P` escapes. Suggested fix: require every `run:` to be a `|` block scalar (no `run: "`, no `run: '`, no plain one-line `run:` that has a backslash), with a mutation case. This is the same tripwire class as the README states.
- Security 🟡3: SHA-pin the actions.
- Security N2: strip other control characters in `show()`.
- Security N4: "Require branches to be up to date" in the README.

## Attempt 3 — 2026-11-18
Verdict: REWORK

Scope: Ming's note "after attempt 2 PASS" (last rework). Code commit 445b918 (later commits d530aca and a55b833 touch only `work/`). Deployment branch `stoktok/stk-097-workflow-guards` at 2c52ee5 (`git ls-remote` confirms).

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 169, worker 310, web 360 passed.
- check:deploy-env: `pnpm check:deploy-env` exit 0. 87 `ok` lines, no `FAILED`, ends `OK: deploy guard mutation proofs`. G0 and G10-G17, M44 and M45 included.
- `bash -n` on `scripts/check-deploy-env.sh`, `scripts/test-deploy-guards.sh` and `deploy/deployment-repo/ops/check-stoktok-workflow.sh`: exit 0.
- CI on draft PR #77, head a55b833 (same code as 445b918), via the REST API:
  - `deploy-guards-macos` (job 134736067498): success. It ran `/bin/bash scripts/test-deploy-guards.sh` with the macOS system PATH, and printed `ok M44-quoted-run`, `ok M45-plain-oneline-run` and `OK: deploy guard mutation proofs`.
  - `ci` (job 134736067987): success. Its output includes `OK: deploy env lists consistent`, `ok G17-repository` and `OK: deploy guard mutation proofs`.
  - The `images` jobs were still running. They are not part of this ticket.
- Working trees: `git status` is clean in `/home/user/stoktok` and `/home/user/deployment`. All my reproductions ran in the scratchpad.

### Acceptance criteria (Ming's items)
- [x] **Item 1: `stoktok-guards.yml` is pinned as a whole.**
  - Evidence: `scripts/check-deploy-env.sh:345-366` holds `GUARDS_SHA256=da5f97…dc08`. `shasum -a 256` and `sha256sum` of the draft both give this value.
  - G11-G17 pass. Each one fails with "differs from the pinned copy", which is the only guards check left, while G0 passes.
  - My own mutations of a copy also exit 1 with that message: a quoted `"persist-credentials":` key, one trailing space, one extra final newline, CRLF line endings, and an added comment line. The unchanged copy exits 0. So every byte is covered.
  - Tool fallback, tested with PATH shims:
    - only `sha256sum` available: exit 0;
    - only `shasum` available: exit 0;
    - neither available: exit 127 (`sha256sum: command not found`, aborted by `set -euo pipefail`). This fails closed.
  - The update procedure is in the comment at `check-deploy-env.sh:345-349`, and the FAIL message points to it.
- [ ] **Item 2: every `run:` in the deploy workflow is a `|` block.** FAILED, see Issue 1.
  - What works: a copy of the draft with one appended step behaves as follows.
    - exit 1: `run: "true\nset"` spread over two lines, a plain one-line `run:`, the flow mapping `- {name: zz, run: "…"}`, `run: >`, `run: |-`, `run: |+`, `run: |2` and `run: | # c`;
    - exit 0: an added `run: |` step, and the live draft (12 of 12 `run: |`).
  - What fails: the quoted-key spellings get through.
  - On `|-` and `|+`: rejecting them is correct. The live file needs neither. They change only trailing newlines, so allowing them would gain nothing, and the strict rule is simpler.
- [x] **Item 3: README wording.**
  - `deploy/deployment-repo/README.md:52` now says "Require branches to be up to date before merging".
  - `:53` says "the merge commit must have a `parent` line naming the PR head".
  - The comment at `stoktok-guards.yml:37` matches.
  - No "second parent" is left in `deploy/` or `scripts/`.
- [ ] **impl-log push status.** Stale, see Issue 2.
- [x] **Deployment parity.**
  - The diff from `origin/main` to 2c52ee5 lists 3 files.
  - `git show 2c52ee5:<f> | cmp - <draft>` is silent for `ops/check-stoktok-workflow.sh`, `.github/workflows/stoktok-guards.yml` and `.github/workflows/deploy-stoktok.yml`.
  - The branch's `stoktok-guards.yml` hashes to the pinned value.
- [x] **ming-todo has the repo-settings items** (`work/ming-todo.md:35-38`): code-owner review, fork PR workflows, and the required check with "up to date".

### Issues
#### Issue 1 — 🔴 blocker — the new `run:` rule misses quoted and complex keys, so `run: "true\nset"` is still open
- **Where**: `deploy/deployment-repo/ops/check-stoktok-workflow.sh:221-223`. The selector `(^|[[:space:]-])run[[:space:]]*:` only sees an unquoted key that follows whitespace or `-`.
- **Expected**: every `run` key in `deploy-stoktok.yml`, however it is spelled, is a plain `|` block. This is the exact payload Ming asked to close.
- **Actual**: each of these, appended as a step to a copy of the draft, makes the checker exit 0 with no FAIL. In all of them YAML turns `\n` into a newline, so bash would run a bare `set`:
  - `"run": "true\nset"` (double-quoted key);
  - `'run': "true\nset"` (single-quoted key);
  - `- {name: zz, "run": "true\nset"}` (flow mapping with a quoted key);
  - `? run` followed by `: "true\nset"` (complex key).
  - A double-quoted key can also use escapes (`"\x72un"`), so widening the regex to `["']?run["']?` alone would still leave a gap. This is the same class that made Ming switch `stoktok-guards.yml` to a whole-file pin. Security review attempt 3 reports it as 🟡6.
- **Fix instruction**:
  - In `check-stoktok-workflow.sh`, next to the `run:` rule, add a rule that rejects, outside block-scalar content, any line whose key position starts with a quote, `{` or `?`. In other words, any line matching `^[[:space:]]*(-[[:space:]]+)?(["'{]|\?([[:space:]]|$))`.
  - Use an awk pass that skips lines inside a block scalar. Such a line is blank or more indented than a line ending in `: |` or `: >` (with optional chomping or indent indicators and an optional comment).
  - Pass the text to awk via stdin or ENVIRON, so it stays bash 3.2 and BSD compatible. Do not use awk intervals.
  - I checked this rule against the live draft and it flags nothing.
  - Add mutation cases M46-M49 to `scripts/test-deploy-guards.sh` (double-quoted key, single-quoted key, flow mapping with a quoted key, `? run` complex key), each expecting 1.
  - Keep the existing `run:` rule as it is. Re-copy the checker to the deployment branch byte for byte.

#### Issue 2 — 🟡 should-fix — impl-log push status is stale (Ming asked for it explicitly)
- **Where**: `work/tickets/STK-097/impl-log.md`, Attempt 3, the line "Deployment branch: … (hash in the final report; not pushed)".
- **Expected**: the log names the pushed head of `stoktok/stk-097-workflow-guards` and states that the deployment PR is not yet open.
- **Actual**: the log says "not pushed", but `git ls-remote` shows the branch at 2c52ee5.
- **Fix instruction**: after re-pushing for Issue 1, replace that line with "Deployment branch pushed at <new sha> (parent 2c52ee5 …); deployment PR not yet opened".

### Rules R1–R10
- R7: changed files match Ming's three items plus the impl-log. No out-of-plan files.
- R8: checks are green, and new mutation cases cover each new rule.
- R3: no secret material in the diff.
- No violations found, apart from Issue 1 against Ming's item 2.

### Nits (do not block)
- `deploy/deployment-repo/README.md` "Updating it" (around `:57`) does not mention that an edit to `stoktok-guards.yml` needs `GUARDS_SHA256` in `scripts/check-deploy-env.sh` updated in the same stoktok PR. Today this is only in the script comment.
- If neither hash tool exists, the result is exit 127 with `command not found` rather than a `FAIL:` line. It fails closed, but an explicit `else echo "FAIL: need shasum or sha256sum"; fail=1` would be clearer.
- The macOS job skips the cross-file cases (`STK097_SKIP_CROSSFILE=1`), so the `shasum` branch is exercised in CI only on Ubuntu. I tested the `sha256sum`-only path locally.

### Follow-ups (out of scope)
- `uses:` steps with inline code (for example `actions/github-script` `script:`) are not covered by the `run:` rule.
- Security 🟡3: SHA-pin the actions (already deferred by Ming).

## Post-escalation fix — 2026-11-18
Verdict: REWORK

Scope: escalation option 2 (Ming: "run tiếp"). Stoktok commit 3cb57e5. Deployment branch `stoktok/stk-097-workflow-guards` at a3565cb (`git ls-remote` confirms; parent 2c52ee5).

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 169, worker 310, web 360 passed.
- check:deploy-env: `pnpm check:deploy-env` exit 0. 91 `ok` lines, no `FAILED`. Includes `ok M46-quoted-key`, `ok M47-single-quoted-key`, `ok M48-flow-mapping-item`, `ok M49-explicit-key`, `OK: <draft deploy-stoktok.yml>` and `OK: deploy guard mutation proofs`.
- `bash -n` on `scripts/check-deploy-env.sh`, `scripts/test-deploy-guards.sh` and `deploy/deployment-repo/ops/check-stoktok-workflow.sh`: exit 0.
- Deployment parity: `git show a3565cb:<f> | cmp - <draft>` is silent for `ops/check-stoktok-workflow.sh`, `.github/workflows/stoktok-guards.yml` and `.github/workflows/deploy-stoktok.yml`. So the deployment checker is byte-identical to the draft.
- CI on draft PR #77 (head 3cb57e5, open, draft, unmerged), via the REST API:
  - `ci` (job 134824578229): success. Its log has `ok M46-quoted-key` through `ok M49-explicit-key` and `OK: deploy guard mutation proofs`.
  - `deploy-guards-macos` (job 134824577656, run 44310919825): **cancelled**. It was queued from 13:09:59 to 13:13:51 and ran no steps. So the new awk pass has **not** run on macOS/BSD awk in CI.
- BSD awk, checked by reading `check-stoktok-workflow.sh:227-236`: only `substr`, `~`, `sub`-free loops, bracket classes (`[[:space:]]`, `[{]`, `[?]`, `[|>]`, `[-+0-9]`) and no intervals or gawk extensions. The program is a single-quoted shell string, and the `'"'"'` splices produce a literal `'`. I expect it to be compatible, but CI has not confirmed it, because the macOS job was cancelled.
- Working trees: both are clean. All reproductions ran in the scratchpad.

### Attempt-3 blocker reproductions and variants
Method: a new step was inserted before `- name: pull` in a copy of the draft. Each copy was run through the checker and also parsed with PyYAML 6.0.3, which checks that the YAML is valid and that some step's `run` has a bare `set` line. Ruby Psych (libyaml) gave the same results for the bypasses below.

**Exit 1 (closed):**
- `"run": "true\nset"`
- `'run': "true\nset"`
- `- {name: zz, "run": "true\nset"}`
- `? run` / `: "true\nset"`
- `"\x72un": …`
- `"run"   : …`
- a quoted key under `with:`
- a quoted key after a `- [a]` item
- a quoted key after `x: [a, b]`
- `- "run": …` and `- - "run": x`
- `? !!str run`
- a trailing comment on the item line (`- name: zz # x: |`)

**Exit 0 (no false positives):**
- the live draft: no awk flags. It has `paths: ['apps/stoktok/**']` and `== 'success'` values.
- `name: "x"`
- a `run: |` block that contains `"a": b`, `'x': y`, `? z` and `{a: b}`.

**Still exit 0, and the YAML is valid with a bare `set` in a step's `run` (PyYAML and Psych agree):**
- B1 `        &a "run": "true\nset"`: an anchor before a quoted key.
- B2 `        !!str "run": "true\nset"`: a tag before a quoted key.
- B3 `      - &s {name: zz, "run": "true\nset"}` and B4 `      - !!map {name: zz, "run": "true\nset"}`: an anchor or tag before a flow item.
- B5 `      - name: &k run` then `        *k : "true\nset"`: an alias key.
- B6 the job's `    steps:` line changed to `    steps: # x: |` and a step with `"run": "true\nset"` added. The block-start regex at `:235` sees `: |` inside the comment and sets `inblk`. Every line indented more than `steps:` is then skipped, which is every step. This turns off the whole new rule with one comment.
- Not a bypass: `"run":"true\nset"` (no space after the colon) is a parse error in both PyYAML and Psych. `<<: {"run": …}` is already caught by the heredoc rule.

### Acceptance criteria (option 2 spec)
- [ ] **An awk pass rejects, outside block-scalar content, any key line that starts with `"`, `'`, `{` or `?`.** FAILED, see Issue 1.
  - The four named spellings and every listed variant are rejected.
  - B6, however, shows that block-scalar detection treats a comment as a block start. So "outside block-scalar content" is not what the code implements.
  - B1-B5 are the same hiding-a-key class through a node property or an alias.
- [x] **Mutation cases M46-M49** (`scripts/test-deploy-guards.sh:154-157`): each passes with exit 1.
- [x] **Live deploy workflow passes**: the checker prints `OK` for the draft, and the deployment branch file is byte-identical.
- [x] **Re-copied to the deployment branch**: a3565cb, byte-identical, pushed.
- [ ] **impl-log push status**: stale again, see Issue 2.
- [ ] **CI (incl. deploy-guards-macos)**: `ci` is green. `deploy-guards-macos` was cancelled before it ran any step. It must be re-run and pass on the reworked head.

### Issues
#### Issue 1 — 🔴 blocker — the new key rule can be switched off by a comment, and it misses keys behind an anchor, tag or alias
- **Where**: `deploy/deployment-repo/ops/check-stoktok-workflow.sh:233` and `:235`.
- **Expected**: outside real block-scalar content, no `run` key can be written in a way that hides it from the line checks. This is the purpose of option 2.
- **Actual**: B1-B6 above exit 0, and each one is valid YAML whose step `run` has a bare `set` line.
- **Fix instruction**:
  1. At `:235`, test block starts on the line with any trailing comment removed. For example: `nc = line; sub(/[[:space:]]#.*$/, "", nc)`, then match `nc` against the existing regex. This also still detects `run: | # c`.
  2. At `:233`, widen the first test to `line ~ /^[{&!*]/`. After indent and `- ` markers, a key position that starts with an anchor, tag or alias is then rejected too.
  3. I ran this exact variant (in the scratchpad, not in the repo). It flags nothing in the live draft and nothing in F1/F2. It flags B1-B6 and every case listed under "Exit 1".
  4. Add mutation cases, each expecting exit 1:
     - M50 `&a "run": …`
     - M51 `!!str "run": …`
     - M52 `- &s {…}`
     - M53 alias key `*k : …`
     - M54 `steps: # x: |` plus a quoted `run` key
  5. Add a negative control that expects exit 0: a step with `run: | # comment` and a plain body.
  6. Re-copy the checker to the deployment branch byte for byte.

#### Issue 2 — 🟡 should-fix — impl-log push status is stale
- **Where**: `work/tickets/STK-097/impl-log.md:122`.
- **Expected**: the log names the pushed head of the deployment branch.
- **Actual**: the log says "committed on the deployment branch but not pushed". `git ls-remote` shows a3565cb pushed.
- **Fix instruction**: after the re-push, replace the line with "Deployment branch pushed at <sha> (parent a3565cb); deployment PR not yet opened".

### Rules R1–R10
- R7: the files changed are the checker, the test script and the impl-log. All three are in the option-2 scope.
- R3: no secret material in the diff.
- No violations found.

### Nits (do not block)
- M46/M47 add a second `run` key to the existing `pull` step. A real parser would reject that, or keep only the last value. The cases still prove the checker flags the line. A separate new step, like the ones I used, would be a cleaner proof.
- The flag variable is named `quoted_keys`, but it now also covers flow and explicit keys, and after the fix it will cover anchors, tags and aliases too.

### Follow-ups (out of scope)
- Unchanged from attempt 3: `uses:` steps with inline code, and SHA-pinning the actions.
- Escalation option 3 (parse with a real YAML parser) remains the only full fix for this class.

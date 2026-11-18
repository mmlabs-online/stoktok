# STK-097 security review

## Attempt 1

**Verdict: no 🔴.** I found no way for a PR author to get code run on `macbook-runner` through `stoktok-guards.yml`, and no path to the stoktok secrets. There are four 🟡 hardening items and three nits. This was a read-only audit: I ran nothing, and no secret values were read or quoted.

### Findings — stoktok-guards.yml (pull_request_target on a self-hosted runner)

**Ways a PR author could get code executed.** None found.
- The workflow, the checker (`run: bash ops/check-stoktok-workflow.sh …`, `stoktok-guards.yml:38`) and both `actions/checkout` steps all come from `main`.
- The PR's content is a single file, checked out sparse into `pr/` (`:28-35`). Only grep, sed and awk read it. Nothing is sourced or run from `pr/`.
- Git hooks, filter drivers and LFS cannot arrive through a fetch, so they are not a route either.
- **Path traversal / symlinks:** handled. The checker rejects a symlinked file and symlinks in its two parent directories (`ops/check-stoktok-workflow.sh:16-19`). The sparse pattern is anchored in non-cone mode. If the PR makes the path a directory, a submodule or deletes it, the check exits 2, so it fails closed.

**Token and secrets exposure.**
- Permissions are `contents: read` (`:15-16`), with no environment and no `secrets.*`.
- Both checkouts set `persist-credentials: false`. This is stricter than `volume-safety.yml:22`, which does not set it on its first checkout.
- The job runs as the same OS user as the deploys, so it could read `~/.config/stoktok/stoktok.env`. Only code from `main` and the actions run, though.
- The workspace (`_work/deployment/deployment`) is shared with `deploy-stoktok`. The leftover `pr/` is removed by the next deploy's checkout (`clean: true`, `git clean -ffdx`), and no deploy step reads `pr/`.
- The deployment README says the repo is private, so fork PRs only trigger runs if "Run workflows from fork pull requests" is turned on.

**🟡1 — The merge ref can be stale, so the check may judge a different commit than the one it reports on** (`stoktok-guards.yml:31`).
- GitHub recomputes `refs/pull/N/merge` asynchronously after each push. A run can therefore check out the merge result of an earlier head while its status is attached to the new head.
- With "require branches up to date" off, or a quick push / force-push sequence, a required `check` can go green on content it never read.
- Threat model: this needs a repo writer, so it is low risk in a private repo.
- Fix (one commit): pass `HEAD_SHA: ${{ github.event.pull_request.head.sha }}` as step env and fail unless `git -C pr cat-file -p HEAD` has a line equal to `parent $HEAD_SHA`. Use `cat-file`, not `rev-parse HEAD^2`, because the shallow clone hides parents from `rev-parse`. Then update the pin at `scripts/check-deploy-env.sh:368-385`.

**🟡2 — The "no printed line can start with `::`" invariant can be bypassed** (`ops/check-stoktok-workflow.sh:7-8, 23`; header `stoktok-guards.yml:6-8`). Medium confidence; please verify against the runner source.
- (a) I believe the runner splits stdout with .NET `ReadLine`, which also ends a line at a bare `\r`. A PR line containing `<deny-pattern>\r::cmd::…` would then be printed as `  | …` followed by a new line starting with `::`. The `sed` prefix and the test's `^::` assertion (impl-log line 23) only split on `\n`, so neither catches it.
- (b) I believe the legacy `##[cmd]` form is matched anywhere in a line, so the prefix does not neutralise it.
- Impact is bounded: `set-env`/`add-path` are disabled, and no later step reads outputs. What remains is spoofed `::error`/`::notice` annotations, and `add-mask`/`stop-commands`, which could hide or garble the FAIL lines in the log. The step's exit code is not affected.
- Fix: in the checker, generate a per-run token, print `::stop-commands::$tok` before any PR-derived output and `::$tok::` at the end. Also strip CR and control characters in `show()` (`tr -d '\r'`, or `LC_ALL=C sed 's/[[:cntrl:]]/?/g'`). Add a mutation test with a CR-embedded line.

**🟡3 — Actions are pinned by mutable tag** (`stoktok-guards.yml:24, 30`, and the pin at `check-deploy-env.sh:373`, which requires `@v7`).
- A tag moved upstream would run on the production host, at the user level that can read the env file and use the docker socket, and here it could be triggered just by opening a PR.
- The marginal risk is small, because `deploy-stoktok.yml:66` already runs the same tag with secrets in scope.
- Recommendation: follow-up to pin `actions/checkout` by full commit SHA repo-wide, and change the pin regex to accept `@<40-hex>`.

**🟡4 — Nothing checks the checker.**
- Because of `pull_request_target`, a PR that weakens `ops/check-stoktok-workflow.sh` is judged by `main`'s copy, so that PR passes. The follow-up PR is then checked by the weakened copy.
- Parity with the stoktok source of truth is not checked automatically on either side.
- `/ops/` and `/.github/` are in CODEOWNERS (`.github/CODEOWNERS:3,14`), but that file is marked "DRAFT". It is only a control if branch protection requires code-owner review.
- Open question for Ming: is code-owner review enforced on deployment `main`? If not, state this in the README "control" paragraph. The AC asks for "a way Ming approves".

### Findings — `rm -f "$dir"/.stoktok.env.??????` (deploy-stoktok.yml:183-184)
The glob is safe.
- `dir` is the fixed `dirname` of a top-level `ENV_FILE` and is quoted, and the home-prefix check (`:181`) runs first.
- The pattern needs the leading dot plus exactly 6 characters, which matches BSD `mktemp` `XXXXXX` (`:235`). It cannot match `stoktok.env` itself, and `?` never matches `/`.
- With no match, the literal pattern goes to `rm -f`, which does nothing. A symlink match removes only the link.
- A directory with that name makes `rm` fail under `bash -e`. That fails closed and only someone who can already write to `~` can cause it.
- The concurrency group (`:46-48`) backs the "stale only" claim. Nothing else writes in that directory.

### Findings — fail-closed pull (deploy-stoktok.yml:255-269)
Correct.
- The step has no `shell:`, so it runs under `bash -e`. A failing `services="$(… config --services)"` therefore ends the step.
- Even if `-e` were lost, an empty list fails the `stoktok-web` check (`:260-263`), which is a second layer. `stoktok-web` really is the service name (`apps/stoktok/compose.yml:27`).
- The checker forbids `set +e`, `|| true` and piping `config --services` into the next command (`check-stoktok-workflow.sh:246-258`). Mutation tests M35/M36 cover the old and swallowed shapes.
- 🟡 residual, already known from STK-094 🟡9: if `migrate` sits under a different profile, for example `[jobs]`, it is not listed with only `--profile migrate`, so the run reads `migrate=false` and deploys without migrating. That is still fail-open on how the compose file is written. It stays with the compose-side checks and cutover stage 0.3.
- Nit: if `pipefail` were ever added, `printf … | grep -q` could get SIGPIPE on large output and turn the migrate test fail-open. That is impossible at this list size. Testing with bash builtins (`[[ $'\n'$services$'\n' == *$'\n'migrate$'\n'* ]]`) would remove it.

### Findings — deny-list additions (check-stoktok-workflow.sh:157-185, 220-243)
They cover the ticket's 🟡8, 🟡9 and 🟡10 items, and the comment now honestly says the list is a "tripwire" (`:158-160`).
- The `\.env` target excludes `release.env` (`:175`).
- Known gaps, listed in the impl-log follow-ups: `xargs cat`, `eval`, `BASH_ENV`/`SHELLOPTS`, `source "$ENV_FILE"`, and `docker compose … config` behind another array name (`:49-50`). These are acceptable for a tripwire.

### Recommendations
1. Fix 🟡1: verify the merge commit's parent against `head.sha` (AC1, needs a mutation test).
2. Fix 🟡2: use stop-commands and strip control characters (AC3, "no secret printed"; it also protects the log's integrity).
3. Follow-up for 🟡3: SHA-pin the actions repo-wide.
4. 🟡4: confirm code-owner enforcement, or document the gap in `deploy/deployment-repo/README.md` (AC2).

### Risks
The real control over `deploy-stoktok.yml` is still human review plus the `stoktok` environment's main-only restriction. The guard job adds a tripwire and does not replace either.

### Open questions
- Is "require review from Code Owners" on for deployment `main`?
- Is "Run workflows from fork pull requests" off?
- Will `stoktok-guards / check` be a required check, with "require branches to be up to date"?

## Attempt 2

**Verdict: no 🔴.** Attempt 2 closes 🟡1, 🟡2 and 🟡4. 🟡3 (SHA-pinning the actions) is deferred as agreed. I found no new way to run code, no token exposure and no secret path. There is one new low 🟡 (pin gaps) and four nits. This was a read-only audit: I ran nothing and read or quoted no secret values.

I read the stoktok drafts at commit 66bd190. **I could not see the deployment branch `stoktok/stk-097-workflow-guards` @ 02dec4d**: `/home/user/deployment` only has a README. So I have not verified that the deployment copy is byte-identical to the drafts. A `cmp` of the copied files on that branch should be done before the PR opens.

### Closure of the attempt-1 findings
- **🟡1 (stale merge ref): closed.** `deploy/deployment-repo/.github/workflows/stoktok-guards.yml:39-44`.
  - `HEAD_SHA` is passed as step env (`:41`). It is not inlined into the script, so there is no expression injection.
  - The check reads the commit it actually checked out (`git -C pr cat-file -p HEAD`), so there is no gap between what is verified and what is read.
  - It fails closed in every case: empty `HEAD_SHA`, a missing object, or `cat-file` failing. The default shell has no pipefail, but `grep` then gets empty input and exits 1.
  - Pins and mutation tests are in place: `scripts/check-deploy-env.sh:391-405` and `scripts/test-deploy-guards.sh:177-178` (G9, G10).
- **🟡2 (forged workflow commands): closed.** `deploy/deployment-repo/ops/check-stoktok-workflow.sh:23-38`.
  - CR, NEL, U+2028 and U+2029 are rejected before anything is printed, and the rejection message is fixed text.
  - `show()` also strips CR.
  - Stop-commands is printed on stderr, which is the same pipe as every FAIL and `show` line, so the ordering is preserved. The runner processes both stdout and stderr for commands, and while stop-commands is active it also suppresses the legacy `##[` form.
  - Mutation tests cover it: M40-M43, P2 and P3 (`test-deploy-guards.sh:152-158`). The `^::` assertion now splits on CR (`:55-56`).
- **🟡4 (nothing checks the checker): closed.** `deploy/deployment-repo/README.md:49-51` states that the checker is protected only by CODEOWNERS plus "Require review from Code Owners". Whether that setting is actually on is still Ming's open question.
- **🟡3 (actions pinned by mutable tag): deferred** to a follow-up, as agreed. The pin at `check-deploy-env.sh:373` still requires `@v7`.

### Answers to your specific questions
- **How good is the token, and where is it printed?**
  - `check-stoktok-workflow.sh:34` builds it from `od -An -N16 -tx1 /dev/urandom`, i.e. 128 bits of CSPRNG hex with an `stk` prefix. It cannot be guessed and it is never a runner command name.
  - If `od` fails, `set -euo pipefail` aborts the assignment before anything is printed, so the script fails closed.
  - The token is printed exactly twice, both on stderr: at `:35` (start) and in the EXIT trap at `:36` (end). Showing it in the log is inherent to the mechanism. It is harmless because the PR's content is fixed before the run starts.
- **Is any PR-derived byte printed before stop-commands?** No. Before `:35` the only output is:
  - the usage message with `$WF`, which is a path fixed by `main`'s workflow;
  - the fixed CR-rejection message;
  - in the workflow step, the fixed "merge ref is not current" message, which contains only `HEAD_SHA`.
- **Can `HEAD_SHA` flow anywhere unsafe?** No. Its value comes from the event payload, and GitHub always sets it to 40 hex characters. It is used only as a `grep -F` pattern and in an `echo` to stderr.
- **Can a crafted commit satisfy the parent check?** No.
  - The commit object checked is GitHub's generated merge commit, not the author's. Its header holds only `tree`, `parent`, `author` and `committer` lines, and its message is GitHub's fixed "Merge … into …".
  - `grep -x` needs a whole line equal to `parent <head sha>`. Indented `mergetag` or `gpgsig` continuation lines cannot match, and a commit cannot name its own future descendant.
  - A fast-forward or missing merge ref fails closed.

### New findings
**🟡5 (low): the guard-job pins don't forbid step-level keys that turn the check green or move it.**
- Where: `scripts/check-deploy-env.sh:345-405`.
- What is missing: nothing rejects these on the check step or the checkouts:
  - `continue-on-error: true` or an `if:` on the check step: the job passes even when the checker exits 1;
  - `working-directory:` or `shell:` on the step;
  - `repository:` on the second checkout.
- Why it is low: each needs an edit to `stoktok-guards.yml` on deployment `main`, which is gated by code-owner review. The pins are a drift tripwire, not a control.
- Fix (one commit): add a key allow-list for the job, or at least fail on `continue-on-error|if:|working-directory|shell:|repository:` in `g_nc`, with G11-G13 mutation cases. This ties to AC1.

### Nits
- **N1 (test gap):** `test-deploy-guards.sh:55-56` accepts the stop and end token lines anywhere and in any number.
  - Assert that the first `::` line is `::stop-commands::<t>`, that the only other one is `::<t>::` with the same `<t>`, and that nothing follows it.
  - This locks in that no subshell ever fires the EXIT trap early. It doesn't happen today: bash resets EXIT traps in `$(…)` and pipeline subshells, including bash 3.2. But it is what the invariant depends on.
- **N2:** `show()` strips only CR. Other C0 characters and ESC (ANSI escape sequences) still reach the log. Up-front rejection already covers everything that breaks a line, so the remaining risk is cosmetic. `LC_ALL=C sed 's/[[:cntrl:]]/?/g'` would close it.
- **N3:** `README.md:52` says "the merge commit's second parent", but the code accepts *any* `parent` line. It is safe: the head can only equal the first (base) parent if the PR has no commits. Align the wording, or match on the second parent line.
- **N4 (residual):** the parent check pins the head but not the base. A run's merge result can be based on an older `main`, and `pull_request_target` does not re-run when `main` moves. This is closed only by "Require branches to be up to date" on the required `stoktok-guards / check`. Add it to the README control paragraph.

### Recommendations
1. Before opening the PR, `cmp` the deployment branch at 02dec4d against the drafts (AC2).
2. Optional within this ticket: 🟡5 plus N1. Otherwise send them to the follow-ups along with 🟡3.
3. N3 and N4 are a one-line README edit (AC2).

### Risks
The real control over `deploy-stoktok.yml` and over the checker itself is still human code-owner review on deployment `main` plus the `stoktok` environment's main-only rule. The guard job is a tripwire and is advisory until it is made a required check.

### Open questions (still open from attempt 1)
- Is "Require review from Code Owners" on for deployment `main`?
- Is "Run workflows from fork pull requests" off?
- Will `stoktok-guards / check` be required, with "require branches up to date"?

### Files
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/stoktok-guards.yml
- /home/user/stoktok/deploy/deployment-repo/ops/check-stoktok-workflow.sh
- /home/user/stoktok/deploy/deployment-repo/README.md
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/scripts/test-deploy-guards.sh

> Orchestrator, 2026-11-18: verified with `cmp` that the three files on deployment branch stoktok/stk-097-workflow-guards @ 02dec4d are byte-identical to the stoktok drafts (the auditor could not see that checkout).

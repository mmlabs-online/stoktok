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

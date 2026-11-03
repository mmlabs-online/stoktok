# STK-043 security review, attempt 1

**Verdict: no 🔴. I found no path in the draft that leaks the secret values.** There are two 🟡 findings. Both are about honest scope (what the docs claim, and gaps in the guard script), not about leaks in the workflow. I only read files; nothing was modified. I did not open any `.env` file. I made no changes and ran no checks.

## Findings

### What holds up (main file: `/home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`)
- 🟢 **Secrets only enter through step env.** The only place secrets come in is the `env:` block of the `secrets` step (:99-100). No `${{ secrets.* }}` appears in any `run:` block, so the script file the runner writes to `_temp` holds no values.
  - The values are written with the `printf` builtin plus a redirect (:123). They never appear in another program's arguments, a heredoc, `set -x` output, an echo or `GITHUB_OUTPUT`.
  - `GITHUB_OUTPUT` only gets `ok` and `changed` (:132-135).
  - Error messages give the secret's name only (:107, :111, :115). Compose runs with `config --quiet` (:146).
- 🟢 **Newline and `$` injection into the env file are blocked.**
  - The checks at :110 and :114 use `[[ =~ ]]` with anchored character classes. Neither class contains a newline, `$`, `#`, a space or a quote.
  - In POSIX ERE, `$` matches only at the true end of the string. So a second line cannot be smuggled in, and compose's env-file interpolation and comment parsing never see a special character.
- 🟢 **File handling is sound.**
  - `umask 077`, then `mkdir` and `chmod 700` on the directory, then `mktemp` in the same directory, with an `EXIT` trap that deletes the temp file (:118-122).
  - The temp file is set to mode 600, then `mv -f` renames it into place. That is atomic on the same filesystem, and if `ENV_FILE` is a symlink, the rename replaces the link rather than writing through it.
  - After the rename, BSD `stat '%Su %Lp'` checks owner and mode (:128).
  - GitHub's default bash runs with `-e`, so a failed `printf` exits and the trap removes the temp file. If validation fails, the old file is left alone.
- 🟢 **Fail-safe when a secret is missing.**
  - Missing names are collected and the step exits 1 (:103-109).
  - `deploy` and `publish` have no `always()` or `failure()` condition, so they are skipped. `rollback` requires `steps.deploy.outcome == 'failure'`, so it does not run either.
  - `notify` has a `secrets:invalid` case (:217-222).
  - If GitHub created the environment on the fly with no secrets, the values come through empty and this same fail-safe stops the run.
- 🟢 **Rollback.** It re-checks that the file exists, its owner and mode 600 before `git restore` (:169-173). The env-file path is the same in the deployment repo's current `compose.yml` (lines 25 and 49), so restoring an older `apps/stoktok/` cannot point compose at a different file. The file writer lives in the workflow, not under `apps/stoktok/`, so a restore cannot swap it out (this is checked by `scripts/check-deploy-env.sh:103-107`).
- 🟢 **Main-only guard.** `if: github.ref == 'refs/heads/main'` (:39) plus `environment: stoktok` (:40). `docs/deploy.md:32` is right that the environment branch rule is the real control, because a manual run from another branch uses that branch's copy of the workflow. Tell Ming not to add tag patterns to that rule.
- 🟢 **Free-plan fallback** (`docs/deploy.md:35`). It states the weakness. `:34` also covers the trap that a repo-level secret with the same name silently fills in when the environment secret is missing.

### 🟡 1. The docs overstate what `main` protection protects
- `docs/deploy.md:22` (D5) says branch protection "is what stands between a push and the key". That is only true for the GitHub secret.
- The host file `/Users/gh-runner/.config/stoktok/stoktok.env` can be read by any job on `macbook-runner` running as `gh-runner`. Anyone with write access to `mmlabs-online/deployment` can create such a job without touching `main`:
  - push a feature branch with a new `on: push` workflow that has `runs-on: self-hosted`;
  - open a pull request from a branch in the same repo (`pull_request` runs the PR branch's workflow file);
  - or start `runner-check` (`/home/user/deployment/.github/workflows/runner-check.yml`) from a modified branch.
- This is the consult's F7 and was already true with the hand-made file, so it is not a regression. But the runbook should say it plainly: **the real boundary is who has write access to the deployment repo.** Branch protection on `main` is not it.
- Suggested D5 wording: "write access to the deployment repo = access to the key. Keep collaborators to Ming and the operator."
- Possible mitigations, all subject to plan availability: a runner group limited to selected workflows on `main`, or a push ruleset that blocks changes to `.github/workflows/**` on non-main branches. This already sits in the follow-ups as "Runner group"; tie it to this point.
- This affects AC5 (the runbook precondition), not the workflow code.

### 🟡 2. `scripts/check-deploy-env.sh:81` misses some ways of reading secrets
The pattern `(^|[^.A-Za-z])secrets\.` does not catch:
- `${{ toJSON(secrets) }}`, which dumps every secret at once;
- `secrets['X']` (index syntax).

The "allowed mapping line" exception also lets through any line shaped like `  FOO: ${{ secrets.X }}`, even when it sits inside a `run:` block or under an action's `with:`.

Suggested fix: fail on any `secrets` access that is not `secrets.<NAME>`. For example, fail on `grep -nE 'secrets *[\[)]|toJSON\( *secrets'`. Optionally, also require that the only `secrets.` lines are the two exact lines in the `secrets` step. This affects AC2 and AC6.

### Smaller 🟢 notes
- `check-deploy-env.sh:85` does not catch `shell: bash -x {0}` or `bash -x`. `:89` only catches `config` when it follows `"`. A bare `docker compose ... config` would slip through. Cheap to widen.
- After the rename, a failed `stat` check (:128) leaves the new file in place. The message "Nothing was started" is accurate; just don't claim the old file was kept.
- The secret values sit in the environment of child processes (`mktemp`, `cmp`, `mv`, `stat`). On macOS, only the same user or root can see another process's environment, and the containers' environment shows up in `docker inspect` for `gh-runner`. Both are acceptable under the threat model. Optional: `unset` both variables right after the `printf`.
- If the job is killed hard (SIGKILL on timeout), a temp file `.stoktok.env.XXXXXX` can be left behind. It has mode 600 in a 700 directory, so the risk is negligible.
- `actions/checkout@v7` is still pinned to a tag. It runs in a job that can read the host file, which makes STK-037 🟡5 (pin actions to a commit SHA) more urgent.
- The checks run only against the drafts in the stoktok repo. Nothing in CI checks that the copy merged into `mmlabs-online/deployment` matches the draft.

## Recommendations
1. Reword D5 in `docs/deploy.md:22`, as described in 🟡1 (AC5).
2. Close the gaps in the guard at `scripts/check-deploy-env.sh:81` (🟡2) (AC2, AC6).
3. Optionally, widen the `-x` and `config` checks (AC2).
4. Keep the follow-ups: runner group / workflow ruleset, SHA-pinning actions, Time Machine exclusion for `/Users/gh-runner/.config` (that directory now always holds the live key).

## Risks
- If the fallback is used (repo-level secrets), any branch's workflow can read the GitHub secret, not just the host file. GitHub masks secrets in logs, but that is easy to get around (for example with base64). The docs state this.
- The key pasted into chat on 2026-11-01 stays live until step 6 of the rotation runbook is done.

## Open questions
- `/home/user/deployment/.github/CODEOWNERS` lists `@didi-code0980` as owner of everything, not Ming. Who are the admins and writers of the deployment repo? Each of them can read the key: an admin can change the environment's branch rule, and a writer can reach the runner. Ming should confirm he accepts that.
- Does the org plan support environments on a private repo? This is already in the PR checklist.

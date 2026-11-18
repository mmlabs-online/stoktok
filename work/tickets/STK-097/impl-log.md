## Attempt 1 — 2026-11-18

### Files touched
stoktok repo, commit 1 `8ed5663` (pure move, `pnpm check:deploy-env` OK before and after) and commit 2 `b9e1734`:
| File | Required because |
|---|---|
| `deploy/deployment-repo/ops/check-stoktok-workflow.sh` (new) | the vendored, portable checker: moved workflow-only checks (commit 1), then the new rules (commit 2): 🟡8, 🟡9, 🟡10, xtrace, `release.env` nit, 🟡7 order pin, pull fail-closed pins, step layout, name-independent key guards, prefixed output |
| `scripts/check-deploy-env.sh` | moved checks removed, calls the checker; pins for `stoktok-guards.yml` (`STK097_GUARDS_WF` override); `ops/*.sh` in the `bash -n` loop |
| `scripts/test-deploy-guards.sh` (new) | mutation proofs U1-U3, B0, M1-M39, R1-R9, C1-C3, P1, G0-G4, pull behaviour B1-B5 |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | header; `dir=` + stale `rm -f` at the start of `secrets`; fail-closed `pull` |
| `deploy/deployment-repo/.github/workflows/stoktok-guards.yml` (new) | deployment-side PR job (pull_request_target, read-only) |
| `deploy/deployment-repo/README.md` | rows for the 2 new files; the control stated |
| `package.json` | `check:deploy-env` also runs `test-deploy-guards.sh` |
| `.github/workflows/ci.yml` | job `deploy-guards-macos` |
| `docs/deploy.md` | guards subsection; 🟡7 / fail-closed note; step 6 "repeat steps 2-5"; stage 0.3 `gh pr ready --undo` |
| `work/ming-todo.md` | line 39 wording; STK-097 Ming items |

deployment repo (`/home/user/deployment`), branch `stoktok/stk-097-workflow-guards` from fetched origin/main `563d1e2`, commit `0428c97`, NOT pushed, no PR opened (no push allowed in this run). Exactly 3 files, each `cmp`-equal to the stoktok draft: `.github/workflows/deploy-stoktok.yml`, `.github/workflows/stoktok-guards.yml`, `ops/check-stoktok-workflow.sh`. Nothing under `apps/`. Created through a temporary worktree (removed), so the checked-out branch `stoktok/expand-shared-postgres` was not touched.

Pre-edit parity: `git fetch --depth=50 origin main`, then `git show origin/main:.github/workflows/deploy-stoktok.yml | cmp - <stoktok draft at 233b075>` was silent (byte-equal). No drift.

### Tests added / changed
- `scripts/test-deploy-guards.sh` (run by `pnpm check:deploy-env`): 66 `ok` lines. Every mutation also asserts the file really changed and that no output line starts with `::`.
- Old shape check: running the script against the pre-change draft, B3, B4 and B5 fail (step exit 0), so the pull cases fail with the old `if … config --services | grep -qx migrate`.
- No `packages/core` change, so no Vitest tests (R8).

### Checks (actual output summary)
- typecheck: `pnpm typecheck` Done (web, worker)
- lint: `pnpm lint` Done
- test: `pnpm test` exit 0 (web: 46 files, 360 tests passed)
- check:deploy-env: `OK: deploy env lists consistent`, then `OK: deploy guard mutation proofs` (66 ok)
- `bash -n` on `scripts/*.sh` and `deploy/deployment-repo/ops/*.sh`: clean
- Deployment worktree: `bash ops/check-volume-safety.sh .` exit 0; `bash ops/check-stoktok-workflow.sh .github/workflows/deploy-stoktok.yml` exit 0; both workflow files parse as YAML.
- bash 3.2: NOT run (no bash:3.2 image, docker daemon unavailable). Checked by hand: no `\s \w \b`, `grep -P`, `sed -i`, `mapfile`, `${x,,}`, empty array expansion, or awk intervals in the checker and test script. The CI job `deploy-guards-macos` is the real proof; it skips the G cases (`STK097_SKIP_CROSSFILE=1`) because they run `check-deploy-env.sh`, which still uses GNU-style greps.
- No `pnpm format` script exists in this repo (only lint), so none was run.
- Secret scan: `grep -rF -f <password file>` over work, docs, deploy, scripts: 0 hits (file never printed); deployment diff `[A-Za-z0-9+/]{43}=` count 0.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- The cross-file part of `check-deploy-env.sh` still uses `\s` and GNU-isms, so G0-G4 are Linux-only.
- Deny-list is a tripwire; `xargs cat`, `eval`, SHELLOPTS/BASH_ENV are not covered (as in the plan).
- Optional worker-image `/app/migrations` refusal and runtime self-check step (plan follow-ups).
- A deployment PR could not be opened (no push); push the branch and open it with the body below.

### Deployment PR body (title: `stoktok: workflow guards and fail-closed migrate detection (STK-097)`)
> Part of STK-097 (stoktok repo). Three files, nothing under `apps/`, so merging deploys nothing; all three are byte-equal to the drafts in `deploy/deployment-repo/` of mmlabs-online/stoktok.
>
> - `ops/check-stoktok-workflow.sh`: portable (macOS bash 3.2, BSD tools) checker for `deploy-stoktok.yml`: secrets-step order and guards, deny list (set/env/cat/grep/sed/awk/cp/..., `docker inspect -f` dumps, `compose convert`, `exec env`, `/proc/*/environ`, xtrace), one temp file, chmod and `ENV_FILE` confinement, triggers, fail-closed migrate detection. A tripwire, not a complete control.
> - `.github/workflows/stoktok-guards.yml`: runs it on every PR into `main`. Same pattern as `volume-safety`: `pull_request_target` (workflow and checker come from `main`), read-only token, no environment or secrets, `persist-credentials: false`, the PR's `deploy-stoktok.yml` from `refs/pull/<n>/merge` checked out into `pr/` and only read. Printed workflow text is prefixed so it cannot form workflow commands.
> - `.github/workflows/deploy-stoktok.yml`: (1) `pull` fails closed: a `compose config --services` error, or a list without `stoktok-web`, stops the run instead of reading as "no migrate service" (v0.2.1 still deploys as today: `migrate=false` plus the same notice); (2) `secrets` removes stale `.stoktok.env.??????` temp files first; (3) header says /healthz (expand) and /readyz (cutover).
>
> It does not run on this PR (`pull_request_target` uses `main`); run by hand: `bash ops/check-stoktok-workflow.sh .github/workflows/deploy-stoktok.yml` exits 0, `bash ops/check-volume-safety.sh .` exits 0.
>
> Ming: (1) merge before cutover stage 4; (2) after the first run make `stoktok-guards / check` a required status check; (3) after `deploy-stoktok` #10 is green, optionally run it via `workflow_dispatch` on `main` and check the notice "has no migrate service yet", `deployed: … v0.2.1 … healthy`, `changed=false`, and no `.stoktok.env.*` in `~/.config/stoktok`.

### Scope self-check
- Could the diff be smaller? No; the 330 moved lines are mechanical, and the plan itself noted the size.
- Diff size (stoktok, 233b075..HEAD before this log): +617 / -173 across 10 files; deployment: +314 / -3 across 3 files.

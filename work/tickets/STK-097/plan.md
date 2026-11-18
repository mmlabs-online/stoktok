Status: READY

# Plan: STK-097, deploy-env guards on the live deployment workflow, and close the guard bypasses (slice 1 of 2)

## Spec summary
This plan covers the ticket text (`work/tickets/STK-097/ticket.md`), the reviews it cites, and these sections of CLAUDE.md:
- **R3:** "Database credentials are server-only … never in client bundles".
- **Conventions:** "Keys are never returned to the browser or logged".
- **R7:** "Stay inside the ticket's plan".
- **R8:** "No PASS without green checks".

Ticket scope, quoted:
- "🟡2: run the secrets-step guards against the live `deploy-stoktok.yml` (e.g. a deployment-repo CI job, or a vendored copy of the checks); state the control in `deploy/deployment-repo/README.md`."
- "🟡7: at the start of `secrets`, remove stale `"$dir"/.stoktok.env.*` left by a killed run; docs note."
- "🟡8: deny `docker inspect -f` formats that dump env (`Config.Env`, `{{json .}}`, `{{.}}`)."
- "🟡9 and review gaps: `set | …`, `( set -o posix; set )`, `compgen -v` / `${!v}`, `$(<file)`, `< "$ENV_FILE" cat`, `grep`/`sed`/`awk`/`base64`/`tac`/`cp`/`dd`/`while read` on the env file, `$pwfile` or `secrets/`, `compose … convert`, `compose exec|run … env|printenv`, `/proc/*/environ`, `shell: bash -x {0}`, `set -o  xtrace` with extra spaces; comment that the list is a tripwire, not a complete control."
- "🟡10: exactly one `mktemp` and one `tmp=` in the secrets step; no `chmod` on `$ENV_FILE` except `chmod 600 "$tmp"`; `$ENV_FILE` allowed outside the secrets step only on the known lines; no step-level `ENV_FILE:` override."
- "Nit: the `\.env` deny pattern must not flag `release.env`."

Ticket notes, quoted:
- STK-094 🟡2: "live deploy-stoktok.yml migrate detection fails open … capture the service list under `set -e` … Workflow header still says /healthz."
- STK-094 🟡10: "runbook step 6 should repeat steps 2–5; ming-todo line 39 order; stage 0.3 fallback `gh pr ready --undo`".
- Orchestrator: "Parts that change the live deployment repo (🟡2 workflow fix, 🟡6, deployment-side guard) go on a deployment-repo branch + PR, like STK-093; Ming merges."

Acceptance criteria, quoted:
- "Each item above has a mutation proof (the check exits 1) and the real workflow still passes."
- "The live deployment workflow is covered by the guards in a way Ming approves."
- "typecheck, lint, test, check:deploy-env green; no secret printed or committed."

The compose-side items move to STK-099; see "Split proposal". They are: STK-094 🟡9 (decoy, block-scalar, `---` and `include:` bypasses), 🟡6 (`read_only`, "no internet egress"), the web/worker allow-lists, the worker `profiles: [jobs]` pin, and exact network lists.

## Where the deployment-side guard lives (decision and why)
**Chosen:** a vendored checker, plus a small PR-time job in the deployment repo that runs it against the merge result.
- Move every workflow-only check out of `scripts/check-deploy-env.sh` into one self-contained, portable script: `deploy/deployment-repo/ops/check-stoktok-workflow.sh <workflow-file>`. This covers the secrets step, the deny lists, the triggers and migrate detection.
- `check-deploy-env.sh` calls it on the stoktok draft.
- The same file is copied verbatim to `ops/check-stoktok-workflow.sh` in `mmlabs-online/deployment`. A new `.github/workflows/stoktok-guards.yml` runs it on every pull request into `main`.
- This gives one source of truth: the draft. It reaches the deployment repo the same way the workflow does (verbatim copy, `cmp`).

The job follows the deployment repo's existing `volume-safety.yml` pattern, which Ming has already accepted:
- `pull_request_target`, so the workflow and the checker always come from `main` and a PR cannot weaken the checker it is judged by.
- `permissions: contents: read` only. No `environment`, no `secrets.`, and `persist-credentials: false` on both checkouts.
- The PR side is a sparse checkout of the single file `.github/workflows/deploy-stoktok.yml` into `pr/`. It is only read (grep/awk), never executed.
- It checks out `refs/pull/<n>/merge`, not the head. That is the file that would land on `main`, so other apps' PRs branched before this lands do not go red because of a stale copy of deploy-stoktok.yml.
- It runs on every PR (no `paths:` filter), so Ming can make it a required check without it sitting in "expected" on unrelated PRs.
- `runs-on: [self-hosted, macbook-runner]`, like every deployment workflow (there is no hosted-runner precedent there). The checker must therefore run on macOS `/bin/bash` 3.2 with BSD grep, sed and awk.

**Rejected alternatives:**
1. A stoktok CI job that fetches the live workflow. It needs a cross-repo read token stored as a stoktok secret, so it is not least-privilege. It also only sees `main` after the merge and cannot block a deployment PR.
2. A self-check step inside `deploy-stoktok`. It would run in the job that holds the `stoktok` environment and `contents: write`, and the checker would come from the same commit as the workflow it checks. With `main` protected, the PR-time check covers the same edits earlier. Listed under follow-ups.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | The workflow-only checks live in `deploy/deployment-repo/ops/check-stoktok-workflow.sh`. Its usage is `bash check-stoktok-workflow.sh <file>`; exit 0 = OK, 1 = FAIL, 2 = usage (missing arg, not a regular file, or the file or its `.github`/`workflows` parent is a symlink). `check-deploy-env.sh` calls it on the draft and fails if it fails. Every check listed under "Moved" in Approach step 1 is in the checker and no longer in `check-deploy-env.sh`. | Read both scripts. `pnpm check:deploy-env` prints `OK`. `bash deploy/deployment-repo/ops/check-stoktok-workflow.sh deploy/deployment-repo/.github/workflows/deploy-stoktok.yml; echo $?` gives 0. With no argument it gives 2. |
| 2 | The checker is portable to macOS bash 3.2 and BSD tools: no `\s`/`\w`/`\b`, no `grep -P`, no `sed -i`, no `mapfile`, no `${x,,}`, no gawk-only functions, and no empty array expansion under `set -u`. | `grep -nE '\\[swb]' deploy/deployment-repo/ops/check-stoktok-workflow.sh scripts/test-deploy-guards.sh` finds no code lines. The new CI job `deploy-guards-macos` is green on the PR (runs `/bin/bash` with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`). |
| 3 | Every scope item has a mutation proof, committed as `scripts/test-deploy-guards.sh` and run by `pnpm check:deploy-env`. Each mutation exits 1; the unchanged draft and the negative controls exit 0. | `bash scripts/test-deploy-guards.sh` exits 0 and prints one `ok` line per case (table in "Tests to write"). The reviewer also deletes one case's expected failure (for example, removes the 🟡8 deny rule from the checker) and sees the test exit 1. |
| 4 | 🟡2: the `pull` step fails closed. The service list is captured by a plain assignment (step fails under `bash -e`). A list without `stoktok-web` is an error. Only then is `migrate` grepped from the variable. The checker pins this shape. | Behaviour cases B1-B5 in `scripts/test-deploy-guards.sh` (a docker shim runs the `pull` step extracted from the draft). Mutations M35-M37 FAIL. The impl-log records that putting the old `if … config --services \| grep -qx migrate` back makes B3 fail. |
| 5 | v0.2.1 (expand compose, no migrate) deploys exactly as today. On an expand compose the `pull` step outputs `migrate=false` plus the same notice, and no step other than `pull` and the start of `secrets` (and the header comment) changes. | B1 (expand → `migrate=false`, rc 0). `git diff` of the draft workflow touches only the header comment, the `dir=`/`rm -f` lines (and the removed old `dir=` line) in `secrets`, and the `pull` step body. |
| 6 | 🟡7: right after the home-prefix check, `secrets` runs `dir="$(dirname "$ENV_FILE")"` then `rm -f "$dir"/.stoktok.env.??????`, before validation and before `mktemp`. Pinned in order: `umask 077` < `rm` < `pwfile=` < `mktemp`. Docs note added. | Mutations M38-M39 FAIL. `docs/deploy.md` has the note (Files table). |
| 7 | The workflow header no longer says only "(/healthz)". It names `/healthz` for the expand compose and `/readyz` from the cutover compose, and says the `pull` step fails closed and that `stoktok-guards` checks this file on every PR. | Read the draft lines 1-30. |
| 8 | 🟡8, 🟡9, 🟡10, the xtrace gaps and the `release.env` nit are closed as listed in Approach step 2. The deny list carries the comment "tripwire for accidental leaks, not a complete control". | Mutations M1-M34 FAIL. Controls C1-C3 PASS. Read the comment. |
| 9 | Any workflow text the checker prints (offending lines) is prefixed, so no printed line starts with `::`. This matters because the job runs under `pull_request_target` on PR content, and a line starting with `::` would be read as a workflow command. | Case P1: a mutation adding `echo "::warning::x"; set` FAILs, and no output line matches `^::`. |
| 10 | `deploy/deployment-repo/.github/workflows/stoktok-guards.yml` is exactly the least-privilege job in "Where the deployment-side guard lives", and `check-deploy-env.sh` pins it. Pins: the `on:` block is exactly `pull_request_target` with `branches: [main]`; `permissions:` is only `contents: read`; `persist-credentials: false` twice; the PR checkout uses `refs/pull/${{ github.event.pull_request.number }}/merge` and `path: pr`; no `secrets.`, no `environment:`; exactly one `run:`, equal to `bash ops/check-stoktok-workflow.sh pr/.github/workflows/deploy-stoktok.yml`. | Mutations G1-G4 FAIL (`contents: write`; one `persist-credentials: false` removed; `secrets.X` added; an extra `run: bash pr/x.sh`). |
| 11 | Live parity. Deployment branch `stoktok/stk-097-workflow-guards`, created from a freshly fetched `origin/main`, changes exactly 3 files: `.github/workflows/deploy-stoktok.yml`, `.github/workflows/stoktok-guards.yml` and `ops/check-stoktok-workflow.sh`. All 3 are byte-equal to the stoktok drafts, and nothing under `apps/` changes, so merging deploys nothing. Before editing, `origin/main:.github/workflows/deploy-stoktok.yml` was byte-equal to the old draft (if not, stop and record the drift). | In `/home/user/deployment`: `git diff --stat origin/main...stoktok/stk-097-workflow-guards` lists the 3 files. `git show stoktok/stk-097-workflow-guards:<f> \| cmp - /home/user/stoktok/deploy/deployment-repo/<f>` is silent for each. The impl-log records the pre-edit `cmp`. |
| 12 | The deployment branch passes the deployment repo's own checks, and the guard passes on the live file it creates. | In a worktree of the deployment branch: `bash ops/check-volume-safety.sh .` exits 0; `bash ops/check-stoktok-workflow.sh .github/workflows/deploy-stoktok.yml` exits 0. The deployment PR is open, its body states the control and the Ming steps, and its URL is in impl-log. |
| 13 | `deploy/deployment-repo/README.md` states the control: what runs, where and when, what it covers (only `deploy-stoktok.yml`; the compose is covered by the stoktok-side check and the stage 0.3 `cmp`), that it is a tripwire, how to update it (edit the drafts in stoktok, copy verbatim in a setup PR), that deleting `deploy-stoktok.yml` fails the check, and that it is advisory until Ming makes it required. The table lists the 2 new files. | Read the README. |
| 14 | Docs nits from STK-094 🟡10: `docs/deploy.md` "Cutover release" step 6 says "repeat steps 2-5". Stage 0.3 says "if `isDraft` is `false`, run `gh pr ready --undo <n> --repo mmlabs-online/deployment` now". `work/ming-todo.md` line 39 reads "converts it to a draft as soon as it opens, then adds the compose commit". | Read the three lines. |
| 15 | `docs/deploy.md` has a short "Workflow guards in the deployment repo (STK-097)" subsection, and `work/ming-todo.md` has the STK-097 Ming items (merge the deployment PR before cutover stage 4, make `stoktok-guards / check` required, the optional `workflow_dispatch`). | Read both. |
| 16 | No secret is printed or committed. | `grep -rF -f /home/user/deployment/postgres/secrets/apps/stoktok.password /home/user/stoktok/work /home/user/stoktok/docs /home/user/stoktok/deploy /home/user/stoktok/scripts` finds nothing (never print that file). `git -C /home/user/deployment diff origin/main...stoktok/stk-097-workflow-guards \| grep -cE '[A-Za-z0-9+/]{43}='` prints 0. |
| 17 | Checks are green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:deploy-env` (now also runs `test-deploy-guards.sh`), plus `bash -n` on every `.sh` (the loop now includes `deploy/deployment-repo/ops/*.sh`). | Run them. CI on the stoktok PR, including `deploy-guards-macos`. |

### Ming verification after merge
1. Read the deployment PR (the design above) and merge it. This is how Ming approves the control (AC "in a way Ming approves").
2. In `mmlabs-online/deployment` → Settings → Branches/Rules for `main`, add `stoktok-guards / check` as a required status check after its first run. Until then a red check is advisory only.
3. Once `macbook-runner` is online, any deployment PR shows `stoktok-guards / check` green.
4. After `deploy-stoktok` #10 is green: run `deploy-stoktok` via `workflow_dispatch` on `main`. The `pull` step shows the notice "has no migrate service yet"; the summary says `deployed: … v0.2.1 … healthy`; `changed=false` (no recreate). `ls -a ~/.config/stoktok` shows no `.stoktok.env.*`. Never print the env file.
5. Merge the deployment PR before cutover stage 4, so v0.3.0 is deployed by the fail-closed workflow.

## Files to create / modify
**stoktok repo**
| File | Change | Required because |
|---|---|---|
| `deploy/deployment-repo/ops/check-stoktok-workflow.sh` | New: the vendored, portable workflow checker (moved checks + new checks + prefixed output) | 🟡2, 🟡8, 🟡9, 🟡10, nit, STK-094 🟡2 pin |
| `scripts/check-deploy-env.sh` | Remove the moved checks. Call the checker on `$WF`. Keep the cross-file checks. Add pins for `stoktok-guards.yml`. Add `deploy/deployment-repo/ops/*.sh` to the `bash -n` loop. | Single source; AC 1, 10, 17 |
| `scripts/test-deploy-guards.sh` | New: mutation proofs, negative controls and pull-step behaviour cases | AC 3, 4, 9, 10 |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | Header text; `secrets`: `dir=` moved up plus the stale `rm -f`; `pull`: fail-closed detection | 🟡2 (STK-094), 🟡7, header |
| `deploy/deployment-repo/.github/workflows/stoktok-guards.yml` | New: the deployment-side PR job | 🟡2 (STK-093) |
| `deploy/deployment-repo/README.md` | Table rows for the 2 new files; statement of the control | 🟡2 "state the control" |
| `package.json` | `check:deploy-env` = `bash scripts/check-deploy-env.sh && bash scripts/test-deploy-guards.sh` | Mutation proofs run in CI |
| `.github/workflows/ci.yml` | New job `deploy-guards-macos` (`runs-on: macos-latest`, checkout, `env PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash scripts/test-deploy-guards.sh`); inherits `contents: read` | Proves the checker works on the Mac runner's bash and BSD tools (AC 2) |
| `docs/deploy.md` | "Workflow guards in the deployment repo (STK-097)" subsection; 🟡7 temp-file note next to the `secrets` description (Shared Postgres C, "What happens"); step 6 "repeat steps 2-5"; stage 0.3 `gh pr ready --undo` fallback | 🟡2, 🟡7, STK-094 🟡10 |
| `work/ming-todo.md` | Line 39 wording; new STK-097 items (merge, required check, dispatch) | STK-094 🟡10, AC 15 |
| `work/tickets/STK-097/impl-log.md` | Implementer log, including the deployment PR body and the pre-edit `cmp` | Workflow |

**Deployment repo** (`/home/user/deployment`, branch `stoktok/stk-097-workflow-guards` from freshly fetched `origin/main`; one commit `stoktok: workflow guards and fail-closed migrate detection (STK-097)`; PR into `main`, not draft; Ming merges):
| File | Change |
|---|---|
| `.github/workflows/deploy-stoktok.yml` | Verbatim copy of the draft |
| `.github/workflows/stoktok-guards.yml` | Verbatim copy of the draft |
| `ops/check-stoktok-workflow.sh` | Verbatim copy of the draft |

No file under `apps/` is touched.

## Tests to write
All cases are in `scripts/test-deploy-guards.sh` (bash 3.2-portable).

**Helpers.** Each helper works on a fresh `mktemp` copy of the draft workflow:
- `ins_end <step> <line>`: append a run line (10-space indent) at the end of that step's `run:` block.
- `ins_after <trimmed anchor> <line>`: insert after the first line whose trimmed text equals the anchor, with the anchor's indent.
- `repl <trimmed old> <new>`
- `del <trimmed>`

Pass the strings to awk through `ENVIRON[...]`, not `-v`, because `-v` would expand the backslashes. Then `expect 1 <id>` or `expect 0 <id>` runs the checker on the copy.

**Baseline**
| Test | Covers |
|---|---|
| B0 the unchanged draft → 0 | The real workflow passes |

**🟡8: `docker inspect -f` that dumps env** (inserted into `deploy`)
| Test | Covers |
|---|---|
| M1 `docker inspect -f '{{json .Config.Env}}' x` → 1 | `Config.Env` |
| M2 `docker inspect -f '{{json .}}' x` → 1 | `{{json .}}` |
| M3 `docker inspect --format '{{.}}' x` → 1 | `{{.}}` |
| M4 `docker container inspect -f '{{json .Config}}' x` → 1 | Whole `Config` (contains Env) |

**🟡9 and review gaps** (inserted into `secrets` after the stat block unless noted)
| Test | Covers |
|---|---|
| M5 `set \| grep DATABASE` → 1 | `set` piped |
| M6 `set > "$GITHUB_STEP_SUMMARY"` → 1 | `set` redirected |
| M7 `{ set; }` → 1 | `set` in a group |
| M8 `( set -o posix; set )` → 1 | `set` in a subshell |
| M9 `for v in $(compgen -v); do echo "${!v}"; done` → 1 | `compgen -v`, `${!v}` |
| M10 `echo "$(<"$pwfile")"` → 1 | `$(<file)` |
| M11 `< "$ENV_FILE" cat` → 1 | Redirect before the command |
| M12 `grep . "$ENV_FILE"` → 1 | grep |
| M13 `sed -n p "$ENV_FILE"` → 1 | sed |
| M14 `awk 1 "$tmp"` → 1 | awk on `$tmp` |
| M15 `base64 "$ENV_FILE"` → 1 | base64 |
| M16 `tac "$tmp"` → 1 | tac |
| M17 `cp "$ENV_FILE" "$RUNNER_TEMP/x"` (in `deploy`) → 1 | cp |
| M18 `dd if="$ENV_FILE"` → 1 | dd |
| M19 `while IFS= read -r l; do echo "$l"; done < "$ENV_FILE"` → 1 | while read |
| M20 `grep . "$pwfile"` → 1 | `$pwfile` |
| M21 `cp postgres/secrets/apps/stoktok.password "$RUNNER_TEMP/p"` (in `deploy`) → 1 | `secrets/` |
| M22 `"${compose[@]}" convert` (in `pull`) → 1 | compose convert |
| M23 `"${compose[@]}" exec -T stoktok-web env` (in `deploy`) → 1 | exec env |
| M24 `"${compose[@]}" run --rm stoktok-web env` (in `deploy`) → 1 | run env |
| M25 `tr '\0' '\n' < /proc/1/environ` (in `deploy`) → 1 | /proc environ |
| M26 `shell: bash -x {0}` (after `id: deploy`, indent 8) → 1 | step-level xtrace shell |
| M27 `set -o  xtrace` (two spaces) → 1 | xtrace with extra spaces |

**🟡10**
| Test | Covers |
|---|---|
| M28 `tmp="$(mktemp)"` after `trap 'rm -f "$tmp"' EXIT` → 1 | Second `tmp=` / `mktemp` |
| M29 `x="$(mktemp)"` at the end of `secrets` → 1 | Second `mktemp` |
| M30 `chmod 644 "$ENV_FILE"` at the end of `secrets` → 1 | chmod on the env file in the step |
| M31 `chmod 644 "$ENV_FILE"` in `deploy` → 1 | chmod outside the step |
| M32 `ln "$ENV_FILE" "$RUNNER_TEMP/e"` in `deploy` → 1 | `$ENV_FILE` outside the step's known lines |
| M33 `ENV_FILE: /tmp/stoktok.env` added to the `secrets` step `env:` (indent 10) → 1 | Step-level override |
| M34 `echo "ENV_FILE=/tmp/x" >> "$GITHUB_ENV"` in `envdir` → 1 | Override via `GITHUB_ENV` / `ENV_FILE=` |

**🟡2 (STK-094): fail-closed migrate detection**
| Test | Covers |
|---|---|
| M35 `pull` reverted to `if "${compose[@]}" --profile migrate config --services \| grep -qx migrate; then` (services lines removed) → 1 | Old fail-open shape |
| M36 `services=…config --services \|\| true)"` → 1 | Swallowed error |
| M37 `stoktok-web` guard deleted → 1 | Sanity guard |

**🟡7: stale temp-file cleanup**
| Test | Covers |
|---|---|
| M38 `rm -f "$dir"/.stoktok.env.??????` deleted → 1 | Cleanup present |
| M39 the `rm` moved after `mktemp` → 1 | Order (it would delete its own temp file) |

**Moved checks still fail** (regression for the move)
| Test | Covers |
|---|---|
| R1 delete `umask 077` → 1 | Mode/order pin |
| R2 bare `mktemp` → 1 | Same-dir temp |
| R3 `pull_request_target:` added to `on:` → 1 | Trigger pin |
| R4 bare `set` → 1 | Old deny list |
| R5 `declare -p` → 1 | Old deny list |
| R6 `cat "$ENV_FILE"` → 1 | Old deny list |
| R7 `docker inspect stoktok-web` → 1 | inspect without `-f` |
| R8 a second `printf … > "$tmp"` → 1 | Single printf |
| R9 a guard line for one printf key deleted → 1 | Every printf key guarded |

**Negative controls**
| Test | Covers |
|---|---|
| C1 `cat "$APP_DIR/release.env"` in `deploy` → 0 | Nit: `release.env` not flagged |
| C2 `docker inspect -f '{{.State.Health.Status}}' x` → 0 | Safe `-f` allowed |
| C3 `set -euo pipefail` in `deploy` → 0 | `set` with options allowed |

**Output and the guard workflow**
| Test | Covers |
|---|---|
| P1 `echo "::warning::x"; set` → 1, and no output line matches `^::` | AC 9 |
| G1-G4 on a copy of `stoktok-guards.yml`, run through `check-deploy-env.sh` with `STK097_GUARDS_WF=<copy>` (an env override read only for this file) → 1. Mutations: `contents: write`; one `persist-credentials: false` removed; `X: ${{ secrets.X }}`; extra step `run: bash pr/x.sh` | AC 10 |

**`pull` behaviour**

Setup: extract the `pull` step's `run:` block from the draft and strip 10 spaces. Run it with `bash --noprofile --norc -e`, with `APP_DIR`, `PROJECT` and `GITHUB_OUTPUT` set to temp values, and a `docker` shim first on `PATH`. The shim prints `$SHIM_SERVICES` and exits `$SHIM_RC` for `config --services`, and exits 0 for anything else.
| Test | Covers |
|---|---|
| B1 `stoktok-web`, rc 0 → step rc 0, output `migrate=false` | Expand (v0.2.1) unchanged |
| B2 `stoktok-web` + `migrate`, rc 0 → rc 0, `migrate=true` | Cutover |
| B3 rc 1, no output → step rc ≠ 0, no `migrate=` line | Fails closed (fails with the old code) |
| B4 rc 0, empty output → step rc ≠ 0 | Garbage output |
| B5 as B3 but without `-e` → step rc ≠ 0 | The guard alone fails closed (`shell:` override) |

No `packages/core` logic changes, so no new Vitest tests (R8).

## Approach
1. **Extract** (mechanical, first commit). Create `check-stoktok-workflow.sh` with `set -euo pipefail` and `WF="$1"`, plus the usage and symlink checks (exit 2).
   - **Moved** from `check-deploy-env.sh`, each with a `[[:space:]]` rewrite of `\s`:
     - `environment: stoktok`; the main-only `if:`; `secrets.` only in env mappings
     - xtrace; `config` only with `--quiet`/`--services`; no heredoc
     - single printf shape and format/argument order; other writers
     - master-key guard; `DB_APP: stoktok`; the pw literals before `mktemp`; the pw order; pw/URL confinement
     - the mode/order pin; the deny list and `docker inspect`
     - the `on:` block and forbidden triggers; `backup`/`migrate` guarded by `steps.pull.outputs.migrate`
   - **Stays** in `check-deploy-env.sh`: everything that needs another file. That is:
     - doc ↔ `.env.example`, all compose checks, `release.yml` keys
     - ENV_FILE ↔ compose `env_file`, writer not under `apps/stoktok/`
     - doc table ↔ printf keys and secret names, required `missing` lines, optional guards
     - AHEAD_PREFIX ↔ `migrate.ts`, and the STK-044/045 path, label, publish and step-order checks

     It keeps its own small `secrets_step`/`printf_line` extraction for those.
   - **Self-contained additions:** exactly one `      - name: secrets` and one `      - name: pull`, secrets before pull (the range extraction depends on them).
   - **Name-independent key guard:** every printf key except `STOKTOK_DATABASE_URL` has a trimmed `if ! [[ "$KEY" =~ … ]]; then` line plus `exit 1` within 4 lines, before `mktemp`.
   - **Output:** all printed workflow text goes through `show() { sed 's/^/  | /'; }` or `grep -n`.
   - Run the checker on the draft and confirm the result is unchanged (B0) before adding rules.
2. **New rules** (on `wf_nc`, the non-comment lines). Add the comment "Tripwire for accidental leaks, not a complete control: the password is readable by everyone with deployment-repo read access."
   - **🟡8:** `inspect` lines matching `Config\.Env|\.Env([^A-Za-z]|$)|\{\{[[:space:]]*json[[:space:]]+\.[[:space:]]*\}\}|\{\{[[:space:]]*\.[[:space:]]*\}\}|\.Config[[:space:]]*\}\}`.
   - **🟡9 `set`:** `(^|[;{(|&][[:space:]]*)set[[:space:]]*($|[|>;)}&])`.
   - **🟡9 indirect and file reads:** `compgen`; `\$\{![A-Za-z_]`; `\$\([[:space:]]*<`.
   - **🟡9 input redirects:** any input redirect `<[[:space:]]*"?\$\{?(ENV_FILE|tmp|pwfile)([^A-Za-z0-9_]|$)` or `<[^<]*secrets/`, except the exact line `IFS= read -r pw < "$pwfile" || true`.
   - **🟡9 tool list:** `cat head tail less more xxd od strings grep egrep fgrep sed awk base64 tac rev cp dd nl`, followed on the line by `ENV_FILE|\$\{?tmp([^A-Za-z0-9_]|$)|\$\{?pwfile|secrets/|stoktok\.env|(^|[/[:space:]"'])\.env([^A-Za-z0-9_.]|$)`. This form fixes the nit: `release.env` is no longer flagged.
   - **🟡9 compose and /proc:** `convert` after a compose invocation; `[[:space:]](exec|run)[[:space:]].*[[:space:]](env|printenv)([[:space:]]|$)`; `/proc/[^[:space:]]*environ`.
   - **xtrace:** `set[[:space:]]+-[A-Za-z]*x|set[[:space:]]+-o[[:space:]]+xtrace|shell:.*(-[A-Za-z]*x|xtrace)|bash[[:space:]]+-[A-Za-z]*x`.
   - **🟡10, in the secrets step:** exactly one `mktemp` line and one `(^|[^A-Za-z0-9_])tmp=` line.
   - **🟡10, whole file:**
     - every `chmod` line, trimmed, is `chmod 700 "$dir"` or `chmod 600 "$tmp"`
     - exactly one `ENV_FILE:` line in the whole file, and it is `^  ENV_FILE: [^[:space:]]+$`
     - no `ENV_FILE=`; no `GITHUB_ENV` line mentioning `ENV_FILE`
   - **🟡10, outside the secrets step:** a line mentioning `ENV_FILE` must be, trimmed, one of the current known lines, copied verbatim into the checker: the top-level `ENV_FILE:`, the envdir home-prefix line, envdir `dir="$(dirname "$ENV_FILE")"`, the two rollback lines, and the notify `failure:env-missing)` line.
   - **🟡7 and 🟡2 pins:**
     - extend the mode/order awk with `rm -f "$dir"/.stoktok.env.??????` (`umask 077` < `rm` < `pwfile=` … < `mktemp`)
     - in the `pull` step (range `- name: pull` … `- name: backup`): exactly one trimmed `services="$("${compose[@]}" --profile migrate config --services)"`, then the `stoktok-web` guard `if ! printf '%s\n' "$services" | grep -qx stoktok-web; then` with `exit 1` within 4 lines, then `if printf '%s\n' "$services" | grep -qx migrate; then`
     - no `config --services` followed by `|` on the same line; no `set +e` and no `|| true` in `pull`
3. **Workflow draft** (load-bearing text).
   - In `secrets`, right after the home-prefix line:
     ```
     # STK-097: a hard-killed run skips the EXIT trap; runs never overlap (concurrency group), so any temp file here is stale.
     dir="$(dirname "$ENV_FILE")"
     rm -f "$dir"/.stoktok.env.??????
     ```
     Remove the later `dir=` line and keep `mkdir -p "$dir"` and `chmod 700 "$dir"`.
   - In `pull`, after `config --quiet` and `pull`:
     ```
     # STK-097: fail closed: a config error stops the run instead of reading as "no migrate service".
     services="$("${compose[@]}" --profile migrate config --services)"
     if ! printf '%s\n' "$services" | grep -qx stoktok-web; then
       echo "::error::compose config --services did not list stoktok-web; cannot tell whether $APP_DIR/compose.yml has a migrate service. Nothing was started."
       exit 1
     fi
     if printf '%s\n' "$services" | grep -qx migrate; then
     ```
     The two `GITHUB_OUTPUT` branches and the notice stay the same.
   - Update the header (AC 7).
   - The existing STK-045 step-order and other checks in `check-deploy-env.sh` must still pass.
4. **Guard workflow draft and its pins** (AC 10). Add `stoktok-guards.yml` and its header comment, modelled on `volume-safety.yml`. Add the pins to `check-deploy-env.sh` with the `STK097_GUARDS_WF` override for G1-G4.
5. **Tests:** `scripts/test-deploy-guards.sh`, then `package.json`, then the `ci.yml` macOS job.
6. **Docs:** README, `docs/deploy.md`, `ming-todo.md`.
7. **Deployment repo:**
   - `git -C /home/user/deployment fetch origin main`.
   - `cmp` `origin/main:.github/workflows/deploy-stoktok.yml` against the pre-edit draft (`git show HEAD:deploy/...` of the stoktok base). On a difference, stop and record it.
   - Create the branch from `origin/main`, copy the 3 drafts, `cmp`, run the checker and `check-volume-safety.sh`, commit, push, open the PR with a body that states the control and the Ming steps.

Rules: R3 and Conventions (no secret logged) are what the guards protect. R7: compose items are left to STK-099. R8: checks green, mutation proofs committed. R1, R2, R4-R6, R9 and R10 are not touched.

## Specialist input used
No consult files (the orchestrator skipped consult; the scope is itemised findings). The plan uses these review findings:
- **STK-093 security-review:** attempt 1 🟡2 and 🟡7; attempt 2 🟡8, 🟡9 (regexes adapted to POSIX classes) and 🟡10.
- **STK-093 review.md:** attempt 2 "Gaps found" and the nit.
- **STK-094 security-review:** 🟡2 (fail-closed capture adopted).
- **Not adopted:** STK-094 🟡2's optional "refuse a release whose worker image has `/app/migrations` without a migrate service". It needs a `docker run` of the image in `pull`, and it is unverified whether the v0.2.1 worker image already contains `/app/migrations`, which would break the expand deploy. The draft PR plus the stage 0.3 two-file check cover that case for now. Listed under follow-ups.

## Assumptions
- **Runner choice:** the guard job runs on the self-hosted `macbook-runner`, like every deployment workflow. If Ming prefers a GitHub-hosted runner, it is a one-line change, and the portable checker runs there too. Until the runner is back online, the check queues like `volume-safety`.
- **First run:** under `pull_request_target`, the job does not run on the PR that introduces it, because the workflow is not on `main` yet. AC 12 covers that PR by running the checker by hand.
- **Merge ref:** a PR with conflicts has no `refs/pull/<n>/merge`, so the check fails. Such a PR cannot be merged anyway.
- **Coupling:** the "known lines" allow-list ties the checker to today's wording of 5 workflow lines. Editing those lines means editing the checker in the same stoktok PR, which is intended.
- **Size:** about 230 lines move from `check-deploy-env.sh` to the checker, plus about 380 new lines (checker rules ~110, test ~170, workflow ~20, guards ~40, docs/README/todo ~40). That is over the ~400 guide only because of the mechanical move. The implementer commits the move first (B0 green), so the reviewer can diff it separately.
- **macOS CI:** the stoktok repo may run a `macos-latest` job (a few seconds per PR, read-only).
- **Hotspots:** no other open ticket (STK-095, STK-098 BACKLOG) edits these files. The local `/home/user/deployment` may be stale; step 7 fetches first.
- **Deployment PR:** opening it follows the STK-093 precedent (the orchestrator note says so). It is not a `release/*` branch, so `pr-scope` does not restrict it; CODEOWNERS covers `/.github/` and `/ops/`.

## Blocking questions
None.

## Split proposal
The ticket bundles workflow-side and compose-side guards. Together they are well over one cycle. Two slices:
- **Slice 1, STK-097 (this plan):**
  - the workflow checker and its deployment-side job (🟡2)
  - 🟡7, 🟡8, 🟡9, 🟡10, the xtrace gaps and the `release.env` nit
  - STK-094 🟡2 (fail-closed migrate detection) and the header fix, in the draft and the live workflow
  - the STK-094 🟡10 doc nits (step 6, stage 0.3 fallback, ming-todo line 39)
- **Slice 2, STK-099 (new ticket, to be created by the orchestrator):** the compose draft and the compose part of `check-deploy-env.sh`:
  - STK-094 🟡9: fail on `^(---|\.\.\.)`; top-level keys only `name`/`services`/`networks` (blocks `x-*` and `include:`); exactly one `migrate` key line; `svc_block` starts only after `^services:$`. Mutation proofs for the `x-` decoy, the block-scalar decoy, the second document and `include:`.
  - Allow-lists for the `stoktok-web` and `stoktok-worker` blocks; the worker `profiles: [jobs]` pin (STK-094 review nit 2); exact (not "contains") network lists.
  - 🟡6: "no internet egress" wording in the compose comments and docs. Also `read_only: true` on `migrate` if the migrate runner writes nothing, with `--read-only` parity on the `docker run … migrate` in `scripts/db-migrate-from-supabase.sh`, so `test:move` and stage 1 exercise it.

  Because slice 2 changes the cutover compose, it must also land before the v0.3.0 cut if Ming wants it in that release.

**Follow-ups (R7, not in either slice):**
- the optional worker-image `/app/migrations` refusal (STK-094 🟡2b)
- xtrace via `SHELLOPTS`/`BASH_ENV` step env
- an optional runtime self-check step in `deploy-stoktok`

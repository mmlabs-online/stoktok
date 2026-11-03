Status: READY

# Plan — STK-043: Deploy secrets from the deployment repo's GitHub Secrets

## Spec summary
- docs/spec-v1.md §7 (line 205): "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo."
- CLAUDE.md R3: "Service role key is server-only. Used by Next.js server code and `apps/worker` only. Never in `NEXT_PUBLIC_*`, never in client bundles."
- Ticket notes: Ming chose GitHub Secrets of `mmlabs-online/deployment` over a hand-made file on the Mac (2026-11-03). The service role key pasted into chat on 2026-11-01 must be rotated, and only the new key goes into the secret.
- STK-037 security review, open 🟡4: "`workflow_dispatch` still has no `if: github.ref == 'refs/heads/main'` guard" (`work/tickets/STK-037/security-review.md:126-129`), and 🟢 B: one-time setup step 3 is glued onto step 2 (`:116-118`).

No product code or `packages/core` logic changes. Every change is in drafts, docs and the deploy check script.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from GitHub Actions secrets of `mmlabs-online/deployment`, in an environment (e.g. `stoktok`) restricted to `main`; the deploy job uses that environment. | Draft `deploy-stoktok.yml`: the `deploy` job has `environment: stoktok`. The only `${{ secrets.SUPABASE_* }}` references are in the step-level `env:` of the `secrets` step. `docs/deploy.md` "Deployment repo: environment `stoktok`" gives the setup (deployment branches: selected, `main` only; the two secrets; no repo-level secrets with the same names; no required reviewers) and says to do it **before** merging the PR. It also documents the plan fallback (see Assumptions A1). `pnpm check:deploy-env` checks for the `environment: stoktok` line. Creating the environment itself is Ming's manual step, confirmed in the PR checklist. |
| 2 | `deploy-stoktok.yml` writes the env file outside the checkout (mode 600, owned by the runner user) on every deploy and before any rollback redeploy. Values are never printed (no `set -x`, no `docker compose config` without `--quiet`, no echo). | Read the `secrets` step. It writes `$ENV_FILE` (`/Users/gh-runner/.config/stoktok/stoktok.env`, unchanged) with `umask 077`, a temp file in the same dir and `mv -f`, then `stat -f '%Su %Lp'` = `$(id -un) 600`. It runs before `deploy`, so the file from this run is there before any rollback. `rollback` re-checks the file (exists, owner, mode 600) before `git restore`. It uses builtins only for values: `printf` plus redirect, `[[ =~ ]]`; no heredoc; values never appear in argv or output. `pnpm check:deploy-env` fails on `set -x`, on a `config` call without `--quiet`, or on `secrets.` outside an `env:` mapping line. |
| 3 | Fail-safe: if either secret is empty, nothing is started and the run names the missing secret. | The `secrets` step builds a list of missing names and exits 1 with `::error::Missing secret(s) in environment stoktok: <names>…` before any write. `deploy` has no `failure()` condition, so it is skipped, and `rollback` (`steps.deploy.outcome == 'failure'`) does not run. `notify` prints a dedicated "secrets missing or invalid" message instead of `did-not-complete`. A malformed value (charset or URL check fails) also stops with the secret's name only. The old env file stays in place. |
| 4 | `workflow_dispatch` runs only from `main` (`if: github.ref == 'refs/heads/main'` on the deploy job); this closes STK-037 🟡4. | The `deploy` job has `if: github.ref == 'refs/heads/main'`. The header comment no longer claims more than the code does. `pnpm check:deploy-env` checks for the line. |
| 5 | Drafts, `docs/deploy.md` (one-time setup, rotation) and `check-deploy-env` are updated, and the matching PR is opened on `mmlabs-online/deployment`. The runbook states that deployment `main` must be protected (PR required, no admin bypass). | Diff of the files below. `docs/deploy.md` has: a precondition on `main` protection; one-time setup without the hand-made file step, with step 3 on its own line; a "Rotate the Supabase key" section; D4 rewritten as a description. `deploy/deployment-repo/README.md` no longer says secrets are hand-placed. The orchestrator opens the deployment PR from `deploy/deployment-repo/` using the PR body that the implementer records in `impl-log.md`. The PR exists (link in the ticket). |
| 6 | `typecheck`, `lint`, `test` and the deploy checks pass. | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:deploy-env` are green. Negative checks: copy the repo to a scratch dir (the script derives `ROOT` from its own path), break one rule at a time in the copy (drop `environment: stoktok`, add `set -x`, remove `--quiet`, put `${{ secrets.X }}` in a `run:` line, change `ENV_FILE`), and check that each makes `bash scripts/check-deploy-env.sh` exit 1. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | Add `environment: stoktok` and `if: github.ref == 'refs/heads/main'` on `deploy` job. Remove the env-file check from `release` (lines 76-81). New `secrets` step after `release`. `deploy` uses `--force-recreate` when secrets changed. `rollback` re-checks the file first. New `notify` case. Fix the header comment. | AC1–AC4 |
| `deploy/deployment-repo/apps/stoktok/compose.yml` | Comment only (lines 14-17): the file is written by `deploy-stoktok` from the `stoktok` environment secrets. No functional change; `env_file` paths stay as they are. | AC5. The comment would otherwise be wrong. Side effect: merging triggers a `deploy-stoktok` push run, which helps verify the setup (see Approach 7). |
| `deploy/deployment-repo/README.md` | Line 23: secrets come from the `stoktok` environment, and the workflow writes the host file. Point to `docs/deploy.md` for the order (environment before merge). | AC5 |
| `docs/deploy.md` | D4 as a description. New "Deployment repo: environment `stoktok`" subsection (setup + Free-plan fallback). New precondition "deployment `main` protected". One-time setup: delete manual step 2, renumber, fix glued step. New "Rotate the Supabase key" section. Roll back: `workflow_dispatch` from `main` only. Env list intro: values live in the environment secrets, and the workflow writes the host file. | AC1, AC5 |
| `scripts/check-deploy-env.sh` | New checks on the draft workflow (listed in Tests). | AC5, AC6 |

No other files. CODEOWNERS (deployment repo) is not touched; see follow-ups.

## Tests to write
No `packages/core` logic changes, so no Vitest tests (R8 is met by the existing suite staying green). The deploy guard is `scripts/check-deploy-env.sh`, run in CI (`.github/workflows/ci.yml:47`). New checks, each printing `FAIL: …` and setting `fail=1`:

| Test (file › name) | Covers |
|---|---|
| `check-deploy-env.sh` › workflow has `environment: stoktok` | AC1 |
| `check-deploy-env.sh` › workflow has `if: github.ref == 'refs/heads/main'` | AC4 |
| `check-deploy-env.sh` › every line containing `secrets.` matches `^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$` (env mapping only, never in `run:`) | AC2 (no secret expansion in script bodies) |
| `check-deploy-env.sh` › no `set -x` / `set -o xtrace` in the workflow | AC2 |
| `check-deploy-env.sh` › every line in the workflow matching `" config` (compose `config` call) also contains `--quiet` | AC2 |
| `check-deploy-env.sh` › the `ENV_FILE:` value in the workflow equals both `env_file:` values in compose | AC2, keeps paths in sync |
| `check-deploy-env.sh` › the env-file writer (`printf 'SUPABASE_URL=`) is in the workflow, and no file under `deploy/deployment-repo/apps/stoktok/` contains `SUPABASE_SERVICE_ROLE_KEY=` | Consult F4 (rollback restore must not swap the writer) |
| `check-deploy-env.sh` › no `<<` heredoc inside the `secrets` step (simple check: the workflow has no `<<`) | AC2 (bash 3.2 writes heredocs to `$TMPDIR`) |
| Existing checks unchanged and green | AC6 |

## Approach
1. **`deploy` job header** (draft workflow):
   ```yaml
   deploy:
     if: github.ref == 'refs/heads/main'
     environment: stoktok
     runs-on: [self-hosted, macbook-runner]
   ```
   Rewrite header comment line 9: "workflow_dispatch from main redeploys what main pins and rewrites the env file from the `stoktok` environment secrets (e.g. after a rotation). Runs from any other branch are skipped." Add one line: secrets come from the `stoktok` environment (main only), and the `secrets` step writes `$ENV_FILE`.
2. **`release` step:** delete the env-file check (lines 76-81), because the file is now written after this step (consult F3). Nothing else changes.
3. **New `secrets` step** (`id: secrets`), placed between `release` and `deploy`, with `if: steps.release.outcome == 'success'`. It also runs on `skip=true`, so a run before the first release still checks and writes the file (A4). Secrets go **only** in step-level `env:`:
   ```yaml
   env:
     SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
     SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
   ```
   For the body, use the consult's sketch (consult Rec 3) as written: `umask 077`; missing-name list → `::error::` + exit 1; `[[ =~ ]]` checks (`^https://[A-Za-z0-9.-]+$`, `^[A-Za-z0-9._-]+$`) with names only in the messages; `mkdir -p` + `chmod 700` on the dir; `mktemp` in the same dir with an EXIT trap that removes it; `printf … > "$tmp"`; `chmod 600`; `cmp -s` → `changed`; `mv -f`; BSD `stat -f '%Su %Lp'` check; `echo "changed=$changed" >> "$GITHUB_OUTPUT"`. Also write `ok=true` to the output on success. No heredoc, no `set -x`, no echo of values, no `.old` copies.
4. **`deploy` step:** condition unchanged (`steps.release.outputs.skip != 'true'`). It runs only if `secrets` succeeded, because there is no `failure()`/`always()`. Add `CHANGED: ${{ steps.secrets.outputs.changed }}` to step env. If it is `true`, append `--force-recreate` to `up -d --wait --wait-timeout 120` (consult Rec 5: deterministic restart of web after a rotation). `config --quiet` stays.
5. **`rollback` step:** at the very start, before `git restore`, check the file: `[ -f "$ENV_FILE" ]` and `stat -f '%Su %Lp'` = `$(id -un) 600`. Otherwise `::error::`, `result=env-missing`, exit 1. No second write (consult F5: `deploy` only runs after this run's `secrets` succeeded).
6. **`notify` step:** add `SECRETS: ${{ steps.secrets.outcome }}` and a case checked before the others. If `SECRETS` = `failure`, the message is: "secrets missing or invalid in environment `stoktok`: nothing was started; see the run for the secret name." Add an `env-missing` case for rollback. The rest is unchanged.
7. **Docs (`docs/deploy.md`):**
   - **Preconditions:** add "Deployment `main` is protected: PR required, code-owner review, `pr-scope` required, no admin bypass. The `stoktok` secrets reach a job on the self-hosted runner, so this protection is what stands between a push and the key." Note the side effect: without a `github-actions` bypass, an automatic rollback ends in `restore-unpushed` (the server is restored, the run is red, and Ming reverts the release PR by hand). That is accepted (A3).
   - **Rewrite D4:** "written by `deploy-stoktok` on every run from the `stoktok` environment secrets; mode 600, owner `gh-runner`, outside the checkout. Do not edit it by hand: the next deploy overwrites it."
   - **New subsection "Deployment repo: environment `stoktok`":** the setup from consult Rec 1, the ordering rule (create it **before** merging the PR), and the Free-plan fallback (A1).
   - **One-time setup:** remove the hand-made file step. Step 1 becomes "create the `stoktok` environment and secrets (new, rotated key only), then merge the setup PR". Merging runs `deploy-stoktok` because `compose.yml` changed under `apps/stoktok/`. With no `release.env`, it skips the deploy but still writes the file. Check: the run is green, and `sudo ls -l /Users/gh-runner/.config/stoktok/stoktok.env` shows `-rw------- gh-runner`. Put the logs-dir step on its own line (STK-037 🟢 B).
   - **New "Rotate the Supabase key":** consult Rec 6, steps 1–6 in that order (create the new key, update the environment secret, `workflow_dispatch` from `main`, check that web was recreated via `docker compose -p stoktok ps` start time, run `run-job.sh eod-prices --dry-run`, only then revoke the old key). Add a note on legacy JWT `service_role` vs `sb_secret_…` keys (A2). State that the key pasted on 2026-11-01 must be revoked, not only replaced.
   - **Roll back / Manual:** `workflow_dispatch` from `main` only.
   - **Env list intro:** "Values live in the `stoktok` environment secrets of the deployment repo; `deploy-stoktok` writes the host env file."
8. **Deployment PR body:** the implementer records it in `impl-log.md`, and the orchestrator uses it. It contains this checklist for Ming:
   - [ ] org plan supports environments on this private repo (Settings → Environments is available with deployment branch rules). If not, use fallback A1 before merging.
   - [ ] environment `stoktok` created: branch rule `main` only, both secrets set, no repo-level secrets with the same names;
   - [ ] the Supabase key in the secret is the **new** key (the old one gets revoked after the first green dry-run);
   - [ ] `main` protected, no admin bypass;
   - [ ] after merge: the run is green and the file mode is checked.

Rules:
- **R3:** the key lives only in GitHub Secrets and the 600 host file. It is never in the stoktok repo, never in argv or logs, and never in `NEXT_PUBLIC_*`.
- **R7:** only the files listed above change.
- **R8:** CI checks plus `check:deploy-env`.
- **R6:** suspended, so no auth work.
- **R5, R9, R10:** not affected.

## Specialist input used
`consult-software-architect.md`:
- F1, F2, F3 (move the check after the write), F4 (writer inline in the workflow, not under `apps/stoktok/`), F5 (rollback only re-checks, no second write), F8 (atomic rename): adopted as written.
- F6 (a bad key still passes `/healthz`): adopted as rotation step 5, the dry-run.
- F7 (the `if:` guard is not a control on its own; the environment branch rule is): adopted. The docs and the fallback say so plainly.
- Rec 1 (environment, no required reviewers, set up before merge): adopted.
- Rec 2 (`if:` guard + header comment fix): adopted.
- Rec 3 (`secrets` step sketch): adopted. One change: the step runs on `skip=true` as well, so the setup can be checked before the first release (A4).
- Rec 4 (fail-safe, notify case, rollback re-check): adopted.
- Rec 5 (`--force-recreate` when changed): adopted, not left as optional, because it removes the uncertainty in F9.
- Rec 6 (rotation runbook, D4, preconditions, README): adopted.
- Rec 7 (check-deploy-env checks): adopted, plus a no-heredoc check.
- Open questions 1–5: resolved as defaults A1–A5. None blocks.

## Assumptions
- **A1 — GitHub plan (consult Q1, not blocking).** The orchestrator reports the deployment repo is private, and the org plan is unknown. On a private repo, environment secrets and deployment branch rules need a paid plan. This does not block, for three reasons. The implementer's work (drafts, docs, checks) is the same either way. The plan is only visible to Ming in Settings, so he confirms it in the PR checklist. And the fallback adds no new attack path compared to today: per consult F7, anyone with write access can already read the host file through a runner job. The draft uses `environment: stoktok` (AC1 as written). **Documented fallback** if environments are not available: store `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` as repo-level Actions secrets, and remove the `environment: stoktok` line in the deployment PR before merging (a one-line commit on that PR). The `if: github.ref == 'refs/heads/main'` guard, the fail-safe and the `main` protection stay. Weakness, stated in the docs: any workflow on any branch can read repo-level secrets. If the fallback is used, the reviewer and orchestrator record a follow-up ("restore `environment: stoktok` when the plan allows; stoktok draft diverges by one line"), and AC1 is marked met-by-fallback with Ming's confirmation in the PR.
- **A2 — Key type (consult Q2).** The runbook covers both. For `sb_secret_…` keys: create the new key, deploy, verify, revoke the old one. For the legacy JWT `service_role` key: rotating means rotating the JWT secret. That kills the old key at once and also invalidates the anon key (stoktok does not use it: `SUPABASE_ANON_KEY` is reserved) and sessions (none, R6 suspended). So: update the secret right after rotating, then redeploy. Mark it "verify in the Supabase dashboard". Both formats pass the charset check.
- **A3 — `main` protection and the rollback push (consult Q4).** The runbook states protection as a precondition (AC5). The default is no `github-actions` bypass. An automatic rollback then ends in `restore-unpushed`, which the workflow already reports. Ming reverts the release PR by hand. Whether to allow a bypass goes to follow-ups.
- **A4 — The `secrets` step runs even when `release.env` is missing (skip).** It writes the file, so the one-time setup can be checked on the setup PR's own merge run. On skip runs `notify` stays silent (unchanged), and a failure shows only as a red run.
- **A5 — Required reviewers (consult Q3):** none. Runner group (consult Q5): out of scope, follow-up.
- **A6 —** `SUPABASE_URL` has no trailing slash or path (`https://<ref>.supabase.co`). The check rejects anything else, naming the secret.
- **A7 —** The runner's shell is macOS `/bin/bash` 3.2. `[[ =~ ]]`, `printf` and BSD `stat -f` are all available there. Do not use GNU-only flags.

Follow-ups (not in this diff):
- CODEOWNERS header in the deployment repo still says DRAFT.
- Runner group limited to deploy workflows on `main`.
- Optional `github-actions` bypass for the rollback push.
- STK-037 🟡2/3/5 (tag ruleset, `release` environment in stoktok, SHA-pinning actions).
- Time Machine exclusion for `/Users/gh-runner/.config`.

## Blocking questions
None.

## Split proposal
None. About 150 changed lines across the workflow, check script and docs.

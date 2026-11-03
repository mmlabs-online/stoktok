Verdict: PASS
## Attempt 1 — 2026-11-03

### Checks (run by reviewer)
- typecheck: green (apps/web, apps/worker: Done)
- lint: green (apps/web, apps/worker eslint: Done)
- test: core 494/494, db 117 passed + 1 todo, worker 174/174, web 214/214. Matches impl-log.
- check:deploy-env: `OK: deploy env lists consistent`
- check:service-key: `OK: no service key material in client bundle`
- Negative checks (fresh scratch copies of `git ls-files`, one break each): baseline exit 0. Removing `environment: stoktok`, adding `set -x`, dropping `--quiet`, `${{ secrets.FOO }}` in a `run:` line, changing `ENV_FILE`, dropping the main guard, adding a heredoc, and adding `SUPABASE_SERVICE_ROLE_KEY=` under `apps/stoktok/` each exit 1.
- Baseline: `/home/user/deployment/.github/workflows/deploy-stoktok.yml` is identical to the origin/main draft, so the diff applies cleanly to the deployed file.

### Acceptance criteria
- [x] Secrets come from the `stoktok` environment, restricted to `main`, and the deploy job uses it. Evidence: `deploy-stoktok.yml:40` `environment: stoktok`. The only `secrets.*` refs are in the step env at `:99-100`, and the check script enforces that. `docs/deploy.md` "Deployment repo: environment `stoktok`" covers the branch rule (`main` only), the two secrets, no repo-level duplicates, creating it before merge, and the Free-plan fallback. Creating the environment is Ming's manual step and is in the PR checklist.
- [x] The env file is written outside the checkout (mode 600, owned by the runner user) on every deploy and before any rollback, and values are never printed. Evidence: `secrets` step `:95-136`. It uses `umask 077`, `mktemp` in the target dir, `printf` builtin to the temp file, `chmod 600`, `mv -f`, then a `stat -f '%Su %Lp'` check against `$(id -un) 600`. The step runs before `deploy`. `rollback` re-checks the file at `:169-173`. There is no echo of values, no `set -x`, no heredoc, and `config --quiet` is kept at `:146`.
- [x] Fail-safe. Evidence: `:104-118` builds the list of missing names and exits 1 before any write. `deploy`/`publish` have no `always()`/`failure()`, so they are skipped. `rollback` requires `steps.deploy.outcome == 'failure'`, so it does not run. `notify` reports `secrets:invalid` (`:217-222`). Malformed values name only the secret.
- [x] `workflow_dispatch` runs only from main. Evidence: `:39` `if: github.ref == 'refs/heads/main'`, the header comment at `:9-12`, and the check script line for the guard.
- [x] Drafts, docs and check script are updated, and the runbook states the main-protection precondition. Evidence: `docs/deploy.md` D4 rewritten, D5 (PR required, code-owner review, `pr-scope`, no admin bypass), one-time setup renumbered with the glued step fixed, "Rotate the Supabase key" (rotate, update secret, `workflow_dispatch` from main, verify, dry-run, revoke), and Roll back updated. README and compose comment updated. The deployment PR body and checklist are in impl-log.md. Per plan, the orchestrator opens that PR after this review and records the link in the ticket.
- [x] typecheck, lint, test and deploy checks pass (see above).

### Issues
None.

### Rules R1–R10
No violations found. R3: the key lives only in environment secrets and the 600 host file. It is never in argv (only the `printf` builtin touches it), logs, the repo, or `NEXT_PUBLIC_*`. R6 is suspended and not applicable. R7: every changed file is in the plan's list (plus the ticket workflow files).

### Nits (do not block)
- `docs/deploy.md` "One-time setup" step 1 says "Ming merges the deployment-repo setup PR". The STK-037 setup PR (#16) is already merged. For this rollout the PR that matters is the STK-043 deployment PR, which also triggers the run (compose.yml comment change). The checklist in the PR body covers this.
- The `secrets` step's `if: steps.release.outcome == 'success'` is redundant with the implicit `success()`. It is harmless.
- On skip runs (no `release.env`), a secrets failure only shows as a red run, because `notify` is silent. This is accepted as plan A4.

### Follow-ups (out of scope)
- Plan follow-ups stand: CODEOWNERS DRAFT header, a runner group limited to deploy workflows on main, an optional `github-actions` bypass for the rollback push, STK-037 🟡2/3/5, and a Time Machine exclusion for `/Users/gh-runner/.config`.
- If the Free-plan fallback is used, record "restore `environment: stoktok`; the draft diverges by one line".
- The orchestrator must open the deployment PR (AC5) and link it in ticket.md before marking DONE.

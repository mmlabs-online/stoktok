## Attempt 1 — 2026-11-03

### Files touched
| File | Required because |
|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | AC1-AC4: `if` main guard and `environment: stoktok` on `deploy`; env-file check removed from `release`; new `secrets` step (atomic 600 write, name-only errors); `--force-recreate` when changed; `rollback` re-checks the file; `notify` cases `secrets:invalid` and `env-missing`; header comment fixed |
| `deploy/deployment-repo/apps/stoktok/compose.yml` | AC5: comment only, the file is written by deploy-stoktok |
| `deploy/deployment-repo/README.md` | AC5: secrets no longer hand-placed |
| `docs/deploy.md` | AC1, AC5: D4 rewritten, D5 main protection, environment section with Free-plan fallback, one-time setup renumbered, "Rotate the Supabase key", roll back and env-list wording |
| `scripts/check-deploy-env.sh` | AC5, AC6: new workflow checks |

### Tests added / changed
- `scripts/check-deploy-env.sh` › environment line, main guard, `secrets.` only in env mapping, no `set -x`, `config` has `--quiet`, no heredoc, ENV_FILE equals compose `env_file`, writer in workflow and not under `apps/stoktok/`.
- Negative checks in a scratch copy (each exits 1): drop `environment: stoktok`, add `set -x`, remove `--quiet`, `${{ secrets.X }}` in a `run:` line, change `ENV_FILE`, drop the main guard.

### Checks (actual output summary)
- typecheck: green (web, worker)
- lint: green
- test: core 494, db 117 (+1 todo), worker 174, web 214 passed
- check:service-key: OK
- check:deploy-env: OK

### Out-of-plan files
None. `/home/user/deployment` was not modified and no .env file was read.

### Follow-ups (noticed, not done)
- Plan follow-ups stand (CODEOWNERS header, runner group, `github-actions` bypass, STK-037 yellow 2/3/5, Time Machine exclusion).
- The check regex for `secrets.` ignores `steps.secrets.` references on purpose; keep comments free of "secrets." followed by a space.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +150 / -15 lines.

### Deployment PR body (mmlabs-online/deployment)
Title: `stoktok: deploy secrets from the stoktok environment (STK-043)`

Copy `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` and `apps/stoktok/compose.yml` (comment only) from the stoktok repo drafts.

What changes
- `deploy` job runs only on `refs/heads/main` and uses environment `stoktok`.
- New `secrets` step writes `/Users/gh-runner/.config/stoktok/stoktok.env` (mode 600, atomic rename) from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Empty or malformed secret: the run stops, names the secret, starts nothing, keeps the old file.
- `deploy` uses `--force-recreate` when the file changed. `rollback` re-checks the file first. `notify` reports missing secrets.
- Closes the STK-037 `workflow_dispatch` follow-up.

Checklist for Ming (do before merging)
- [ ] The org plan supports environments on this private repo (Settings, Environments, deployment branch rules). If not, use the fallback in `docs/deploy.md` (repo-level secrets, remove the `environment: stoktok` line in this PR).
- [ ] Environment `stoktok` created: branch rule `main` only, both secrets set, no repo-level secrets with the same names.
- [ ] The Supabase key in the secret is the NEW key. The old one (pasted in chat 2026-11-01) is revoked after the first green dry-run.
- [ ] `main` is protected, no admin bypass.
- [ ] After merge: the run is green and `sudo ls -l /Users/gh-runner/.config/stoktok/stoktok.env` shows `-rw------- gh-runner`.

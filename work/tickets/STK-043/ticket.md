# STK-043: Deploy secrets from the deployment repo's GitHub Secrets

| Field | Value |
|---|---|
| State | DONE |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 1 |
| Created | 2026-11-03 |
| PR | https://github.com/mmlabs-online/stoktok/pull/29 (deployment: https://github.com/mmlabs-online/deployment/pull/17) |

## Goal
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are stored as GitHub Actions secrets of `mmlabs-online/deployment`, and `deploy-stoktok` writes the runner-side env file on each deploy, so Ming no longer creates or edits it by hand on the Mac and rotation is "update the secret, redeploy".

## Spec reference
docs/spec-v1.md §7 Deployment ("Secrets … only in the deploy repo's env handling, never in the app repo"). CLAUDE.md R3. STK-037 (release pipeline, drafts in `deploy/deployment-repo/`) and its security review.

## Acceptance criteria
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from GitHub Actions secrets of `mmlabs-online/deployment`, in an environment (e.g. `stoktok`) restricted to `main`; the deploy job uses that environment.
- [ ] `deploy-stoktok.yml` writes the env file outside the checkout (mode 600, owned by the runner user) on every deploy and before any rollback redeploy. The values are never printed (no `set -x`, no `docker compose config` without `--quiet`, no echo).
- [ ] The deploy fails safe: if either secret is empty, nothing is started and the run says which secret name is missing.
- [ ] `workflow_dispatch` runs only from `main` (the deploy job has `if: github.ref == 'refs/heads/main'`); this closes the STK-037 security follow-up.
- [ ] Drafts in `deploy/deployment-repo/`, `docs/deploy.md` (one-time setup, rotation: rotate in Supabase, update the secret, redeploy with `workflow_dispatch`) and `check-deploy-env` if affected are updated, and the matching PR is opened on `mmlabs-online/deployment`. The runbook states the precondition that deployment `main` is protected (PR required, no admin bypass), because the secret reaches a self-hosted runner job.
- [ ] `typecheck`, `lint`, `test` and the deploy checks pass.

## Notes / answers from Ming
- 2026-11-03: Ming chose GitHub Secrets of the deployment repo over a hand-made file on the Mac (after comparing with calechip, which bakes only public `VITE_*` values into its image and needs no runtime secret).
- The service role key was pasted into a chat on 2026-11-01; rotate it and store only the new key as the secret.
- Depends on: STK-037.

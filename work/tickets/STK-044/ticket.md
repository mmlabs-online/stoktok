# STK-044: Run deploy and worker jobs as the runner's real user (mingming)

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 0 |
| Created | 2026-11-03 |
| PR | — |

## Goal
The self-hosted runner `macbook-runner` runs as macOS user `mingming` (`/Users/mingming/actions-runner`), not `gh-runner`. Make every deploy path, the launchd schedule and the runbook use the runner's real user so `deploy-stoktok` can write the env file and deploy.

## Spec reference
docs/spec-v1.md §7 Deployment. CLAUDE.md R3. STK-037, STK-043 (drafts in `deploy/deployment-repo/`).

## Acceptance criteria
- [ ] No `gh-runner` user or `/Users/gh-runner` path remains in the drafts (`deploy/deployment-repo/`), `docs/deploy.md` or ADR 0003; paths for the env file, the scheduler directory and logs live under the runner user's home (`/Users/mingming/...`), with a single source per path where the tools allow it.
- [ ] `deploy-stoktok.yml` writes the env file (still mode 600, owned by the runner user, outside the checkout) and the owner check compares against the runner user, not a hard-coded name. `compose.yml` `env_file` matches the workflow path.
- [ ] The launchd job runs as `mingming` and reads the same scheduler directory the workflow publishes; runbook commands drop `sudo -u gh-runner` and use the runner user.
- [ ] `scripts/check-deploy-env.sh` still passes and guards the workflow/compose path agreement; it fails if `gh-runner` reappears in the drafts.
- [ ] The matching PR on `mmlabs-online/deployment` is opened. `typecheck`, `lint`, `test` and the deploy checks pass.

## Notes / answers from Ming
- 2026-11-03: deploy run 41567381736 (merge of deployment#17) failed at the `secrets` step with `mkdir: /Users/gh-runner: Permission denied`. The log shows the runner at `/Users/mingming/actions-runner`. Nothing was started; secrets were masked.
- 2026-11-03: Ming chose to keep the runner under `mingming` (not create a `gh-runner` user).
- Depends on: STK-037, STK-043.

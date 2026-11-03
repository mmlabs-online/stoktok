# STK-045: Self-install the Mac-side setup from deploy-stoktok

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 1 |
| Created | 2026-11-03 |
| PR | — |

## Goal
Ming cannot reach the Mac runner. `deploy-stoktok` performs the one-time, no-sudo Mac setup itself on every run (idempotently), so stoktok deploys and its worker schedule work without anyone logging in to the Mac.

## Spec reference
docs/spec-v1.md §7 Deployment. CLAUDE.md R3. STK-043, STK-044 (drafts in `deploy/deployment-repo/`, runbook `docs/deploy.md`).

## Acceptance criteria
- [ ] Before the env file is written, the workflow ensures `~/.config/stoktok` exists (mode 700) and is excluded from Time Machine (`tmutil addexclusion`, verified with `tmutil isexcluded`); a failure to exclude is reported clearly. Nothing uses `sudo`.
- [ ] After a successful publish, the workflow installs or updates the stoktok LaunchAgent in `~/Library/LaunchAgents` from the published plist and (re)loads it with `launchctl bootstrap gui/$(id -u)` only when it is new or changed; it verifies the job is loaded with `launchctl print`. Re-runs with no change are no-ops.
- [ ] The workflow reports, read-only, whether OrbStack/docker is reachable and whether an old LaunchDaemon plist exists in `/Library/LaunchDaemons`; it does not modify system settings (FileVault, auto-login, login items) or anything needing root.
- [ ] Secret handling from STK-043/044 is unchanged (no values printed; env file mode 600, owned by the runner user).
- [ ] `docs/deploy.md` moves these steps from "manual one-time setup" to "done by the workflow", and lists what still needs Ming at the Mac. `scripts/check-deploy-env.sh` keeps passing and guards the new steps (no `sudo`, plist path agreement).
- [ ] The deployment-repo PR is updated. `typecheck`, `lint`, `test` and the deploy checks pass.

## Notes / answers from Ming
- 2026-11-03: Ming cannot access the Mac runner now and asked for the setup to self-install; Ming said "ok /run" to the proposal (env dir + Time Machine exclusion, LaunchAgent install, read-only checks; no sudo, no system settings).
- Builds on STK-044 (stoktok PR #30 and deployment PR #18, both still open); this work lands on the same branches.
- Depends on: STK-043, STK-044.

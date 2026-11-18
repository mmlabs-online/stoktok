# Drafts for mmlabs-online/deployment

These files mirror their target paths in the deployment repo. Copy them verbatim into a setup PR
on `mmlabs-online/deployment` (not a `release/*` branch, so `pr-scope` does not restrict it).

| Here | Goes to |
|---|---|
| `apps/stoktok/compose.yml` | `apps/stoktok/compose.yml` |
| `apps/stoktok/run-job.sh`, `run-schedule.sh` | `apps/stoktok/` (deploy-stoktok publishes them to `/Users/mingming/stoktok/current`) |
| `apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | `apps/stoktok/launchd/` (published to `$SCHED_DIR` and installed by deploy-stoktok) |
| `.github/workflows/deploy-stoktok.yml` | `.github/workflows/deploy-stoktok.yml` |
| `.github/workflows/runner-check.yml` | `.github/workflows/runner-check.yml` (shared by every app; STK-044 only changes the expected runner user to `mingming`) |
| `.github/workflows/stoktok-guards.yml` | `.github/workflows/stoktok-guards.yml` (STK-097: runs the checker on every pull request) |
| `ops/check-stoktok-workflow.sh` | `ops/check-stoktok-workflow.sh` (STK-097: the vendored guards for `deploy-stoktok.yml`) |

STK-084 (shared Postgres): STK-092 and STK-093 are merged. Until STK-097 lands in the deployment repo, the workflow draft equals the live file.
`apps/stoktok/compose.yml` is in its cutover state (STK-094: `migrate` service, `/readyz` health check). It
goes into the deployment repo **only** as a second commit on the release PR `release/stoktok-vX.Y.Z`,
copied from the release tag. Never copy it in a setup PR while v0.2.1 is pinned: v0.2.1 has no `migrate`
command and no `/readyz` (F3/F4). The workflow is not copied again. See `docs/deploy.md`, "Cutover release (STK-094)".

The `/apps/stoktok/` line in the deployment repo's `.github/CODEOWNERS` already exists; nothing to add.

`apps/stoktok/release.env` is not drafted: the stoktok release workflow writes it. Until it exists,
deploy-stoktok skips, so merging the setup PR deploys nothing.

No hostname or ingress rule belongs in either repo: cloudflared is remotely managed (Cloudflare
dashboard). The secrets come from the `stoktok` environment of the deployment repo; deploy-stoktok
writes `/Users/mingming/.config/stoktok/stoktok.env` on the Mac from them (R3). Create the
environment and its secrets before merging the setup PR: see `docs/deploy.md`.

## Workflow guards (STK-097)
`deploy-stoktok.yml` writes the database URL and the AI master key into the env file on the Mac, so a careless
edit could print them. The control:
- **What runs:** `ops/check-stoktok-workflow.sh <file>` (exit 0 = OK, 1 = FAIL, 2 = usage). It checks the secrets
  step (order, guards, one printf, one temp file, modes), a deny list of ways to print the env or the password
  (`set`, `env`, `cat`/`grep`/`sed`/... of the env file, `docker inspect -f` that dumps `Config.Env`, `compose
  convert`, `exec ... env`, `/proc/*/environ`, xtrace), the triggers (push on `main` and `workflow_dispatch` only),
  and the fail-closed migrate detection in `pull`.
- **Where and when:** `.github/workflows/stoktok-guards.yml` runs it on every pull request into `main`, on the
  self-hosted runner, against the merge result of `deploy-stoktok.yml` (`pull_request_target`: the workflow and the
  checker come from `main`; the pull request's file is only read; read-only token, no secrets, no environment).
  The same script runs in the stoktok repo's CI (`pnpm check:deploy-env`, with mutation proofs in
  `scripts/test-deploy-guards.sh`), on macOS `/bin/bash` 3.2 too.
- **Covers:** only `deploy-stoktok.yml`. The compose file is covered by the stoktok-side check and the stage 0.3
  `cmp` of the cutover runbook. Deleting `deploy-stoktok.yml` makes the check fail.
- **Tripwire, not a complete control:** the deny list catches accidental leaks, not a determined edit. The password
  file is readable by everyone with read access to the deployment repo.
- **Updating it:** edit the drafts in the stoktok repo (checker and workflow together), then copy them verbatim in
  a setup PR. The check is advisory until Ming makes `stoktok-guards / check` a required status check.

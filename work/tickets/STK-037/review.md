## Attempt 1 — 2026-10-30
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: pass (exit 0)
- lint: pass (exit 0)
- test: pass. core 429, db 110 + 1 todo, worker 94, web 202 (matches impl-log)
- `pnpm check:service-key`: OK. `pnpm check:deploy-env`: "OK: deploy env lists consistent"
- `release.yml`, `deploy-stoktok.yml` and `check-image.sh` were not executed (they need GitHub and Docker). Reviewed by reading them and diffing against `/home/user/deployment`.

### Acceptance criteria
- [ ] AC1 release.yml: the tag trigger, two build+push steps tagged `${{ github.ref_name }}`, verify-by-digest, a release.env with 3 keys, `git add` of that file only plus a staged-diff assertion, and branch `release/$APP-$TAG` are all correct. FAILED: the guard step cannot run on this private repo. See Issue 1.
- [x] AC2 `/healthz`: evidence is `apps/web/app/healthz/route.ts` (no imports) and `apps/web/test/healthz.test.ts` (5 tests pass in web's 202). No middleware exists in apps/web. Dockerfile sets `HOSTNAME=0.0.0.0` (apps/web/Dockerfile:23), so the 127.0.0.1 probe in check-image.sh works.
- [x] AC3 conventions: the draft compose has external `web`, images from release.env (`${STOKTOK_*_IMAGE:?}`), a node `/healthz` healthcheck, and no ports or container_name. This matches `apps/recordin/compose.yml` and `apps/calechip/compose.yml`. Docs and ADR name `macbook-runner` and launchd on the Mac. The plan's decision to delete `deploy/compose.stoktok.yml` in favour of one draft source is accepted.
- [x] AC4 drafts: `diff deploy-recordin.yml deploy-stoktok.yml` shows only the planned deltas (runner label `[self-hosted, macbook-runner]` as in runner-check.yml, two regexes, same-version check, env-file key check, `--profile jobs pull`, publish step). No `${SUPABASE_*}` appears and secrets sit in a host env_file (R3). Opening the deployment-repo PR is the orchestrator's step after DONE, per the plan.
- [x] AC5 runbook: covers secrets, tag push, release PR, merge, rollback, and Access app → hostname → verify (docs/deploy.md:44-50). No hostname appears in any file and no auth code was added. Usability gap: see Issue 2.
- [x] AC6 checks: all green (above).

### Issues
#### Issue 1 — 🔴 blocker — release workflow fails on the first tag
- **Where**: `.github/workflows/release.yml:36` and `:48`
- **Expected**: the "tag is on main" guard passes for a tag on main.
- **Actual**: `mmlabs-online/stoktok` is private (`gh api repos/mmlabs-online/stoktok --jq .private` → `true`; spec §7 says the same). With `persist-credentials: false`, actions/checkout removes the token after checkout. `git fetch --no-tags origin main` then has no credentials, fails ("could not read Username"), and `bash -e` stops the step. No release can ever be cut.
- **Fix instruction**: delete line 48 (`git fetch --no-tags origin main`). `fetch-depth: 0` already fetches `+refs/heads/*:refs/remotes/origin/*`, so `origin/main` exists for `git merge-base --is-ancestor` on line 49. Keep `persist-credentials: false`. Do not add the token back to git config.

#### Issue 2 — 🟡 should-fix — runbook commands run as the wrong user
- **Where**: `docs/deploy.md:31` (step 3), `:42` (step 7), `:43` (step 8), and the "Restart safety check" manual steps
- **Expected**: these commands work when Ming runs them from his own account on the Mac.
- **Actual**: OrbStack runs per user. The containers belong to `gh-runner`'s engine, the env file is mode 600 and owned by `gh-runner`, and the logs dir must be writable by `gh-runner`. Run from Ming's account, `docker compose -p stoktok ps/exec` sees nothing, `run-job.sh` can't read the env file, and `install -d` creates the logs dir with the wrong owner.
- **Fix instruction**: prefix these commands with `sudo -u gh-runner -H` (for example `sudo -u gh-runner -H /Users/gh-runner/stoktok/current/run-job.sh eod-prices --dry-run`). Use `sudo install -d -o gh-runner -m 755 /Users/gh-runner/stoktok/logs` in step 3, and say in step 2 that the env file is created with `-o gh-runner`. Docs only, no code change.

### Rules R1–R10
No violations found. R3: secrets only in the host env_file, the compose interpolation guard is in check-deploy-env.sh, check-image.sh keeps the image secret scan, and release.yml never echoes secrets. R6 suspended: no auth code added. Access-before-hostname ordering is documented. R7: every changed file is in the plan.

### Nits (do not block)
- `scripts/check-image.sh` is mode 100644, while the other scripts are mixed. It is invoked with `bash`, so this is harmless.
- `run-schedule.sh`: after a long sleep, the coalesced wake run after 21:00 skips `financials` that day. This matches the plan, but it is worth one line in the runbook.
- `deploy-stoktok.yml` publish step: if it fails between the two `mv`s, `current/` is missing until the next deploy. `notify` still says "deployed" (already in the impl-log follow-ups).

### Follow-ups (out of scope)
- Make a publish-step failure show in notify. Optionally add a post-deploy worker dry-run in deploy-stoktok.
- Spec §4.1 and the CLAUDE.md Runtime row still say WSL. The ticket Notes line "first release is private" is superseded by answer 1.
- The deployment repo commits the tunnel token and `apps/calechip/.env` (already flagged).

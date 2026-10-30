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

### Security blockers (added by orchestrator from security-review.md, attempt 1)
- 🔴 **Tunnel token gate missing from the runbook.** `mmlabs-online/deployment/proxy/compose.yml:11` commits the cloudflared tunnel token, and this release makes stoktok public. In-ticket fix (docs only, R7): add a hard gate in `docs/deploy.md` before the public-hostname step (step 10) — rotate the tunnel token and move it out of git into a host env file — and in step 10 turn on the hostname's Access JWT check ("Protect with Access"). The deployment-repo change itself is not part of this diff.

## Attempt 2 — 2026-10-30
Verdict: PASS

### Checks (run by reviewer)
- typecheck: pass (exit 0)
- lint: pass (exit 0)
- test: pass. core 429, db 110 + 1 todo, worker 94, web 202 (matches impl-log)
- `pnpm check:service-key`: "OK: no service key material in client bundle". `pnpm check:deploy-env`: "OK: deploy env lists consistent"
- Attempt-2 commit `fba2059` touches only `.github/workflows/release.yml`, `docs/deploy.md` and ticket/backlog files.

### Previous issues
- Issue 1 (🔴 release guard fetch): fixed. `release.yml:48` `git fetch --no-tags origin main` is removed. Checkout keeps `fetch-depth: 0` and `persist-credentials: false` (`release.yml:33-36`), so `origin/main` exists for `merge-base --is-ancestor` (`release.yml:48`). The token is not added back to git config.
- Issue 2 (🟡 runbook user): fixed. `docs/deploy.md` step 2 uses `sudo install -d -o gh-runner -m 700` and an env file owned by `gh-runner`, mode 600. Setup step 3 uses `sudo install -d -o gh-runner -m 755`. Cut steps 7 and 8, the Logs block and both restart-safety commands use `sudo -u gh-runner -H`. A grep for `docker`/`run-job` lines without the prefix finds only prose.
- Security blocker (🔴 tunnel token gate): fixed in docs. `docs/deploy.md:43` (step 9) is a HARD GATE: rotate the tunnel token and move it out of git into a host env file before any hostname, with "Do not continue until this is done". Step 11 (`:45`) turns on "Protect with Access" bound to the step-10 application. `:46` says not to reorder steps 9–11. The teardown order is kept (step 13). The deployment-repo change itself stays out of this diff, as the orchestrator asked.

### Acceptance criteria
- [x] AC1 release.yml: the tag trigger, guards (now runnable on a private repo), build and push of both images tagged with the version, digest verify, and a release PR that changes only `apps/stoktok/release.env`. Evidence: `release.yml`, with the attempt-1 review details unchanged apart from the fix above.
- [x] AC2 `/healthz`: `apps/web/app/healthz/route.ts`, plus `apps/web/test/healthz.test.ts` (passes as part of web's 202).
- [x] AC3 conventions: unchanged since attempt 1 (accepted then).
- [x] AC4 deployment-repo drafts: unchanged since attempt 1 (accepted then). Opening the PR is the orchestrator's step after DONE.
- [x] AC5 runbook: secrets, tag push, release PR, merge, rollback, then the token gate, the Access app, the hostname with the Access JWT check, and verification. No hostname is written (`<APP_HOSTNAME>` placeholder only) and no auth code is added.
- [x] AC6 checks: all green (above).

### Issues
None.

### Rules R1–R10
No violations found. R3: unchanged, and secrets stay in the host env file only. R6 is suspended and no auth code was added. R7: attempt 2 changes only the files that the review issues name.

### Nits (do not block)
- `docs/deploy.md:30`: setup steps 2 and 3 run together on one line (`…SUPABASE_SERVICE_ROLE_KEY=`.3. `sudo install -d …`). The command is still there, but rendered Markdown shows it inside step 2 and renumbers the later steps. Put a newline before `3.`.
- `docs/deploy.md:30`: `sudo install -o gh-runner -m 600` needs a source and a target. Example: `sudo install -o gh-runner -m 600 /dev/null /Users/gh-runner/.config/stoktok/stoktok.env`.
- Attempt-1 nits still apply (check-image.sh mode, the financials coalesce note, the publish-step gap).

### Follow-ups (out of scope)
- Optional security-review items: the `if: github.ref == 'refs/heads/main'` guard on the deploy-stoktok job, SHA-pinned actions, the tag ruleset and `release` environment, deployment `main` protection, and moving the job lock out of `/tmp`.
- The deployment-repo PR for the tunnel token rotation and moving it out of git. Step 9 of the runbook gates on it.
- The attempt-1 follow-ups still apply.

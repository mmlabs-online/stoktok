## Attempt 1 — 2026-11-03

### Files touched
| File | Required because |
|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | AC1-3: `AGENT_LABEL` and `PUBLISH_FILES` env; new `preflight`, `envdir`, `agent` steps; `secrets` gated on `envdir` (only the `if:` line changed, body untouched); `publish`/`rollback` copy `$PUBLISH_FILES`; `notify` extended; header comment |
| `deploy/deployment-repo/apps/stoktok/launchd/online.mmlabs.stoktok.jobs.plist` | Comment only: now installed by deploy-stoktok |
| `deploy/deployment-repo/README.md` | Plist row no longer says "installed by hand" |
| `scripts/check-deploy-env.sh` | New STK-045 guard block (AC5) |
| `docs/deploy.md` | "One-time setup" replaced by "Setup" with "Done by the workflow" and "Still needs Ming at the Mac"; D4 text updated |
| `work/tickets/STK-045/impl-log.md` | This log |

### Tests added / changed
`scripts/check-deploy-env.sh` (run by `pnpm check:deploy-env`) new guards: no sudo; no system-setting commands; plist label agreement (file stem = plist Label = `AGENT_LABEL` = docs old-daemon path); `PUBLISH_FILES` contains the plist and listed files exist (`release.env` excepted, it is written by the release workflow); publish and rollback both use `$PUBLISH_FILES` with no literal list; step order; steps using `secrets.` do no tmutil/launchctl/plutil/xattr; agent uses the gui domain only.

Mutation check (temporary edit, reverted, workflow restored byte-identical): each guard printed FAIL when broken: sudo added; `orb start`; `AGENT_LABEL` changed; plist removed from `PUBLISH_FILES`; literal `cp run-job.sh` in publish; step renamed/reordered (envdir, preflight); `# tmutil` comment added inside the secrets step; `launchctl bootstrap "system"`. (Fixed one gap found: a missing step made the script exit silently under `set -e`; now `|| true`, prints FAIL.)

### Checks (actual output summary)
- typecheck: pass
- lint: pass
- test: pass (core 494, db 117 + 1 todo, worker 174, web 214)
- check:service-key: OK
- check:deploy-env: OK: deploy env lists consistent
- workflow parses as YAML (python yaml). Not run on macOS: tmutil/launchctl/stat -f behavior is untested until the first real run.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- `rollback` still runs only on deploy failure; an `agent` failure does not roll back (default D3).
- Release PRs may change the plist under `apps/stoktok/` (allowed by `pr-scope`); code-owner review (D5) is the gate.

### Text to add to deployment PR #18's body
```
## STK-045: the workflow now does the Mac-side setup itself (no root)
- `preflight` (read-only, never fails): login session (expected Aqua), OrbStack socket, docker context/engine, and whether an old LaunchDaemon plist exists (warns if so).
- `envdir` (before `secrets`): creates `~/.config/stoktok` mode 700, checks owner/mode, `tmutil addexclusion` verified by `tmutil isexcluded` (xattr fallback). `secrets` runs only if it succeeded; its body is unchanged.
- `agent` (after publish/rollback): installs the plist from `$SCHED_DIR` (published together with compose/release.env/job scripts) into `~/Library/LaunchAgents`, `launchctl bootstrap gui/$(id -u)` only when new or changed, verified with `launchctl print`; a re-run prints "scheduler unchanged". Creates `~/stoktok/logs`.
- `notify` appends "Scheduler NOT installed" / "Env dir not excluded from Time Machine" when relevant.
- First setup merge has no `release.env`, so publish is skipped: the LaunchAgent is installed by the first release deploy.
- Untested on macOS; the first real run is the test.

Defaults to confirm:
- D1: Time Machine exclusion cannot be verified -> warning, run stays green (failing would block deploys Ming cannot fix remotely).
- D2: plist change while a job runs -> job is stopped and a warning is emitted (jobs are idempotent and restart-safe).
- D3: `agent` failure -> run red, no rollback of the healthy web deploy; PR comment says "Scheduler NOT installed".

Note: release PRs may modify the plist under `apps/stoktok/` (pr-scope allows it; run-job.sh/compose were already executed from there). Code-owner review (D5) is the gate.
Still needs Ming at the Mac: auto-login + OrbStack start-at-login, time zone and sleep, removing any old LaunchDaemon (needs root), FileVault + encrypted backup destination, optional newsyslog.
```

### Scope self-check
- Could the diff be smaller? No; the three steps, guards and docs are all listed in the plan.
- Diff size: about +185 / -11 lines tracked (plus this log).

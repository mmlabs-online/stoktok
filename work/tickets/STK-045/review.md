Verdict: PASS
## Attempt 1 — 2026-11-03

Scope reviewed: `git diff a2974b1..HEAD` (base = "STK-044: link PRs"). The deployment-repo clone (`stoktok/runner-user`, 493f46e) matches the drafts at the STK-044 base byte for byte. That confirms the base. It also shows that PR #18 does not have the STK-045 changes yet: the orchestrator pushes them after PASS, as the plan says.

### Checks (run by reviewer)
- typecheck: green (web, worker and packages all finished with no errors)
- lint: green
- test: green (core 494, db 117 + 1 todo, worker 174, web 214). These match impl-log.
- check:deploy-env: `OK: deploy env lists consistent`
- check:service-key: `OK: no service key material in client bundle`
- Guard mutation spot-check (scratch copy of HEAD, then reverted). Each mutation made its guard print FAIL:
  - adding `sudo` → `FAIL: sudo in workflow`
  - adding `tmutil` inside the `secrets` step → secrets-confinement FAIL
  - removing the plist from `PUBLISH_FILES` → FAIL
  - renaming `envdir` → step-order FAIL
  - adding `pmset` → system-setting FAIL
  - The unchanged copy printed OK.

### Acceptance criteria
- [x] AC1: env dir mode 700 and Time Machine exclusion run before the env file is written, with no sudo.
  - Evidence: `deploy-stoktok.yml:126-149` (`envdir` step). It runs `install -d -m 700` and `chmod 700`, then checks `stat -f '%Su %Lp'` = `<user> 700`. Next it runs `tmutil addexclusion`, verifies with `tmutil isexcluded` (looking for `[Excluded]`), falls back to `xattr` and checks again.
  - If the exclusion still fails, the step writes `::warning::`, a step-summary line and `tm=not-excluded`, and notify adds a suffix to the PR comment.
  - `secrets` is gated on `steps.envdir.outcome == 'success'` (`:155`).
  - A guard checks that no `sudo` appears and checks the step order.
- [x] AC2: the LaunchAgent is installed from the published plist and loaded with bootstrap only when new or changed, then verified with `launchctl print`. A no-change re-run does nothing.
  - Evidence: `:266-313` (`agent` step). It installs from `$SCHED_DIR` and checks the "unchanged" case (`cmp` equal, loaded, and loaded from `path = $dst`) before writing anything. Otherwise it runs `plutil -lint`, installs the plist (mode 644, tmp file then mv), runs `enable` if the job is disabled, then bootout with polling, then `bootstrap gui/$(id -u)` with one retry, then a final `launchctl print`.
  - The plist is published by both `publish` and `rollback` from one `PUBLISH_FILES` list (`:42`, `:215`, `:247`), and a guard enforces this.
- [x] AC3: read-only preflight, and no system settings changed.
  - Evidence: `:56-77`. The step uses `set +e`, every probe ends in `|| true`, it writes only to `$GITHUB_STEP_SUMMARY`, and it ends with `exit 0`.
  - It reports the OrbStack socket, the docker context and engine, and the old LaunchDaemon (file test plus `launchctl print system/`). If the old daemon is found, it emits a warning that does not contain "sudo".
  - A guard rejects fdesetup, pmset, systemsetup, sysadminctl, `defaults write`, osascript, `orb start` and `addexclusion -p`.
- [x] AC4: secret handling is unchanged.
  - Evidence: in the diff of the `secrets` step only the `if:` line changed. The step keeps its body, `umask 077`, the 600-mode and owner check, and does not print values.
  - The new awk guard keeps tmutil, launchctl, plutil and xattr out of any step that references `secrets.`.
  - The existing STK-043/044 guards still pass.
- [x] AC5: `docs/deploy.md` has the new "Setup" section, with "Done by the workflow" and "Still needs Ming at the Mac". `check-deploy-env.sh` passes and guards the new steps (sudo, label/path agreement between workflow, plist and doc, PUBLISH_FILES, step order).
- [x] AC6: typecheck, lint, test and the deploy checks are green (see above). Updating PR #18 is the orchestrator's step after PASS. The PR body text is ready in impl-log.

### Issues
None.

### Rules R1–R10
No violations found.
- R3: secrets stay confined to the unchanged `secrets` step, and a guard enforces this.
- R5: no market rules were touched.
- R7: every changed file is in the plan's file list.
- R8: checks are green.
- R6 is suspended, so it was not checked.

### Nits (do not block)
- `agent` (`:291`): `$AGENT_LABEL` is unquoted inside `[[ =~ ]]`, so the dots in the label match any character. This is harmless for this label. Quoting the label part (`"\"$AGENT_LABEL\""`) would make it a literal match.
- `agent`: `install -d -m 755 "$HOME/stoktok/logs"` assumes the plist's `StandardOutPath` is under `$HOME/stoktok/logs`. Today the existing "one /Users/<name>" and sched/log guards keep the two in line indirectly. A direct guard (plist log dir = `$HOME/stoktok/logs`) would make this explicit.
- macOS behaviour (`tmutil isexcluded` output format, launchctl error paths, and whether the `xattr` fallback is honoured) is untested in the sandbox, as the plan says. The first real run is the test.

### Follow-ups (out of scope)
- Ming should confirm defaults D1–D3 (warn on a Time Machine exclusion failure, stop a running job on plist reload, no rollback when `agent` fails). The impl-log PR text already lists them.
- Release PRs can change the plist under `apps/stoktok/`, and that plist is now auto-installed. Code-owner review (D5) is the gate; consider narrowing `pr-scope` for `launchd/` later.

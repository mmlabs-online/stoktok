# STK-097: Deploy-env guards on the live deployment workflow, and close the guard bypasses (STK-093 follow-ups)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | security |
| Attempts | 0 |
| Created | 2026-11-18 |
| PR | — |

## Goal
Follow-ups from STK-093's security reviews (attempt 1 🟡2, 🟡7; attempt 2 🟡8–🟡10) and code review attempt 2. `scripts/check-deploy-env.sh` checks only the stoktok draft and its deny list has known bypasses. Make the guards also cover the file that actually runs in `mmlabs-online/deployment`, and close the bypasses.

Scope:
- 🟡2: run the secrets-step guards against the live `deploy-stoktok.yml` (e.g. a deployment-repo CI job, or a vendored copy of the checks); state the control in `deploy/deployment-repo/README.md`.
- 🟡7: at the start of `secrets`, remove stale `"$dir"/.stoktok.env.*` left by a killed run; docs note.
- 🟡8: deny `docker inspect -f` formats that dump env (`Config.Env`, `{{json .}}`, `{{.}}`).
- 🟡9 and review gaps: `set | …`, `( set -o posix; set )`, `compgen -v` / `${!v}`, `$(<file)`, `< "$ENV_FILE" cat`, `grep`/`sed`/`awk`/`base64`/`tac`/`cp`/`dd`/`while read` on the env file, `$pwfile` or `secrets/`, `compose … convert`, `compose exec|run … env|printenv`, `/proc/*/environ`, `shell: bash -x {0}`, `set -o  xtrace` with extra spaces; comment that the list is a tripwire, not a complete control.
- 🟡10: exactly one `mktemp` and one `tmp=` in the secrets step; no `chmod` on `$ENV_FILE` except `chmod 600 "$tmp"`; `$ENV_FILE` allowed outside the secrets step only on the known lines; no step-level `ENV_FILE:` override.
- Nit: the `\.env` deny pattern must not flag `release.env`.

## Spec reference
CLAUDE.md R3, Conventions (secrets); work/tickets/STK-093/security-review.md (attempts 1–2), review.md (attempt 2).

## Acceptance criteria
- [ ] Each item above has a mutation proof (the check exits 1) and the real workflow still passes.
- [ ] The live deployment workflow is covered by the guards in a way Ming approves.
- [ ] typecheck, lint, test, check:deploy-env green; no secret printed or committed.

## Notes / answers from Ming
- 2026-11-18 (orchestrator): created from STK-093 reviews; Ming chose to open the STK-093 PRs and carry these here. The `stoktok` GitHub environment already restricts deployments to `main` (Ming, 2026-11-18).

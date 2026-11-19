# Escalation — STK-097: Deploy-env guards on the live workflow + close bypasses

| Field | Value |
|---|---|
| Attempts | 3 (2 reworks used) |
| Date | 2026-11-18 |

## What was asked
Run the deploy-workflow guards against the live `deploy-stoktok.yml` in `mmlabs-online/deployment` (new `stoktok-guards.yml` job + shared `ops/check-stoktok-workflow.sh`), make migrate detection fail closed, clean stale temp env files, and close the deny-list / pin bypasses found in the STK-093/STK-094 security reviews. Every check has a mutation proof; the live workflow still passes; v0.2.1 keeps deploying unchanged.

## What failed, per attempt
| Attempt | Main issues from review | Fixed in next attempt? |
|---|---|---|
| 1 | Blocker: raw CR from the PR file printed → forged workflow commands, and CR hides a bare `set` from line greps. Should-fix: guard-job pins missed PR `ref:`, job-level permissions/env, sparse-checkout removal. Security 🟡1 stale merge ref, 🟡2 command injection, 🟡4 checker unprotected. | Yes (attempt 2) |
| 2 | PASS. Remaining: pin bypasses via YAML spellings (quoted keys, `github['token']`, `continue-on-error`/`if:` etc.) and `run: "true\nset"`. Ming chose to fix before the PR. | Yes (attempt 3: whole-file sha256 pin; `run:` must be a `\|` block) |
| 3 | REWORK: the new `run:` rule only matches an unquoted `run:` key; `"run": "true\nset"`, `'run':`, `- {name: x, "run": …}` and `? run` / `: …` pass, so a bare `set` can still be hidden. Security rates it 🟡6 (low); the reviewer counts it as a blocker because the rule does not do what Ming asked. Should-fix: impl-log push status. | — |

## Likely root cause
The checker reads YAML line by line with grep/awk. Each round closes the spellings found so far, and YAML always has another legal spelling (quoted keys, flow mappings, explicit `?` keys, escapes). A text tripwire cannot fully prove what YAML a workflow contains. Everything else in the ticket — the deployment-side job, fail-closed migrate detection, CR/Unicode rejection, stop-commands, merge-parent check, whole-file pin of the guard job — passed review and CI (including macOS bash 3.2).

## Options for Ming
1. **Accept as is and open the PRs; carry the quoted/flow-key `run:` bypass to a follow-up.** The deny list is documented as a tripwire; any such edit to `deploy-stoktok.yml` must still pass code-owner review. Fastest; leaves a known, documented gap.
2. **One more targeted fix outside the loop** (`/solo` or a new ticket): an awk pass that, outside block-scalar content, rejects any key line starting with `"`, `'`, `{` or `?` (reviewer's spec; flags nothing in the live draft), plus mutation cases M46–M49, re-copied to the deployment branch. Small, closes this class of spelling for keys.
3. **Change approach:** parse the workflow with a real YAML parser in the guard job (e.g. `python3 -c 'import yaml'` or `yq` on the runner) and check the parsed structure. Robust against all spellings, but adds a tool dependency on the self-hosted runner and is a bigger change.

## Recommendation
Option 2 as a new small ticket (or /solo) right after merging this work — it is a few lines with a clear spec, and the rest of STK-097 is done and green. Until then option 1's documented-tripwire status holds, and code-owner review on deployment `main` (see ming-todo "Deployment repo settings") is the real control.

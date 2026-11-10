Status: READY

# Plan — STK-072: Optional AI secrets in deploy tooling (STK-063 slice 2b-ii)

## Spec summary
- docs/spec-v1.md **§7 Deployment** (the ticket says "§8 secrets"; the secrets line is in §7, flagged here, not a conflict): "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo."
- CLAUDE.md R3: "Service role key is server-only. Used by Next.js server code and `apps/worker` only. Never in `NEXT_PUBLIC_*`, never in client bundles."
- CLAUDE.md Conventions: "Secrets: only in `.env.local` (git-ignored) and the deploy repo. `.env.example` lists keys with no values."
- STK-071 plan, Split proposal: the deploy half of AC5 (`.env.example`, `docs/deploy.md`, draft deploy workflow, `check-deploy-env.sh`) moved here. STK-071's recommendation: `web, worker`, optional.
- Already on main: `packages/ai/src/env.ts` reads `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY`, trims them, and treats blank as "provider disabled". No TypeScript changes in this ticket.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `.env.example` and `docs/deploy.md` list `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` with a new `optional` status (Service `web, worker`, secret `y`). `LLM_PROVIDER` / `LLM_API_KEY` are removed from both files together. | `grep -nE 'ANTHROPIC_API_KEY\|GOOGLE_AI_API_KEY' .env.example docs/deploy.md` shows both keys with no value in `.env.example`, and the doc rows are exactly `` \| `ANTHROPIC_API_KEY` \| web, worker \| optional \| y \| `` (same for Google) inside the `env-list` markers. `grep -rn 'LLM_PROVIDER\|LLM_API_KEY' --exclude-dir=work --exclude-dir=node_modules .` finds nothing. `pnpm check:deploy-env` prints `OK` (the `.env.example` vs doc diff still holds). |
| 2 | The draft deploy workflow maps both from `STOKTOK_ANTHROPIC_API_KEY` / `STOKTOK_GOOGLE_AI_API_KEY`, with an empty-allowed charset check `^[A-Za-z0-9._-]*$` and no `missing` line. An unset secret writes `K=`. | (a) Read the `secrets` step of `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`: two `env:` mappings `K: ${{ secrets.STOKTOK_K }}`, two `if ! [[ "$K" =~ ^[A-Za-z0-9._-]*$ ]]` blocks after the required checks and before `mktemp`, no `missing=` line naming either key, printf gains `\nANTHROPIC_API_KEY=%s\nGOOGLE_AI_API_KEY=%s` plus two matching arguments. (b) Behaviour check of the printf, run in the scratch dir: `SUPABASE_URL=u SUPABASE_SERVICE_ROLE_KEY=s AUTHEN_SUPABASE_URL=a AUTHEN_SUPABASE_ANON_KEY=k ANTHROPIC_API_KEY= GOOGLE_AI_API_KEY= bash -c "tmp=/dev/stdout; $(grep -F "printf 'SUPABASE_URL=" <WF> \| sed 's/^ *//')"` prints six lines ending `ANTHROPIC_API_KEY=` and `GOOGLE_AI_API_KEY=`. (c) Charset regex check: `re='^[A-Za-z0-9._-]*$'`. `''`, `sk-ant-api03-Ab_c.d` and `AIzaSyX-1` match. `$'a\nb'`, `'a b'`, `'a=b'`, `'a$b'`, `'a#b'`, `"a'b"`, `'   '` do not match. |
| 3 | `check-deploy-env.sh` checks: printf keys = required ∪ optional; a `STOKTOK_` mapping for both kinds; `missing` lines only for required keys (and absent for optional ones). | `pnpm check:deploy-env` → `OK` on the real files. Then run the **negative cases** below against temporary copies. Each must exit 1 and print the named `FAIL:` line. Unmodified copies must give `OK`. |
| 4 | `typecheck`, `lint`, `test` green; the deploy-env check passes. | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:deploy-env` all exit 0 (CI runs the same; `.github/workflows/ci.yml:47`). |

### Negative cases for AC3 (reviewer runs; implementer records the same in impl-log.md)
Setup. The script finds its files from its own location (`ROOT="$(dirname script)/.."`), so a copy of the inputs runs fully isolated:
```bash
S=<scratchpad>/stk072; rm -rf "$S"; mkdir -p "$S"
cd /home/user/stoktok && cp -r scripts docs deploy .github .env.example "$S"/
bash "$S/scripts/check-deploy-env.sh"   # baseline: must print OK
```
For each case: make a fresh copy (or `cp` the original file back), apply **one** mutation with `sed -i`/an editor to the copy only, run `bash "$S/scripts/check-deploy-env.sh"; echo "exit=$?"`, and expect `exit=1` and the stated FAIL. WF = `$S/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`, DOC = `$S/docs/deploy.md`.

| # | Mutation (copy only) | Expected FAIL |
|---|---|---|
| N1 | WF: remove `\nGOOGLE_AI_API_KEY=%s` from the printf format and its `"$GOOGLE_AI_API_KEY"` argument | printf keys differ from required ∪ optional |
| N2 | WF: swap the arguments `"$SUPABASE_SERVICE_ROLE_KEY"` and `"$ANTHROPIC_API_KEY"` in the printf (format unchanged) | printf argument order differs from format key order |
| N3 | WF: add `[ -n "$ANTHROPIC_API_KEY" ] \|\| missing="$missing STOKTOK_ANTHROPIC_API_KEY"` after the other `missing` lines | optional key has a `missing` line |
| N4 | WF: delete the `[ -n "$SUPABASE_URL" ] \|\| missing=…` line | required key lacks its `missing` line |
| N5 | WF: change the mapping to `GOOGLE_AI_API_KEY: ${{ secrets.GOOGLE_AI_API_KEY }}` (no `STOKTOK_` prefix) | workflow lacks `GOOGLE_AI_API_KEY: ${{ secrets.STOKTOK_GOOGLE_AI_API_KEY }}` |
| N6a | WF: change Anthropic's charset to `^[A-Za-z0-9._-]+$` | optional key lacks the pinned empty-allowed charset check |
| N6b | WF: change Google's charset to `^.*$` | same as N6a (for Google) |
| N7 | DOC: change Anthropic's status `optional` → `optinal` | row has unknown status |
| N8 | DOC: change Anthropic's status to `required now` (WF unchanged) | required key lacks its `missing` line (ANTHROPIC_API_KEY) |
| N9 | Remove both AI keys from DOC, `.env.example` **and** WF (mappings, charset blocks, printf keys and args), so only the vacuous-pass guard can fire | no `optional` keys in the doc table |
| N10 | `.env.example` only: re-add `LLM_API_KEY=` | existing `.env.example` vs doc diff FAIL |

Then delete `$S`. Exact FAIL wording is up to the implementer. Each message must name the key and the rule broken.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `.env.example` | Replace the `LLM_PROVIDER` / `LLM_API_KEY` block with `ANTHROPIC_API_KEY=` and `GOOGLE_AI_API_KEY=` under a comment: optional, blank disables that provider, server-only (R3). | AC1 |
| `docs/deploy.md` | Env table: add the two `optional` rows, delete the two `LLM_*` rows. Line 121: say optional variables are always written and empty means the feature is off. Line 38: "If a *required* secret…". Environment section step 3: list the two optional `STOKTOK_` secrets. D4: list every key the file holds (the line is already stale: it names only the two Supabase keys). New short section "Enable AI keys (STK-072)" with Ming's steps (below). | AC1; the runbook must match the workflow |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | `secrets` step: two env mappings, two charset checks (after the required checks, before `mktemp`), printf format and arguments extended. Header comment (lines 15-19) mentions the optional keys. | AC2 |
| `scripts/check-deploy-env.sh` | Replace the STK-004 block (lines 109-124) with: status guard, required/optional parsing, printf set = required ∪ optional, format/argument order check, `STOKTOK_` mapping for both, required `missing` line present, optional `missing` line absent, optional charset pinned, optional non-empty. | AC3 |

No other files. `compose.yml` stays as it is: its header comment is already stale (it lists only the Supabase keys), and updating it would add a second file to Ming's deployment-repo PR. That is a follow-up.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `scripts/check-deploy-env.sh` (new assertions, run by `pnpm check:deploy-env` in CI) | AC2 and AC3 as standing checks |
| Negative cases N1–N10 above, run by hand against temp copies (not committed) | Each new assertion actually fails on bad input |

No `packages/core` logic changes, so R8 needs no new unit tests. Existing `packages/ai/src/env.test.ts` already covers "blank = disabled".

## Approach
1. **`.env.example` and `docs/deploy.md`:** edit both together so the existing key-set diff stays green (consult Finding 1: nothing reads `LLM_*`).
2. **Workflow `secrets` step** (consult R2):
   - Add `ANTHROPIC_API_KEY: ${{ secrets.STOKTOK_ANTHROPIC_API_KEY }}` and the Google equivalent. This exact form is the only one the existing `secrets.` guard (script line 81) accepts.
   - No `missing` line for either.
   - After the last required charset check, add for each key:
     `if ! [[ "$ANTHROPIC_API_KEY" =~ ^[A-Za-z0-9._-]*$ ]]; then echo "::error::Secret STOKTOK_ANTHROPIC_API_KEY has unexpected characters. Nothing was started; $ENV_FILE was not changed."; exit 1; fi`. Use a multi-line layout like the existing checks.
   - Extend the printf, keeping `printf 'SUPABASE_URL=` as the first token on the line. Append the format `\nANTHROPIC_API_KEY=%s\nGOOGLE_AI_API_KEY=%s` before the final `\n`, and add `"$ANTHROPIC_API_KEY" "$GOOGLE_AI_API_KEY"` as arguments in the same order.
   - No `echo` of values, no heredoc, no `set -x` (existing guards).
3. **`check-deploy-env.sh`** (consult R3, all items):
   - **Status guard.** Every row in the env-list block has column-3 status in {`required now`, `optional`, `reserved`}. Otherwise FAIL.
   - **Parsing.** `required` / `optional` are parsed the way `required` is today. FAIL if `optional` is empty.
   - **Printf key set.** `written_keys` must equal `printf '%s\n' $required $optional | grep . | sort -u`.
   - **Order.** The unsorted format keys (`grep -oE '[A-Z][A-Z0-9_]*=%s'`) must equal the argument names after the format string (`"$NAME"` tokens). This closes the silent value-swap gap (consult Finding 6).
   - **Mapping.** For each key in required ∪ optional: the existing `^\s+$k: \$\{\{ secrets\.STOKTOK_$k \}\}\s*$` grep.
   - **Required `missing` line.** `grep -qF "[ -n \"\$$k\" ] || missing=\"\$missing STOKTOK_$k\""` must match.
   - **Optional `missing` line.** `grep -E "missing=.*STOKTOK_$k([^A-Z0-9_]|$)"` must find nothing.
   - **Optional charset.** `grep -qF "[[ \"\$$k\" =~ ^[A-Za-z0-9._-]*\$ ]]"` must match. This pins AC2's injection guard.
   - Keep `set -euo pipefail` safe: guard greps that may find nothing with `|| true`.
4. Run `pnpm check:deploy-env`, the negative cases N1–N10, then `pnpm typecheck && pnpm lint && pnpm test`. Record all of them in impl-log.md.

Rules:
- **R3:** the keys exist only as env-file values on the host, mapped from environment secrets. Nothing goes into `NEXT_PUBLIC_*`. No TypeScript reads them outside `packages/ai/src/env.ts` (r3-guard, unchanged).
- **R7:** compose comment and other drift go to follow-ups.
- **R8:** all four checks green.
- **R10:** untouched.
- **R4/R5:** not applicable.

### Ming's manual steps (deployment repo; also goes into the new `docs/deploy.md` section)
`deploy/deployment-repo/` is only a draft mirror. Nothing here deploys by itself. Steps 1 and 2 can go in either order: an old workflow with a new image means the keys are absent, so AI is off. A new workflow with no secrets writes `K=`, so AI is off. Either way there is no lockout.
1. In `mmlabs-online/deployment`, Settings, Environments, `stoktok`: optionally add `STOKTOK_ANTHROPIC_API_KEY` and/or `STOKTOK_GOOGLE_AI_API_KEY`. Leaving one out disables that provider. Do not create repo-level secrets with the same names. Values must match `^[A-Za-z0-9._-]*$`: no spaces or newlines, and a whitespace-only value fails the run.
2. Open a deployment-repo PR from a non-`release/*` branch that copies the updated `.github/workflows/deploy-stoktok.yml` as-is, then merge it.
3. A workflow-only change does not trigger a deploy (the paths filter is `apps/stoktok/**`). Run `deploy-stoktok` via `workflow_dispatch` on `main` once. It rewrites `stoktok.env` (expect `changed=true` and a one-time force-recreate of web).
4. Check: `ls -l ~/.config/stoktok/stoktok.env` still shows `-rw------- mingming`. Do not print the file.
5. After any later key change or rotation, run `workflow_dispatch` on `main` again.

## Specialist input used
From `consult-software-architect.md`:
- **Findings 1–7: adopted.**
  - F1: removing `LLM_*` is safe.
  - F2: r3-guard is unaffected.
  - F3: no compose change needed.
  - F4: CI already runs the check.
  - F5: the script needs three changes.
  - F6: argument-order gap, closed here.
  - F7: empty secret gives `K=`, which means disabled.
- **R1 (doc and `.env.example`): adopted.** I also fix D4, which is already stale.
- **R2 (workflow): adopted** as written.
- **R3 (script): adopted in full.** That includes the status guard, the order check, the pinned charset and the non-empty optional set. The last two go slightly beyond the literal AC3, but they back AC2 and prevent a vacuous pass.
- **R4 (Ming's steps): adopted**, both here and as a `docs/deploy.md` section.
- **Compose header comment: rejected for now.** It is optional, it would add a file to Ming's PR, and it is already stale. Logged as a follow-up.
- **Open questions:** answered as defaults under Assumptions.

## Assumptions
(Defaults for Ming to confirm; none blocks.)
1. **Service `web, worker`** as the AC states. The architect noted that least privilege would be worker-only until STK-070 wires web. That is Ming's call. The AC wins for now.
2. **A whitespace-only or otherwise malformed optional secret fails the run** (red, nothing started, old env file kept). It is not treated as "disabled". Only a truly unset or empty secret means disabled. This is fail-closed, and it matches the `*` charset in AC2.
3. Ticket "§8 secrets" means spec §7 Deployment (the only secrets line). Flagged, not a conflict.
4. The negative cases are run by hand, not committed as a test script. A committed harness would be a follow-up, if wanted.

## Blocking questions
None.

## Split proposal
None. The diff is small (roughly 60–100 lines across 4 files).

## Follow-ups (not in this diff)
- `deploy/deployment-repo/apps/stoktok/compose.yml` header comment (line 14) lists only the Supabase secrets. Update it to "the env file written by deploy-stoktok" the next time compose changes.
- Optional: commit the N1–N10 negative cases as `scripts/check-deploy-env.test.sh`, run in CI.

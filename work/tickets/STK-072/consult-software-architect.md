## STK-072 consult: software-architect

### Findings
1. **Nothing reads `LLM_PROVIDER` / `LLM_API_KEY`.** They appear only in `/home/user/stoktok/.env.example` (lines 15-17) and `/home/user/stoktok/docs/deploy.md` (rows at lines 131-132). No code, compose file, workflow or script uses them. Deleting them from both files together is safe, and the `.env.example` vs doc diff check (script lines 14-21) stays green.
2. **`r3-guard.test.ts` won't trip.** It only scans `.ts/.tsx/.js/.jsx/.mjs` files under `apps/` and `packages/`. The AI key names can go into `.env.example`, the docs, the workflow `.yml` and the `.sh` script without breaking it.
3. **Compose needs no change.** Both services read the env file. AI keys there are not `${...}` interpolations, so the "undeclared variable" and "literal secret" checks are unaffected. Only the header comment (compose.yml line 14) lists the Supabase secrets; updating it is optional.
4. **CI already runs the check.** `/home/user/stoktok/.github/workflows/ci.yml:47` runs `pnpm check:deploy-env`, which is `bash scripts/check-deploy-env.sh`. No CI change needed.
5. **The current check must change in three places.** In `/home/user/stoktok/scripts/check-deploy-env.sh`:
   - It only knows `required now` (line 111).
   - It diffs the printf keys against `required` only (line 115). Adding optional keys to the printf line without changing this fails it.
   - It never checks the `missing` lines at all, so "required has one, optional has none" is new.
6. **Existing gap: argument order is not checked.** The check verifies the set of `K=%s` keys in the printf format, not that the arguments come in the same order. With 6 keys, a swapped argument would silently write one secret's value under another's name.
7. **Empty secrets work as intended.** In GitHub Actions an unset secret expands to `""`. With a `*` charset the printf writes `K=`. Docker passes that into the container as an empty string, and `packages/ai/src/env.ts` trims it and treats blank as disabled.

### Recommendations
**R1. Doc table (AC1).** In `docs/deploy.md`:
- Add rows `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY`, each `| web, worker | optional | y |`, and delete the two `LLM_*` rows. Do the same in `.env.example` (no values; a comment that blank means the provider is off).
- Line 121: add "Optional variables are always written; empty means the feature is off."
- Line 38: "If a *required* secret is empty or malformed…"
- Section 3 (line 33-34): list `STOKTOK_ANTHROPIC_API_KEY` and `STOKTOK_GOOGLE_AI_API_KEY` as optional.

**R2. Workflow `secrets` step (AC2).** In `deploy-stoktok.yml`:
- Add env mappings `ANTHROPIC_API_KEY: ${{ secrets.STOKTOK_ANTHROPIC_API_KEY }}` and `GOOGLE_AI_API_KEY: ${{ secrets.STOKTOK_GOOGLE_AI_API_KEY }}`. This exact form is the only one allowed by the existing `secrets.` check (script line 81).
- No `[ -n … ] || missing` line for either.
- Check each one after the required checks, before `mktemp`:
  ```bash
  if ! [[ "$ANTHROPIC_API_KEY" =~ ^[A-Za-z0-9._-]*$ ]]; then
    echo "::error::Secret STOKTOK_ANTHROPIC_API_KEY has unexpected characters. Nothing was started; $ENV_FILE was not changed."
    exit 1
  fi
  ```
  Same for Google. The charset rules out newline, CR, `=`, space, `#`, `$` and quotes. That blocks line injection and also compose's `$` interpolation and inline-comment parsing in env files. It still fits real keys (`sk-ant-api03-…`, `AIza…`). A whitespace-only secret is rejected (red run), not silently treated as disabled. That is the right fail-closed behaviour.
- Append `\nANTHROPIC_API_KEY=%s\nGOOGLE_AI_API_KEY=%s` to the printf format, keeping `printf 'SUPABASE_URL=` first (the check greps for it), plus the two matching arguments.
- Update the header comment (lines 15-19).

**R3. `check-deploy-env.sh` (AC3).** Replace lines 109-124 with:
- `optional` = doc rows matching `^\| \`[A-Z][A-Z0-9_]*\` \|.*\| optional \|`, parsed the same way as `required`.
- **Status guard:** every row's status (column 3) must be one of `required now`, `optional`, `reserved`. Otherwise FAIL, so a typo can't move a key between tiers.
- **Printf set:** `written_keys` must equal `sort -u` of required ∪ optional. Use `printf '%s\n' $required $optional | grep . | sort -u`.
- **Argument order (Finding 6):** the format keys in order must equal the argument names in order:
  ```bash
  fmt_order="$(echo "$printf_line" | grep -oE '[A-Z][A-Z0-9_]*=%s' | sed 's/=%s//')"
  arg_order="$(echo "$printf_line" | sed -E "s/^[^']*'[^']*'//" | grep -oE '"\$[A-Z][A-Z0-9_]*"' | tr -d '"$')"
  ```
  The two must be equal.
- **Mapping:** for each `k` in required ∪ optional, the existing `^\s+$k: \$\{\{ secrets\.STOKTOK_$k \}\}\s*$` grep.
- **Required `missing` line:** `grep -qF "[ -n \"\$$k\" ] || missing=\"\$missing STOKTOK_$k\""` must match.
- **Optional, no `missing` line:** `grep -E "missing=.*STOKTOK_$k([^A-Z0-9_]|$)" "$WF"` must find nothing.
- **Optional charset (recommended):** `grep -qF "[[ \"\$$k\" =~ ^[A-Za-z0-9._-]*\$ ]]"` must match. This pins the injection guard so a later edit can't drop it. It goes beyond the literal AC3 but backs AC2.
- **Optional, not empty:** fail if `$optional` is empty. Otherwise deleting both rows passes vacuously.

**R4. Deployment repo (human step; the draft here does not deploy itself).** `deploy/deployment-repo/` is only a draft mirror. The live file is in `mmlabs-online/deployment`. Ming, in any order (both directions are safe, see Risks):
1. Optionally add `STOKTOK_ANTHROPIC_API_KEY` and/or `STOKTOK_GOOGLE_AI_API_KEY` to the `stoktok` environment. Leaving them out is valid and means AI is off. No repo-level secrets with the same names.
2. Open and merge a deployment-repo PR that copies the updated `.github/workflows/deploy-stoktok.yml` as-is, from a non-`release/*` branch. If the compose comment changed, copy `apps/stoktok/compose.yml` too.
3. A workflow-only change doesn't trigger a deploy (the paths filter is `apps/stoktok/**`). Run `workflow_dispatch` on `main` once to rewrite `stoktok.env`. That run will show `changed=true` and force-recreate the containers once, which is expected.
4. After any later key rotation, run `workflow_dispatch` again.

Put this list in `docs/deploy.md` as a short "Enable AI keys (STK-072)" section so it isn't lost.

### Risks
- **Secret-value swap** if argument order isn't checked (Finding 6). R3's order check closes it.
- **Rollout order is safe both ways.** Old workflow with a new image: the keys are absent, so AI is off. New workflow with no secrets: `K=` is written, so AI is off. No lockout like STK-060.
- **Rollback:** an older image ignores the extra variables. No hazard.
- **Exposure:** the keys reach the web container as well as the worker. Per AC1 that is intended (`web, worker`). R3 holds as long as the r3-guard rules from STK-071 stay. Re-confirm at the security review that nothing logs `process.env`.
- **An overly loose charset** (e.g. `.*`) would allow newline injection of arbitrary variables into the env file, e.g. overriding `SUPABASE_URL`. The pinned grep in R3 guards against this.

### Open questions
- Should web get the AI keys now, or only the worker until STK-070 wires web? AC1 says `web, worker`; least privilege would be worker-only for now. It's Ming's call; default to the AC.
- Should a whitespace-only secret fail the run (recommended, current design) or be treated as disabled?

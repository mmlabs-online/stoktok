## Attempt 1 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- check:deploy-env: `OK: deploy env lists consistent` (exit 0)
- typecheck: exit 0
- lint: exit 0
- test: exit 0 — core 776, sources 35, ai 62, db 169 (+1 todo), worker 292, web 302 passed. Matches impl-log.md.

### Acceptance criteria
- [x] AC1 `.env.example` / `docs/deploy.md` list both AI keys as `optional`, `web, worker`, `y`; `LLM_*` removed from both — evidence: `.env.example:16-17` (no values), `docs/deploy.md:140-141` rows inside env-list markers; `grep -rn 'LLM_PROVIDER\|LLM_API_KEY'` (excl. work, node_modules, .git) → no hits; check:deploy-env OK.
- [x] AC2 workflow maps `STOKTOK_ANTHROPIC_API_KEY` / `STOKTOK_GOOGLE_AI_API_KEY`, `^[A-Za-z0-9._-]*$` checks before `mktemp`, no `missing` line, unset → `K=` — evidence: `deploy-stoktok.yml:164-165, 194-201, 207`. Reviewer ran the printf with empty AI vars → six lines ending `ANTHROPIC_API_KEY=` / `GOOGLE_AI_API_KEY=`. Regex: `''`, `sk-ant-api03-Ab_c.d`, `AIzaSyX-1` match; newline, space, `=`, `$`, `#`, `'`, whitespace-only rejected.
- [x] AC3 `check-deploy-env.sh` checks printf set = required ∪ optional, `STOKTOK_` mapping for both, `missing` only for required — evidence: `scripts/check-deploy-env.sh:109-159`. Reviewer ran N1–N10 on a scratch copy (fresh copy per case, deleted afterwards; repo untouched). Baseline OK/exit 0; every case exit 1 with the expected FAIL line naming key and rule (N7 additionally prints the printf-set FAIL, as the impl-log says).
- [x] AC4 typecheck, lint, test green; deploy-env check passes — see Checks.

### Issues
None.

### Rules R1–R10
No violations found. R3: keys go only to the host env file via environment secrets; no `NEXT_PUBLIC_*`; only `packages/ai/src/env.ts` reads them (r3-guard unchanged). R7: changed files = the plan's 4 files + ticket bookkeeping. R8: no core logic changed.

### Nits (do not block)
- The pinned-charset check is a plain `grep -F` over the whole file, so a comment line containing `[[ "$ANTHROPIC_API_KEY" =~ ^[A-Za-z0-9._-]*$ ]]` satisfies it even if the real check is weakened (reviewer verified: OK/exit 0). Same style as the other existing greps; acceptable for a draft guard.
- `docs/deploy.md` Environment step 5 ("store both as repo-level Actions secrets") still says "both"; there are now up to six secrets.

### Follow-ups (out of scope)
- `deploy/deployment-repo/apps/stoktok/compose.yml:14-15` header comment lists only the Supabase secrets (already in plan).
- Optionally commit N1–N10 as `scripts/check-deploy-env.test.sh` in CI; could also anchor the charset pin to an `if ! [[` line to close the comment loophole.
- `docs/deploy.md` stale "R6 suspended" placeholders (impl-log).

## Attempt 2 — 2026-11-10
Verdict: REWORK

### Checks (run by reviewer)
- check:deploy-env: `OK: deploy env lists consistent` (exit 0)
- typecheck: exit 0
- lint: exit 0
- test: exit 0 — core 776, sources 35, ai 62, db 169 (+1 todo), worker 292, web 302 passed. Matches impl-log.md.

Negative cases (each on a fresh scratch copy of scripts/docs/deploy/.github/.env.example, copy deleted after each run, repo untouched; `git status` clean):
- Baseline OK, exit 0.
- N1–N10: all exit 1 with the expected FAIL lines (N6a/N6b now show the new guard message; N7 also shows the printf-set FAIL; N9 leaves only comments/prose and fires the "no optional keys" guard).
- N11a (`!` dropped), N11b (`exit 1` removed), N11c (real guard commented out, `^.*$` check left), attempt-1 comment-line case (real check weakened to `+`, plus a full-line comment holding the pinned text): all exit 1, guard FAIL.
- N12a (`echo "X=$Y" >> "$tmp"`), N12b (`tee -a "$ENV_FILE"`), N12c (`echo X > "$ENV_FILE"`): all exit 1, other-writer FAIL.
- Extra probes: guard moved after `mktemp` → exit 1; guard moved into the `deploy` step → exit 1; printf retargeted to `> "$ENV_FILE"` and moved ahead of the guards → exit 1 (by chance, through the argument-order check).
- **Extra probes that pass but should fail (see Issues):**
  - P2: Anthropic guard line replaced by `if ! [[ "$ANTHROPIC_API_KEY" =~ ^.*$ ]]; then # if ! [[ "$ANTHROPIC_API_KEY" =~ ^[A-Za-z0-9._-]*$ ]]; then` → **OK, exit 0**.
  - P3: `; echo "X=$Y" >> "$tmp"` appended to the printf line → **OK, exit 0**.
  - P6b: printf retargeted to `> "${ENV_FILE}"` and moved above `missing=""` (so it writes unvalidated values straight to the env file, before any guard) → **OK, exit 0**.
  - P4: an extra `echo X >| "$tmp"` line → OK, exit 0 (nit, below).

### Acceptance criteria
- [x] AC1 — unchanged since attempt 1 (no diff to `.env.example` / `docs/deploy.md` in attempt 2); check:deploy-env OK.
- [x] AC2 — workflow unchanged in attempt 2; `deploy-stoktok.yml:164-165, 194-201, 207` as in attempt 1.
- [x] AC3 as written — N1–N10 still fail as planned. No regression against plan.md.
- [x] AC4 — see Checks.
- [ ] Ming's note (ticket.md, 2026-11-10): (1) pin the real guard, "not just its text", and "not a comment"; (2) "fail if anything other than the one printf writes to `$tmp` or `$ENV_FILE`". Both are only partly met. See Issues 1 and 2.

### Issues
#### Issue 1 — 🟡 should-fix — the guard is still matched as text anywhere in a line
- **Where**: `scripts/check-deploy-env.sh:159`
- **Expected**: The check passes only when a real, uncommented `if ! [[ "$K" =~ ^[A-Za-z0-9._-]*$ ]]; then` line exists. This is Ming's "the real guard, not just its text … (not a comment)". Security review attempt 1, Rec 1, asked for the anchored form `^\s+if ! \[\[ … \]\]; then$`.
- **Actual**: `index($0, …)` matches the text anywhere in a line. A weakened guard with the pinned text in a trailing `# …` comment passes (P2 above). So would the text inside an `echo '…'`.
- **Fix instruction**: In the awk, compare the whole trimmed line instead of using `index`:
  `{ l = $0; sub(/^[[:space:]]+/, "", l); sub(/[[:space:]]+$/, "", l) } l == "if ! [[ \"$" k "\" =~ ^[A-Za-z0-9._-]*$ ]]; then" && !g { g = NR; next }`
  The reviewer checked this form: it finds the Anthropic guard in the current secrets step. Add P2 as negative case N11d and record its result in impl-log.md.

#### Issue 2 — 🟡 should-fix — the printf line is exempt from the writer check, whatever else it contains or targets
- **Where**: `scripts/check-deploy-env.sh:125`, `:169-170`
- **Expected**: The only write to the env file is the one printf, and it goes to `"$tmp"` (after the guards, then `mv`).
- **Actual**: Every line containing `printf 'SUPABASE_URL=` is dropped before the writer grep. So:
  - a second writer on the same line passes (P3);
  - the printf itself can target `"${ENV_FILE}"` and sit before the guards (P6b). That writes unvalidated values directly and non-atomically.
  The security re-review (attempt 2) found the same two gaps.
- **Fix instruction**:
  1. FAIL unless exactly one line in the workflow contains `printf 'SUPABASE_URL=`.
  2. FAIL unless that line matches `grep -E "^\s+printf '[^']*'( \"\\\$[A-Z][A-Z0-9_]*\")+ > \"\\\$tmp\"\s*$"`. The reviewer checked this: it matches the current line, and it rejects the line with `; echo "X=$Y" >> "$tmp"` appended.
  3. In the existing awk, also record the printf line number and require each optional guard to come before it (`g < p`), as well as before `mktemp`.
  4. Add P3 and P6b as negative cases N12d and N12e, and record their results.

### Rules R1–R10
No violations found. R7: attempt 2 changes only `scripts/check-deploy-env.sh` (in the plan's file list) plus ticket bookkeeping. R3/R8: unchanged since attempt 1.

### Nits (do not block)
- The redirect pattern at `:170` misses `>|` (P4). `>(>|\|)?` instead of `>>?` closes it cheaply. Optional, can go with Issue 2.
- The `exit 1` only has to appear within 4 lines of the guard, not inside that `if`'s own body. This is acceptable: any layout that still passes either exits or would need a deliberate restructure.

### Follow-ups (out of scope)
- Pin the four required keys' charset/`https://` guards the same way (predates this ticket).
- Restrict `secrets.` mappings to the `secrets` step (`check-deploy-env.sh:81`, `:141`).
- Writers using `cp`/`dd`/`sed -i` or a literal `stoktok.env` path, and writes from other steps.
- Commit N1–N12 (plus P-cases) as `scripts/check-deploy-env.test.sh`, run in CI.
- From attempt 1: compose.yml header comment; `docs/deploy.md` Environment step 5 "both"; stale "R6 suspended" placeholders.

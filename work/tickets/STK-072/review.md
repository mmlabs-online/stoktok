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

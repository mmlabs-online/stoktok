## Attempt 1 — 2026-11-10

### Files touched
| File | Required because |
|---|---|
| `.env.example` | AC1: `LLM_*` replaced by `ANTHROPIC_API_KEY=` / `GOOGLE_AI_API_KEY=` (no values) |
| `docs/deploy.md` | AC1: two `optional` rows replace the `LLM_*` rows; "required" wording in the fail-safe line, env-list intro, D4 (now lists every key), environment step 3, new "Enable AI keys (STK-072)" section |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | AC2: two env mappings, two empty-allowed charset checks before `mktemp`, no `missing` line, printf extended, header comment |
| `scripts/check-deploy-env.sh` | AC3: replaced the STK-004 block: status guard, required/optional parsing, non-empty optional guard, printf set, format/argument order, mappings, required `missing` line, optional `missing` absent, pinned charset |

### Tests added / changed
- `scripts/check-deploy-env.sh` new assertions (run by `pnpm check:deploy-env`).
- Negative cases N1-N10 run by hand on a scratch copy (script: scratchpad `neg.sh`, copy deleted afterwards; repo files untouched). Baseline copy: `OK`, exit 0. Every case exit=1 with:
  - N1: printf keys in the workflow differ from required + optional keys
  - N2: printf argument order differs from format key order
  - N3: optional key ANTHROPIC_API_KEY has a missing line
  - N4: required key SUPABASE_URL lacks its missing line
  - N5: workflow lacks 'GOOGLE_AI_API_KEY: ${{ secrets.STOKTOK_GOOGLE_AI_API_KEY }}'
  - N6a / N6b: optional key ANTHROPIC_API_KEY / GOOGLE_AI_API_KEY lacks the pinned empty-allowed charset check
  - N7: env row has unknown status (`optinal`); a second FAIL (printf keys differ) also prints because the row drops out of optional
  - N8: required key ANTHROPIC_API_KEY lacks its missing line
  - N9: no optional keys in the doc table (only this FAIL fired)
  - N10: docs/deploy.md env table differs from .env.example
- AC2(b): the printf run with empty AI vars printed six lines ending `ANTHROPIC_API_KEY=` and `GOOGLE_AI_API_KEY=`. AC2(c): regex matches `''`, `sk-ant-api03-Ab_c.d`, `AIzaSyX-1`; rejects newline, space, `=`, `$`, `#`, `'`, whitespace-only.
- `grep -rn 'LLM_PROVIDER\|LLM_API_KEY'` (excluding work, node_modules, .git): no hits.

### Checks (actual output summary)
- check:deploy-env: `OK: deploy env lists consistent`
- typecheck: passed (exit 0)
- lint: passed (exit 0)
- test: all packages passed (core 776, sources 35, ai 62, db 169, worker 292, web 302)

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- `deploy/deployment-repo/apps/stoktok/compose.yml` header comment lists only the Supabase secrets (from plan).
- Optional: commit N1-N10 as `scripts/check-deploy-env.test.sh` run in CI.
- `docs/deploy.md` lines 15 and 69 still say "R6 suspended / no auth code" in the Placeholders section (stale, unrelated).

### Scope self-check
- Could the diff be smaller? No; the script block is the bulk and each assertion maps to a plan item.
- Diff size: +73 / -18 lines across 4 files (impl-log excluded; not committed)

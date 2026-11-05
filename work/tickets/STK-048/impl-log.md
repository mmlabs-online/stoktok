
## Attempt 1

### Files touched
- `CLAUDE.md` (Stack Auth row, R6 note): required because AC1.
- `.env.example` (comments only; KEY= lines unchanged): required because AC1.
- `apps/web/server/auth/config.ts` (JSDoc line 12): required because AC1.
- `apps/web/server/auth/authen-client.ts` (JSDoc line 20): required because AC1.
- `docs/deploy.md` (secret values, new setup step 1 with renumbering, verify step 12): required because AC1-AC3.

### Tests added
None (comments/docs only).

### Checks
- `pnpm typecheck`, `pnpm lint`, `pnpm test`: green (db 121 passed/1 todo, worker 236 passed, web 266 passed).
- `bash scripts/check-deploy-env.sh`: `OK: deploy env lists consistent`.
- AC1 grep for calechip: only `.github/workflows/ci.yml:16` and `deploy/deployment-repo/.github/workflows/runner-check.yml:3` remain (expected).

### Out-of-plan files
None.

### Follow-ups
1. `docs/spec-v1.md` §1.2, §4, §4.1, §4.2, §9 Q1 still say shared mmlabs SSO / separate auth project (Ming edits).
2. `docs/deploy.md` line 15 "No auth code ... R6 suspended" is stale.
3. Reuse `SUPABASE_URL` instead of `AUTHEN_SUPABASE_URL` (code/env change).

### Scope self-check
Only plan-listed files, comment/doc lines changed. Not committed, per instruction.

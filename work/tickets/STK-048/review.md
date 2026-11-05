## Attempt 1 — 2026-11-05
Verdict: PASS

Reviewed commit 82d2221 (implementation) on `git diff origin/main...HEAD` (bcb0307 ticket, b79c751 plan, 82d2221 implementation).

### Checks (run by reviewer)
- typecheck: green (`pnpm typecheck`, all packages Done).
- lint: green (`pnpm lint`, all packages Done).
- test: green. core 539 passed (43 files), db 121 passed + 1 todo, worker 236 passed, web 266 passed. Matches impl-log.
- `bash scripts/check-deploy-env.sh`: `OK: deploy env lists consistent`.
- AC1 grep (`grep -rni calechip --exclude-dir={work,node_modules,.next,.git}`): only `.github/workflows/ci.yml:16` (Docker Hub comment) and `deploy/deployment-repo/.github/workflows/runner-check.yml:3` (CICD-07 reference) remain. Both are unrelated to auth, as the plan expects.

### Acceptance criteria
- [x] AC1: every "Authen = CaleChip" mention now says Supabase Auth of stoktok's own project. Evidence: CLAUDE.md:20 (Stack Auth row), CLAUDE.md:48 (R6 note), .env.example:5–8, apps/web/server/auth/config.ts:12, apps/web/server/auth/authen-client.ts:20, docs/deploy.md:34 and :87. Wording matches plan "Exact wording". Grep is clean apart from the two expected lines.
- [x] AC2: the values of the three secrets are documented at docs/deploy.md:34. URL = stoktok project URL, same as `STOKTOK_SUPABASE_URL`. Anon key = the stoktok anon or `sb_publishable_` key, "never the service role key". Allowlist = Ming's UUID from the stoktok project's Auth.
- [x] AC3: one-time setup is new step 1 in docs/deploy.md "Restore auth (STK-004) - order" (lines 56–59): disable public sign-ups, create Ming's user with auto-confirm, copy the UUID. The later steps are renumbered and the "If step 3 runs before step 2" sentence is updated. Verify step 12 (docs/deploy.md:87) signs in with "Ming's stoktok account (Restore auth, step 1)".
- [x] AC4: no logic change. In `apps/`, the diff touches only the two JSDoc lines. In `.env.example`, it changes only comment text: the `AUTHEN_SUPABASE_URL=`, `AUTHEN_SUPABASE_ANON_KEY=` and `ALLOWLIST_USER_IDS=` values are still empty. Every other change is docs or `work/**`. All checks are green (above).

### Issues
None.

### Rules R1–R10
No violations found. R3: the docs keep the anon key server-only and say explicitly not to use the service role key. R6: behaviour is unchanged. Putting Auth users in the app-data project is safe with the current grants: anon/authenticated are revoked on all public tables and sequences, plus default privileges, in supabase/migrations/20261023000200_v1_rls_grants.sql:9–19, and in each later table migration. Disabling sign-ups is defence in depth. R7: the scope matches the plan. Two `work/` files outside the plan list changed: work/backlog.md (the new row) and work/tickets/STK-004/ticket.md (one cross-reference note). Both are workflow bookkeeping, which AC4 allows ("work files").

### Nits (do not block)
- impl-log.md, "Scope self-check", says "Not committed, per instruction". The orchestrator committed it as 82d2221. The line is stale but harmless.

### Follow-ups (out of scope)
- docs/spec-v1.md §1.2, §4, §4.1, §4.2 (bullet 3, "never stores data in the shared auth project") and §9 Q1 conflict with Ming's 2026-11-05 decision. Ming needs to edit the spec. **Spec conflict flagged per CLAUDE.md.**
- docs/deploy.md:15 "No auth code is in the app (R6 suspended)" is stale since STK-004.
- Reuse `SUPABASE_URL` instead of a separate `AUTHEN_SUPABASE_URL` (code/env change; already in the ticket).
- When a future migration adds tables, keep revoking anon/authenticated. A signed-in Auth user now lives in the same project, so a missed revoke would expose that table through PostgREST.

## Attempt 2 — 2026-11-05
Verdict: PASS

Reviewed commit 1854a21 (rework for security-review M1/M2, requested by Ming in the ticket notes) as `HEAD~1..HEAD`. I also checked the whole ticket as `git diff origin/main...HEAD`.

### Checks (run by reviewer)
- typecheck: green (all 4 packages Done).
- lint: green (all 4 packages Done).
- test: green. core 539 passed (43 files), db 121 passed + 1 todo, worker 236 passed, web 266 passed. Matches impl-log (which omits the core count; core did not change).
- `bash scripts/check-deploy-env.sh`: `OK: deploy env lists consistent`. No new `/Users/` path was added.
- AC1 grep: still only `.github/workflows/ci.yml:16` and `deploy/deployment-repo/.github/workflows/runner-check.yml:3`, both unrelated to auth.

### Rework items
- [x] M1 (key-rotation runbook): fixed. docs/deploy.md:68 now says rotating the legacy JWT secret also invalidates `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` and Ming's session. The stale "(stoktok uses neither yet)" is gone. Step 2 (:69) updates the Authen anon key too in that case. The new step 7 (:74) signs in again. The order works: the anon key is replaced in step 2, before step 3 rewrites the env file and recreates web.
- [x] M2 (Auth setup settings): docs/deploy.md:60 adds a hardening bullet to Restore auth step 1. It covers every item the security review listed: anonymous sign-ins off, other providers (phone, OAuth, SSO/SAML) off, "Confirm email" on, a minimum password length (12+), leaked-password protection, and Site URL and Redirect URLs set to `https://<APP_HOSTNAME>`. `<APP_HOSTNAME>` is the placeholder deploy.md already uses (:11).

### Acceptance criteria (whole ticket)
- [x] AC1–AC3: the attempt-1 evidence still holds. Attempt 2 only adds to the Restore auth and Rotate sections and changes no earlier AC text. The verify step (:89) still points to "Restore auth, step 1".
- [x] AC4: attempt 2 touches only docs/deploy.md and work files. No code or `.env.example` changes. All checks are green.

### Scope
Attempt 2 changes docs/deploy.md, work/backlog.md and work/tickets/STK-048/{impl-log,ticket}.md. The deploy.md edits are exactly M1/M2, which Ming asked for in the ticket note. That justifies them as additions to the plan. The work files are bookkeeping.

### Issues
None.

### Rules R1–R10
No violations. R3: the docs still keep the anon key server-only. R6: no behaviour change. R7: limited to the two items Ming asked for. L1–L3 stay follow-ups.

### Nits (do not block)
- impl-log.md attempt 2, "Scope self-check", says "Not committed, per instruction" again, but the change was committed as 1854a21.
- docs/deploy.md:74 "confirm the dashboard shows" could say "confirm the stoktok dashboard page shows", since "dashboard" also means the Supabase dashboard in this file.

### Follow-ups (out of scope)
- Unchanged from attempt 1: the spec conflict (docs/spec-v1.md §1.2, §4, §4.2, §9 Q1), the stale docs/deploy.md:15, and reusing `SUPABASE_URL`/`SUPABASE_ANON_KEY` (security L3).
- Security L1: reject `sb_secret_`, a `role=service_role` JWT, or the service role key value in `AUTHEN_SUPABASE_ANON_KEY` (code change).
- Security L2: optionally set Realtime to "private channels only".

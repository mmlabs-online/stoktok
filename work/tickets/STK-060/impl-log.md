## Attempt 1 — 2026-11-07

### Files touched
| File | Required because |
|---|---|
| `apps/web/server/auth/config.ts` | AC1: no `allowlist` in `AuthConfig`, no `ALLOWLIST_USER_IDS` parsing |
| `apps/web/server/auth/claims.ts` | AC2: `ok \| unauthenticated`; adds `is_anonymous` and `session_id` checks |
| `apps/web/server/auth/require-user.ts` | AC2: `forbidden` branch and import removed, comments updated |
| `apps/web/app/forbidden.tsx` | AC2: deleted, nothing reaches it any more |
| `apps/web/next.config.ts` | AC2: `authInterrupts` removed |
| `apps/web/proxy.ts` | Comment only |
| `apps/web/server/auth/claims.test.ts`, `config.test.ts`, `require-user.test.ts`, `get-claims.test.ts` | AC3: tests rewritten to the new signature |
| `apps/web/proxy.test.ts`, `apps/web/app/login/actions.test.ts` | AC7: `ALLOWLIST_USER_IDS` stub removed |
| `.env.example` | AC5 (also needed by `check:deploy-env`) |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | AC4: allowlist secret, check, UUID regex and printf key removed |
| `docs/deploy.md` | AC5: two auth secrets, required access-control checklist, new "Remove the allowlist (STK-060) - order" section, env table row removed |
| `work/ming-todo.md` | AC5: allowlist removed, ordered STK-060 steps added, auth part of the spec-edit item removed |
| `docs/spec-v1.md` | AC6: §1.2, §4.1 `web` row, §4.2 bullets, §9 risk row |
| `CLAUDE.md` | AC6: intro, Auth row, R6 row and note |
| `docs/figma-make-prompts.md` | Consult finding 7 |
| `.claude/agents/reviewer.md`, `.claude/agents/implementer.md` | Consult Rec 6 (R6 clause). Permissions allowed the edits |

### Tests added / changed
- `claims.test.ts` › ok for valid claims of an arbitrary sub; sub is returned lowercased; sub missing/empty/not string; is_anonymous true rejected (false/absent ok); session_id missing/empty/not string. Other cases kept. Allowlist and forbidden cases removed.
- `config.test.ts` › loads with ALLOWLIST_USER_IDS unset or set to junk (ignored). Allowlist tests removed.
- `require-user.test.ts` › returns userId for an arbitrary sub; redirects to /login for an anonymous session (caller's next line never runs); config-missing test now uses `AUTHEN_SUPABASE_URL=''`. Forbidden test removed.
- `get-claims.test.ts` › payload gets `session_id`, cfg is `{ issuer }`.

### Checks (actual output summary)
Environment: Windows (Git Bash), pnpm worked from Windows; one WSL attempt for `@stoktok/db` also failed (see below).
- typecheck: green for all 5 packages (`pnpm typecheck`).
- lint: green (`pnpm lint`).
- test: `@stoktok/web` 38 files / 301 tests pass; `@stoktok/core` pass; `@stoktok/worker` 14 files / 229 pass; `@stoktok/sources` 24 pass. `@stoktok/db`: 141 pass, 2 fail in `src/r3-guard.test.ts` (R3 guard scans repo paths and compares with `apps/web/` prefixes; I believe it is a Windows path-separator issue from `relative()`, unrelated to this diff, which does not touch packages/db or `server/db.ts`). Re-run under WSL also exited non-zero; the cause was not inspected. Needs a Linux/CI run to confirm green.
- build: `pnpm build` passes (web, `forbidden.tsx`/`authInterrupts` removal OK).
- check:deploy-env: `OK: deploy env lists consistent`.
- check:service-key: `OK: no service key material in client bundle`.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Plan-mandated: stale `docs/deploy.md:15` ("No auth code is in the app (R6 suspended)...") and the §4.2 open question about JWT trust are untouched.
- Consult Risk 2: log or alert on an unexpected user signing in (new behaviour; orchestrator to open a `debt` issue).
- `ALLOWLIST_USER_IDS` still appears in `docs/deploy.md` and `work/ming-todo.md` (the deploy-order steps that tell Ming to delete the old secret) and in `config.test.ts` (the ignored-junk test). AC7's grep will list these on purpose; they cannot be removed without losing the instructions.
- `packages/db` `r3-guard.test.ts` fails on Windows (likely path separators); confirm in CI.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +105 / -112 lines (21 files, before the impl-log).

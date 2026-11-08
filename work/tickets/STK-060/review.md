## Attempt 1 — 2026-11-07
Verdict: PASS

Reviewed commit `2bc2414` ("STK-060: remove the allowlist check; … (attempt 1)"), `git diff main...HEAD`. Checks run by the reviewer on Windows (Git Bash), same environment as the implementer.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0, all 5 packages.
- lint: `pnpm lint` exit 0.
- test (`pnpm -r --no-bail test`):
  - core: 51 files / 657 tests pass.
  - web: 38 / 301 pass.
  - worker: 14 / 229 pass.
  - sources: 24 pass (1 file skipped).
  - **db: 141 pass, 2 fail**, both in `packages/db/src/r3-guard.test.ts` ("SUPABASE_SERVICE_ROLE_KEY is referenced only in packages/db/src/client.ts" and "apps/web/server/db.ts starts with import 'server-only'").
- The db failures are pre-existing and do not come from this diff. I checked this myself:
  - `git diff main HEAD -- packages/` is empty.
  - On a detached worktree of `main` (`caf604e`), with node_modules linked from the repo, the same 2 tests fail with the same output. The worktree is removed.
  - Cause: `relative()` returns Windows paths. The received list was `"packages\\db\\src\\client.ts"`, but the test compares against `'packages/db/src/client.ts'` and prefix `'apps/web/'`.
  - The guard's intent still holds on this branch. `git grep` shows `SUPABASE_SERVICE_ROLE_KEY` only in `packages/db/src/client.ts` and `client.test.ts`, and `from '@stoktok/db'` in `apps/web` only in `apps/web/server/db.ts`.
  - The implementer's impl-log describes this correctly. On Linux CI it should be green; CI must confirm.
- build: `pnpm build` exit 0. It still builds with `forbidden.tsx` and `authInterrupts` removed.
- `pnpm check:deploy-env`: `OK: deploy env lists consistent`.

### Acceptance criteria
- [x] AC1 `loadAuthConfig()` no longer reads or requires `ALLOWLIST_USER_IDS`. Evidence:
  - `apps/web/server/auth/config.ts:3-19`: `AuthConfig` is `{ supabaseUrl, anonKey, issuer }`; the UUID regex and the parsing are gone.
  - `config.test.ts › loads with ALLOWLIST_USER_IDS unset or set to junk (ignored)` passes.
- [x] AC2 Issuer, aud/role and expiry are still checked and fail closed. Any sub returns `ok`, and `forbidden` is removed. Evidence:
  - `claims.ts:1` is `ok | unauthenticated`. Checks at `claims.ts:8-18`, plus `is_anonymous` and `session_id`.
  - `require-user.ts:32-36` has no `forbidden` branch.
  - `app/forbidden.tsx` is deleted and `authInterrupts` is removed from `next.config.ts`.
  - Grep for `forbidden|authInterrupts` in `apps` finds no auth hits.
  - No redirect loop: `/login` is public (`proxy.ts:7`), and `login/page.tsx:10` redirects away only on `ok`.
- [x] AC3 Tests updated and checks green, except the pre-existing db env failure above. Evidence:
  - `claims.test.ts`: "ok for valid claims of an arbitrary sub" (random and fixed UUID), "sub is returned lowercased", and the exp/iss/aud/role/sub/is_anonymous/session_id/non-object cases.
  - `require-user.test.ts`: "returns userId for an arbitrary sub", "redirects to /login for an anonymous session, and the caller's next line never runs", "redirects to /login when auth config is missing".
  - `get-claims.test.ts`: the ES256 round trip still passes with `session_id`.
- [x] AC4 Workflow draft. Evidence:
  - `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` has no `ALLOWLIST`. The env mapping, the missing check, the UUID block and the printf key are removed.
  - The URL and anon-key validation is untouched. `check:deploy-env` OK.
- [x] AC5 `.env.example`, `docs/deploy.md` and `work/ming-todo.md`. Evidence:
  - `.env.example` lines removed.
  - `deploy.md:56-64` is now a **required** access-control checklist, and it says plainly that any Auth user gets full access.
  - `deploy.md:71-81` adds a deploy-order section with a rollback warning. The env table row is removed. `ming-todo.md:14-16` is updated.
  - The remaining mentions are about the migration, not a dependency (see AC7).
- [x] AC6 Spec and CLAUDE.md. Evidence:
  - `docs/spec-v1.md`: §1.2:15, §4.1:136, §4.2:140-141, §9:252.
  - `CLAUDE.md`: intro :4, Auth row :20, R6 :42, note :48.
  - The spec has no Decisions Log entry about the allowlist, so nothing protected was changed.
- [x] AC7 No reference to `ALLOWLIST_USER_IDS` outside `work/tickets/**`. Met in intent; three hits remain on purpose, which I accept:
  - `docs/deploy.md:73,75` and `work/ming-todo.md:16`: the steps telling Ming the order of the migration and to delete the old `STOKTOK_ALLOWLIST_USER_IDS` secret. The plan requires these (Approach step 6). Without them, the documented lockout (an old auth image under the new workflow) is likely. They are instructions for retiring the variable, not a dependency on it.
  - `apps/web/server/auth/config.test.ts:12,15`: a regression test proving a leftover junk value is ignored. The plan names this test explicitly. It protects step 1 of the deploy order, where the old workflow still writes the variable into the env file.
  - No code, config or env template reads the variable. The literal grep in the plan's verification row conflicts with the plan's own Approach step 6 and test list. The plan is the stricter source of what to build, so this is a plan inconsistency, not an implementation defect. The other `ALLOWLIST` hit, `apps/web/test/no-hardcoded-rules.test.ts`, is unrelated, as the plan expected.

### Issues
None.

### Scope
- Every changed file is in the plan's file table, including `.claude/agents/reviewer.md` and `implementer.md` (Default 3).
- `work/backlog.md` and the ticket files are orchestrator bookkeeping.
- `.gitattributes` is untracked and not part of this branch's diff. It must not be swept into the ticket commit without a decision.

### Rules R1–R10
- R6: `requireUser()` stays the single entry point and fails closed on config errors, getClaims errors and every claim failure. It now also rejects anonymous sessions and tokens without a `session_id`.
- R3: unaffected; the guard's intent was verified manually above.
- R1, R2, R4, R5, R9 and R10: not touched.
- R8: the auth logic has tests. There is no `packages/core` change.
- R7: within plan.

No violations found.

### Nits (do not block)
- `claims.ts` now runs the `is_anonymous` and `session_id` checks before `sub`. This is fine; the order only affects which check fails first.
- `crypto.randomUUID()` in `claims.test.ts` makes one test case nondeterministic. It is harmless because any UUID must pass.

### Follow-ups (out of scope)
- `packages/db/src/r3-guard.test.ts` fails on Windows because `relative()` returns backslash paths (pre-existing on `main`). Fix: normalise with `.split(sep).join('/')`. Open a `debt` issue.
- Already listed by the implementer:
  - the stale `docs/deploy.md:15` line ("No auth code is in the app (R6 suspended)");
  - the §4.2 open question about JWT trust;
  - consult Risk 2: log or alert on an unexpected user `sub`.
- The ticket has `security` in areas and the diff touches auth. The security auditor should run at REVIEW per the workflow; this review does not replace it.
- Default 2 (`session_id` required) is a lockout risk if a real Supabase token ever lacks the claim. Ming should confirm it on the first real login after release.

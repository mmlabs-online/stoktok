# STK-060 security review

## Attempt 1

**Verdict:** no blockers. With the allowlist removed, the remaining auth is still sound and fails closed. The auditor only read files; it did not run the tests or the build, and could not run `git diff`, so it reviewed the files named in the brief plus the related code around them.

### Findings

🟢 **Fail-closed chain still holds** (`apps/web/server/auth/require-user.ts:12-36`)
- In `authenticate()`, every failure returns `unauthenticated`: bad config (L14-19), a `getClaims` error or empty data (L23), and any thrown error (L25-28).
- `requireUser()` returns only on `ok`. Everything else goes through `redirect()` (L35), and that call throws. The test at `require-user.test.ts:72-81` shows the caller's next line never runs.

🟢 **Claims check is correct and has no allowlist left** (`apps/web/server/auth/claims.ts:7-19`)
- `ClaimsResult` is now just `ok | unauthenticated`.
- The checks still cover: object type, `exp` (finite and greater than now), exact `iss`, `aud` containing `authenticated` together with `role === 'authenticated'`, and a non-empty string `sub`.
- Two new checks make up for losing the allowlist:
  - L15 rejects `is_anonymous === true`. Before, the allowlist was the only thing blocking anonymous Supabase sessions.
  - L16 requires a non-empty string `session_id`.
- `claims.test.ts` tests every branch, including an arbitrary `sub`, `role: service_role`, and `exp == now`.

🟢 **Config** (`apps/web/server/auth/config.ts:10-19`)
- It no longer reads `ALLOWLIST_USER_IDS`.
- It still throws on a URL that isn't `https://<host>` and on an empty anon key.
- The issuer is built from the validated URL, so it can't be injected.

🟢 **`forbidden` / `authInterrupts` are fully gone**
- `apps/web/next.config.ts` has no `experimental` block.
- `app/forbidden.tsx` no longer exists.
- Searching for `forbidden` in `apps/web` finds only unrelated test constants.

🟢 **Proxy** (`apps/web/proxy.ts:13-34`)
- Only the comment changed. It is still a coarse gate (L28-31): `getClaims` must succeed, or the request is redirected to login.
- An anonymous token gets past the proxy, but `requireUser()` stops it at the page. `/login` is public and redirects away only on `ok` (`login/page.tsx:10`), so there is no redirect loop.
- The `x-stoktok-path` header and `next` pass through `safeNext` (`login-path.ts:2-13`), so there is no open redirect.

🟢 **Login action** (`apps/web/app/login/actions.ts:14-31`) is unchanged. Inputs are type- and length-checked, every failure goes to the same generic error, and the redirect target goes through `safeNext`. It accepts any valid password user, and `requireUser` applies the claim checks on the next request. That is the intended design.

🟢 **R6 coverage did not regress.** All 15 `(app)` pages and all 12 exported server actions call `requireUser()` (counted with grep).

🟢 **The database does not depend on the allowlist** (`supabase/migrations/20261023000200_v1_rls_grants.sql:6-19` plus each later migration)
- Every table has RLS on with no policies, and `anon` and `authenticated` are revoked.
- A second Auth user who takes the JWT from their own cookie still cannot read tables through PostgREST.
- The exposure is through the app only, which is the risk Ming accepted.

🟢 **Draft workflow** (`deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:155-208`)
- No allowlist mapping, check or printf field remains.
- The env file is still written safely:
  - `umask 077`, a mktemp file in a mode-700 directory, written with the bash builtin `printf` (L196; no argv to an external command, no echo).
  - `chmod 600`, an atomic `mv`, then an owner/mode check.
  - The trap removes the temp file on failure.
- Error messages name secrets only, never values (L172-189). There is no secret value anywhere in the file.

🟢 **`.env.example`** lists names only, has no `NEXT_PUBLIC_*` keys, and has no allowlist key (R3 is met).

🟢 **`docs/deploy.md` access-control and deploy order**
- The checklist (L56-64) is marked required. It covers: sign-ups off, anonymous sign-ins off, all other providers off, confirm email on, password length 12+, redirect URLs locked, and a check that the Users list holds only Ming.
- The order section (L71-81) gets the direction right: new image first, then the workflow, then delete the secret. It also has the rollback warning.

🟡 **Make sure the "unexpected user" follow-up exists** (plan Risk 2, consult Risk 2)
- The dashboard checklist is now the only access control, and nothing alerts if it drifts (a sign-up toggle flipped back, an added provider, an extra user).
- Before DONE, confirm a `debt` issue (`project:stoktok`) is opened for one of these:
  - log the `sub` on successful sign-in, or
  - add an alert when a `sub` differs from the expected one, e.g. a stored known-user ID checked in the worker, or an Auth-users count check.
- Without it, a misconfiguration goes unnoticed until the data has already been exposed.

🟡 **Small gaps in the checklist** (`docs/deploy.md:57-64`)
- Add "Allow manual linking: off" and "Web3 / wallet sign-in: off". They are separate toggles in newer Supabase dashboards and can create or attach identities.
- Add "Enable MFA for Ming's account if the plan allows". Optional, but the app now has a single password factor behind Cloudflare Access.
- These are docs only, but they belong to the required checklist from AC5.

🟢 **Literal AC7 violation that the plan intended**
- `ALLOWLIST_USER_IDS` still appears in `apps/web/server/auth/config.test.ts:12,15` (the "unset or junk is ignored" test the plan asked for) and in `docs/deploy.md:73,75` (the migration-order steps).
- These are needed. The reviewer should accept them as intended and note the gap between the AC wording and the plan, not count them as failures.

🟢 **Stale lines in `docs/deploy.md`, out of scope**
- L15 still says "No auth code is in the app (R6 suspended)".
- L21 (D4) says the env file "holds only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`", but the workflow now writes four keys.
- L38 says "If either secret" where there are four.
- The plan already lists L15 as a follow-up. Add L21 and L38 to the same debt issue. They are misleading but not exploitable.

🟢 **No in-app rate limit on `/login`.** This is unchanged by STK-060. Supabase Auth's own rate limits and Cloudflare Access in front make up for it.

### Recommendations
1. Open the `debt` issue for "unexpected user" logging or alerts before the PR (consult Risk 2; CLAUDE.md §8 debt rule).
2. Add the manual-linking, Web3 and MFA items to the `deploy.md` checklist (AC5).
3. Reviewer: treat the `config.test.ts` and `deploy.md` `ALLOWLIST_USER_IDS` hits as the intended exceptions to AC7.

### Risks
- **Configuration is the only boundary now.** Any account in the stoktok Auth project gets full access through the app's service-role reads. Ming accepted this. It is safe only while the dashboard settings hold, and nothing checks them automatically yet.
- **Deploy order.** A pre-STK-060 auth image running under the new workflow locks Ming out, and `/healthz` still reports healthy, so the deploy doesn't roll back. This is documented. The rollback warning in `deploy.md:79` is the only safeguard.
- **`session_id` check (plan Default 2).** If a real Supabase token ever lacked `session_id`, every login would fail. That would show at the first login and nothing would be exposed. It is fail-closed, so it is accepted.

### Open questions
None that block. Should the MFA item be required or optional? Default: optional, because Cloudflare Access already adds an email factor.

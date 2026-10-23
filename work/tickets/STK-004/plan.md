Status: BLOCKED

# Plan — STK-004: Authen login and allowlist on the Next.js server

> Blocked on Q1–Q4 under **Blocking questions**: how Authen hands the token over, how it is signed, and the login URL. Every other part of the plan is fixed. Where the code depends on an answer, the plan shows **Variant A / Variant B** or a **⟨Qn⟩** placeholder. Once Ming answers, delete the variants that don't apply, fill in the placeholders, and set `Status: READY`. No other replanning is needed.

## Spec summary
- `docs/spec-v1.md` §1.2: "**v1: Ming only.** Login via Authen (shared mmlabs SSO), restricted by an allowlist."
- §4.1: "`web` | Next.js UI and API routes; reads/writes app DB; verifies Authen JWT + allowlist".
- §4.2: "Login through Authen; `web` validates the shared JWT." / "Allowlist check (Ming's user ID) on every request — v1 rejects all other authenticated mmlabs users." / "App data lives in a **separate Supabase project**; it never stores data in the shared auth project."
- §9 Open question 1: "JWT trust between Authen and the app's separate Supabase project (shared secret vs server-side checks)."
  - STK-003 already settled the DB side: RLS is on, there are no policies, and anon/authenticated are revoked (`supabase/migrations/20261023000200_v1_rls_grants.sql`). Access goes through the service role plus app-level checks.
  - What is still open is how `web` **receives** and **verifies** the token (Q1–Q2).
- `CLAUDE.md` R3: "Service role key is server-only … Never in `NEXT_PUBLIC_*`, never in client bundles." R6: "Every server route / server action verifies the Authen JWT and the allowlist."
- `docs/figma-make-prompts.md:37`: "No login screen — authentication is handled outside this app."

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | One server-only helper `requireUser()` verifies the Authen JWT (signature, issuer, audience, expiry) and the allowlist from `ALLOWLIST_USER_IDS`. It is the single entry point used by pages, route handlers and server actions. | `apps/web/lib/auth/require-user.ts` starts with `import 'server-only'`. `verify.test.ts` passes. `entrypoints.test.ts` passes: it scans every `page.tsx`, `route.ts` and `'use server'` file under `apps/web/app` and fails if a non-public one does not call `requireUser(`. Grep: `jwtVerify` is called in `lib/auth/verify.ts` only. |
| 2 | Next.js middleware protects every route except an explicit public list (auth callback, health check). | `apps/web/proxy.ts` exists. Next 16.4.2 renamed `middleware.ts` to `proxy.ts` (confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). Its `matcher` excludes only `_next/static`, `_next/image` and `favicon.ico`. `PUBLIC_PATHS` is an exported constant. Tests in `proxy.test.ts` pass. |
| 3 | Unauthenticated request → redirect to Authen login. Authenticated but not allowlisted → 403 page. Nothing else is rendered or queried. | `proxy.test.ts` checks that a request without a token gets a 307 to `⟨Q3 login URL⟩` with the return-to parameter, and that a bad or expired token does the same. `require-user.test.ts` checks that unauthenticated calls `redirect(loginUrl)`, forbidden calls `forbidden()`, and both throw before the caller's code runs. Manual check: `pnpm --filter @stoktok/web dev`; `curl -i localhost:3000/` without a cookie returns 307 to login; with a valid non-allowlisted token it returns 403 and the `app/forbidden.tsx` text. |
| 4 | No secret or service role key reaches client bundles, and there are no `NEXT_PUBLIC_*` auth secrets (R3). | `pnpm build`, then `grep -rE "AUTHEN_|SERVICE_ROLE|ALLOWLIST" apps/web/.next/static` returns no matches. `grep -rn "NEXT_PUBLIC_" apps/web .env.example` returns no matches. Every module under `lib/auth/` that reads env imports `'server-only'`. |
| 5 | Unit tests for the helper: valid token, expired, wrong issuer/audience, bad signature, not allowlisted, missing token. | `pnpm test` is green, and the named tests in **Tests to write** exist in `apps/web/lib/auth/verify.test.ts`. |
| 6 | `.env.example` is updated to the final auth keys, replacing the provisional ones. | `.env.example` has the keys listed in Approach step 7. The "provisional" comment is gone. `AUTHEN_JWT_SECRET` is removed (unless Q2 = HS256). |
| — | Repo gates (R8) | `pnpm typecheck && pnpm lint && pnpm test` are green. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/web/package.json` | Add deps `jose` and `server-only`. Add devDep `vitest` (same `^5.0.5` as core). Add script `"test": "vitest run"`. | JWT/JWKS verification, the server-only guard, and AC5 tests. The web app has no test runner yet. |
| `pnpm-lock.yaml` | Updated by `pnpm install`. | New dependencies. |
| `apps/web/vitest.config.ts` | New file. `include: ['**/*.test.ts']`, `environment: 'node'`. Alias `server-only` to an empty stub so server modules can be imported in tests. | AC5 |
| `apps/web/test/server-only-stub.ts` | New empty module, used by the alias above. | AC5 |
| `apps/web/lib/auth/config.ts` | New file, `'server-only'`. `loadAuthConfig(env = process.env)` reads and validates the auth env, parses the allowlist, and **throws when anything is missing** (fail closed). It is memoised. | AC1, AC6. Rule R5-style: values come from configuration. |
| `apps/web/lib/auth/verify.ts` | New file. Pure function `verifyAuthenToken(token, deps)`, which returns `{ ok: true, userId }` or `{ ok: false, reason: 'unauthenticated' \| 'forbidden' }`. `deps` holds `{ key, issuer, audience, algorithms, allowlist, clockToleranceSec }`. It has no env access and no Next imports, so it can be unit-tested. | AC1, AC5 |
| `apps/web/lib/auth/token-source.ts` | New file, `'server-only'`. `readAuthenToken(cookies)` takes a `{ get(name) }` cookie store (from `next/headers` or `NextRequest.cookies`) and returns the raw JWT or `undefined`. **Variant A:** reads the Authen cookie in its ⟨Q1⟩ format. **Variant B:** reads the stoktok-owned cookie `stoktok_session`. | AC1, AC3 |
| `apps/web/lib/auth/login-url.ts` | New file. `buildLoginUrl(loginBase, appOrigin, returnPath, paramName)`. It accepts only a relative `returnPath` starting with `/` and not `//`; anything else becomes `/`. This prevents an open redirect. | AC3 |
| `apps/web/lib/auth/require-user.ts` | New file, `'server-only'`. `authenticate()` reads the token with `cookies()` and runs `verifyAuthenToken` with the remote JWKS. `requireUser(): Promise<{ userId: string }>` calls `redirect(loginUrl)` when unauthenticated and `forbidden()` when forbidden. This is the single entry point. | AC1, AC3, R6 |
| `apps/web/proxy.ts` | New file. Exports `PUBLIC_PATHS`, `isPublicPath(pathname)` and `proxy(request)`. Public path → `NextResponse.next()`. Otherwise it runs `verifyAuthenToken` on the request cookie: unauthenticated → 307 to login; anything else → `next()`, and the page's `requireUser()` renders the 403. The matcher excludes `_next/static`, `_next/image` and `favicon.ico`. | AC2, AC3 |
| `apps/web/next.config.ts` | Add `experimental: { authInterrupts: true }`. | `forbidden()` and `app/forbidden.tsx` need this flag in Next 16.4.2 (`docs/.../04-functions/forbidden.md`). AC3 |
| `apps/web/app/forbidden.tsx` | New file. Static 403 UI in Vietnamese ("Không có quyền truy cập", plus a short line saying the account is not allowed). It reads no data. | AC3 |
| `apps/web/app/page.tsx` | Add `await requireUser()` as the first statement, and make the component `async`. | AC1, AC3: the existing page must be protected. |
| `apps/web/app/api/health/route.ts` | New file. `GET` returns `200 { ok: true }`. No auth, no DB, no env. | AC2 names the health check as public. Deploy needs it. |
| `apps/web/app/auth/callback/route.ts` | **Variant B only.** Validates `state` against a short-lived HttpOnly state cookie and receives the token or code using the ⟨Q1b⟩ contract. Verifies the token with `verifyAuthenToken`, sets `stoktok_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`, host-only, `Max-Age` = token `exp`), then redirects to the validated return path. | AC2, AC3 |
| `apps/web/lib/auth/verify.test.ts` | New file. Unit tests for the verifier. | AC5 |
| `apps/web/lib/auth/config.test.ts` | New file. Tests env and allowlist parsing, including fail-closed. | AC1, AC6 |
| `apps/web/lib/auth/login-url.test.ts` | New file. Tests the return-to handling. | AC3 |
| `apps/web/lib/auth/require-user.test.ts` | New file. Mocks `next/navigation` and `next/headers` with `vi.mock` and tests how each outcome maps to `redirect` or `forbidden`. | AC1, AC3 |
| `apps/web/proxy.test.ts` | New file. Tests public paths, the redirect when there is no token, and pass-through with a valid token. | AC2, AC3 |
| `apps/web/lib/auth/entrypoints.test.ts` | New file. A filesystem scan that makes sure every entry point calls `requireUser`. | AC1, R6 |
| `.env.example` | Replace the provisional Authen block with the final keys. | AC6 |

Variant B also adds `apps/web/app/auth/callback/route.test.ts` (state mismatch → 400; good exchange → cookie set and redirect). Estimated diff: about 350 changed lines including tests (about 420 with Variant B). That is within one cycle.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `verify.test.ts › accepts a valid token from an allowlisted user and returns its sub` | AC5 valid |
| `verify.test.ts › rejects an expired token as unauthenticated` | AC5 expired |
| `verify.test.ts › rejects a token whose nbf is in the future beyond clock tolerance` | expiry or nbf edge |
| `verify.test.ts › accepts a token expired by less than clockToleranceSec` | tolerance edge |
| `verify.test.ts › rejects wrong issuer` | AC5 |
| `verify.test.ts › rejects wrong audience` | AC5 |
| `verify.test.ts › rejects a token signed by a different key (bad signature)` | AC5 |
| `verify.test.ts › rejects alg none and HS256 tokens when asymmetric algorithms are pinned` | algorithm-confusion guard |
| `verify.test.ts › rejects malformed token string` | robustness |
| `verify.test.ts › rejects a token without sub` | robustness |
| `verify.test.ts › returns forbidden for a valid token whose sub is not allowlisted` | AC5 not allowlisted |
| `verify.test.ts › returns unauthenticated for missing/empty token` | AC5 missing |
| `verify.test.ts › returns forbidden for everyone when allowlist is empty` | fail closed |
| `config.test.ts › parses ALLOWLIST_USER_IDS trimming spaces and dropping empties` | allowlist parsing |
| `config.test.ts › throws when a required auth key is missing` | fail closed, AC6 |
| `config.test.ts › throws when ALLOWLIST_USER_IDS is empty or unset` | fail closed |
| `login-url.test.ts › appends encoded absolute return URL under the configured param` | AC3 |
| `login-url.test.ts › replaces external or protocol-relative return paths with /` | open-redirect guard |
| `require-user.test.ts › returns userId when verification succeeds` | AC1 |
| `require-user.test.ts › calls redirect(loginUrl) when unauthenticated` | AC3 |
| `require-user.test.ts › calls forbidden() when not allowlisted` | AC3 |
| `proxy.test.ts › lets PUBLIC_PATHS through without a token` | AC2 |
| `proxy.test.ts › redirects a protected path without token to Authen login with return-to` | AC2, AC3 |
| `proxy.test.ts › redirects a protected path with an expired token` | AC3 |
| `proxy.test.ts › passes a protected path with a valid token` | AC2 |
| `entrypoints.test.ts › every non-public page, route handler and server action calls requireUser` | AC1, R6 |

Tests generate a key pair locally with `jose.generateKeyPair('ES256')`, sign tokens with `SignJWT`, and pass `createLocalJWKSet({ keys: [publicJwk] })` as `deps.key`, so no network is used. If Q2 = HS256, the "bad signature" test signs with a different secret, and the algorithm-pinning test checks that RS256/ES256/none are rejected.

## Approach
1. **Dependencies and test runner.** Add `jose`, `server-only` and `vitest` to `apps/web`. Add the `test` script, `vitest.config.ts` and the `server-only` alias stub. The root `pnpm test` already runs `pnpm -r --if-present test`, so it picks up the web tests.
2. **`config.ts`** (server-only). Read the keys from step 7.
   - Derive `issuer` = `AUTHEN_ISSUER` and `jwksUrl` = `AUTHEN_JWKS_URL`. Both are explicit, so nothing is guessed from the URL shape.
   - Read `audience`, `loginUrl`, `returnParam`, `cookieName`, and `allowlist: ReadonlySet<string>` (split on `,`, trim each value, drop empty values).
   - Throw a descriptive error if any value is missing or the allowlist is empty. When the error is thrown inside `requireUser`/proxy, the request is denied, never allowed.
3. **`verify.ts`** (pure).
   - Return `unauthenticated` if the token is empty.
   - Call `jwtVerify(token, deps.key, { issuer, audience, algorithms, clockTolerance: 30 })`. Default `algorithms` = `['ES256', 'RS256']` (Variant HS256: `['HS256']` with `deps.key` = secret bytes). `jose` enforces `exp` and `nbf`. Require `exp` to be present.
   - Any `jose` error → `unauthenticated`. A missing or non-string `sub` → `unauthenticated`.
   - A `sub` that is not in the allowlist → `forbidden`. Otherwise return `{ ok: true, userId: sub }`.
   - Never log the token.
4. **`token-source.ts`.**
   - **Variant A** (Authen's shared cookie, Supabase SSR style): read `⟨cookieName⟩`. If chunked, join `⟨cookieName⟩.0`, `.1`, …. Strip the `base64-` prefix and base64url-decode it, `JSON.parse` the result, and return `access_token`. If the cookie is a raw JWT instead, return it as is. Any parse failure → `undefined`.
   - **Variant B:** read `stoktok_session` as a raw JWT.
5. **`require-user.ts`.**
   - `getJwks()` is a module-level memoised `createRemoteJWKSet(new URL(jwksUrl))`, which handles caching, rotation and `kid` lookup.
   - `authenticate()` loads the config, reads the token through `cookies()` and returns the `verify` result.
   - `requireUser()`: `unauthenticated` → `redirect(buildLoginUrl(...current path...))`; `forbidden` → `forbidden()`; ok → `{ userId }`. The current path comes from a header set by the proxy (`x-stoktok-path`), with `/` as the fallback.
   - JWKS fetch failure → the token is treated as unauthenticated, so the request fails closed. There is no infinite loop because Authen issues a fresh token, and the next request retries the JWKS fetch.
   - Pages, route handlers and server actions all call `requireUser()`. Next documents that `redirect` and `forbidden` work in all three. There is no second helper.
6. **`proxy.ts`.**
   - `PUBLIC_PATHS = ['/api/health']`, plus `'/auth/callback'` in Variant B.
   - `forbidden.tsx` is a file convention, not a route, so nothing else needs to be public. That avoids the login-loop risk.
   - For non-public paths the proxy runs the same `verifyAuthenToken`. Unauthenticated → 307 to the login URL. Otherwise it forwards with the `x-stoktok-path` request header.
   - The proxy is a coarse gate. The security boundary is `requireUser()` (Next's proxy doc, line 249–251, says to verify inside each Server Function).
   - `config.matcher = ['/((?!_next/static|_next/image|favicon.ico).*)']`.
7. **`.env.example`** final auth block, with no `NEXT_PUBLIC_` keys and a comment that all of them are server-only:
   ```
   AUTHEN_ISSUER=            # e.g. https://<authen-ref>.supabase.co/auth/v1   ⟨Q2⟩
   AUTHEN_JWKS_URL=          # e.g. <AUTHEN_ISSUER>/.well-known/jwks.json      ⟨Q2⟩
   AUTHEN_AUDIENCE=          # default: authenticated                            ⟨Q4⟩
   AUTHEN_LOGIN_URL=         # Authen login page                                 ⟨Q3⟩
   AUTHEN_RETURN_PARAM=      # query param Authen reads for the return URL       ⟨Q3⟩
   AUTHEN_COOKIE_NAME=       # Variant A only                                    ⟨Q1⟩
   APP_ORIGIN=               # public origin of stoktok, used to build absolute return URLs
   ALLOWLIST_USER_IDS=       # comma-separated Authen user IDs (JWT sub)        ⟨Q5⟩
   ```
   - Remove `AUTHEN_SUPABASE_URL` and `AUTHEN_JWT_SECRET`.
   - If Q2 = HS256: drop `AUTHEN_JWKS_URL` and keep a server-only `AUTHEN_JWT_SECRET`. Add a follow-up to migrate to signing keys.
   - Leave the DB and LLM keys unchanged.
8. **Protect the existing page.** Add `app/forbidden.tsx` and `api/health`, and set `authInterrupts` in `next.config.ts`.
9. **Variant B only:** add the callback route described in the file list.
10. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the bundle grep from AC4.

Rules:
- **R1:** auth is a delivery concern, so it stays in `apps/web`. There are no financial calculations here.
- **R2:** not applicable.
- **R3:** every module that reads env imports `'server-only'`. There are no `NEXT_PUBLIC_` keys. The service role key is not touched.
- **R5:** login, issuer, audience and cookie name are configuration.
- **R6:** a single `requireUser()`, enforced by `entrypoints.test.ts`.
- **R7:** no refresh flow, no logout UI, no app-specific claim checks. These go to follow-ups.
- **R8:** tests are listed above.
- **R10:** no brokerage login.

## Specialist input used
From `consult-software-architect.md`:
- **Adopted:** use `jose` with `createRemoteJWKSet` and pinned asymmetric algorithms, check iss/aud/exp/nbf with ≤30s tolerance, and inject the key so tests need no network (Rec 1).
- **Adopted:** parse the allowlist with trim, drop empties and fail closed (Rec 1, Risk "Empty allowlist").
- **Adopted:** one `requireUser()` in `apps/web/lib/auth/` with `'server-only'`, kept out of `packages/core` (Rec 2).
  - **Adjusted:** instead of a typed failure plus a 401/403 mapping in each caller, `requireUser()` calls `redirect()`/`forbidden()` itself, because Next 16 supports both in pages, handlers and actions. This keeps a single entry point. `authenticate()` remains as the internal typed result.
- **Adopted:** `proxy.ts` (verified as the Next 16.4.2 name; it runs on Node) as a coarse gate, with `requireUser()` as the real boundary (Rec 3, Risk "Proxy-only checks"). The architect's reviewer-grep idea is turned into an automated test (`entrypoints.test.ts`).
- **Adopted:** two transport variants, a host-only HttpOnly cookie and `state` validation for the callback variant (Rec 4).
- **Adopted:** no refresh flow; on expiry, bounce to Authen (Rec 5). This is the default unless Ming says otherwise.
- **Adopted, with one change:** the env key set from Rec 6, plus `AUTHEN_RETURN_PARAM` and `APP_ORIGIN`. Issuer and JWKS URL are explicit rather than derived from `AUTHEN_SUPABASE_URL`.
- **Adopted:** login-loop avoidance. The callback and health check are on the public list, and the 403 is a file convention, not a route.
- **Not adopted (follow-up):** an app-specific claim check against sibling-app replay (Risk "Shared parent-domain cookie"). It depends on Authen supporting such a claim, which is unknown.

## Assumptions
- Authen is a standard Supabase Auth project. Access tokens are JWTs with `sub` = user UUID, plus `exp`, `iss` and `aud` claims.
- Supabase access tokens last about 1 hour. When one expires, stoktok redirects to Authen, which refreshes the session and sends the user back. stoktok does not refresh tokens itself.
- Using `experimental.authInterrupts` in Next 16.4.2 is acceptable. It is the documented way to get a real 403 status with a `forbidden.tsx` page.
- `APP_ORIGIN` comes from env, not from the `Host` header. Behind Cloudflare Tunnel the Host may be internal, and building redirects from the Host header invites header injection.
- The return URL sent to Authen is absolute (`APP_ORIGIN` + validated path). If Authen wants a relative path, the change is in one function.
- No logout route in this ticket (follow-up).
- The health check returns only `{ ok: true }`. It does not check the DB or env.

## Blocking questions
Ming, one sentence each. The likely default is in brackets; reply "default" to accept it.

1. **Token transport.** How does stoktok receive the Authen token? (a) Authen sets a cookie on `.mmlabs.online`, or (b) Authen redirects back to `https://<stoktok>/auth/callback` with a token or code. If (a): what is the cookie name, and is it the Supabase SSR format (`sb-<ref>-auth-token`, `base64-` JSON, possibly chunked `.0/.1`) or a raw JWT? If (b): what are the query parameter names, is it a token or a code, and how is it exchanged? [Default: (a), Supabase SSR cookie `sb-<authen-ref>-auth-token` on domain `.mmlabs.online`.]
2. **Signing.** Does the Authen Supabase project use the new asymmetric JWT signing keys (JWKS), or the legacy HS256 JWT secret? What is the Authen project URL? [Default: asymmetric (ES256), JWKS at `https://<authen-ref>.supabase.co/auth/v1/.well-known/jwks.json`, issuer `https://<authen-ref>.supabase.co/auth/v1`.]
3. **Login URL.** What URL does stoktok redirect to for login, and which query parameter carries the return URL? Is the return URL absolute, and do stoktok's domain or redirect need to be allowlisted on Authen's side? [Default: `https://authen.mmlabs.online/login?redirect_to=<absolute stoktok URL>`, with the stoktok domain added to Authen's redirect allowlist by Ming.]
4. **Audience/issuer.** Is `aud` the Supabase default `authenticated`, or does Authen issue an app-specific audience? If Authen uses a custom domain, is the issuer different from the `*.supabase.co/auth/v1` URL? [Default: `aud = authenticated`, issuer = `<Authen Supabase URL>/auth/v1`.]
5. **Allowlist key.** Is `ALLOWLIST_USER_IDS` keyed on the Authen JWT `sub` (user UUID), with Ming's UUID supplied through the deploy repo env? [Default: yes.]

Non-blocking (the default is used if there is no answer): token refresh. [Default: no refresh in stoktok; redirect to Authen on expiry.] Also: is there an existing mmlabs app (e.g. CaleChip) whose auth module to match? A path would answer Q1–Q4 at once.

## Split proposal
None. The estimated diff is about 350 lines including tests (about 420 for Variant B), and it is one feature (spec §4.2).

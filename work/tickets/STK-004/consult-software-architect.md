# consult-software-architect — STK-004

**Bottom line:** the repo does not say how the Authen token reaches stoktok, how it is signed, what cookie domain it uses, or what the login URL is. No CaleChip, Authen or other mmlabs source code or docs are in the repo. The word "CaleChip" appears nowhere. Unless Ming answers Q1–Q4 below, the planner should return **BLOCKED**.

## Findings

**Known from the repo (with file references):**
- `docs/spec-v1.md` §1.2: v1 is Ming only. Login is via Authen (shared mmlabs SSO), restricted by an allowlist.
- §4 diagram: "Authen (Supabase Cloud — shared auth only) │ JWT ▼ … web (Next.js)". So Authen is a **separate Supabase project** and it issues a JWT. The diagram does not show how the token is handed over.
- §4.1 and §4.2: `web` "validates the shared JWT" and checks the allowlist (Ming's **user ID**) on every request. App data never goes into the Authen project. §4.2 and §9 Q1 leave open "shared JWT secret vs server-side service role with app-level checks".
- §7: the app runs on a subdomain under `mmlabs.online` behind the Cloudflare Tunnel. The subdomain is not decided yet (roadmap, deploy ticket).
- `docs/figma-make-prompts.md:37`: "No login screen — authentication is handled outside this app." So stoktok redirects to Authen and has no login UI of its own.
- `docs/ticket-roadmap.md:16`: "How Authen hands over and signs the token" is listed as an unresolved input for STK-004.
- `.env.example`: `AUTHEN_SUPABASE_URL` and `AUTHEN_JWT_SECRET` are marked provisional. `ALLOWLIST_USER_IDS` exists. There are no `NEXT_PUBLIC_*` keys.
- STK-001 security review: prefer JWKS/asymmetric verification over a shared HS256 secret. The auth check must exist before any route or server action.
- **§9 Q1 is now mostly answered by STK-003.** RLS is on, there are no policies, and anon/authenticated are revoked (`supabase/migrations/20261023000200_v1_rls_grants.sql`). The app DB never trusts the Authen JWT. Access goes through the service role plus app-level checks in `requireUser()`. What is still open is only **how `web` verifies the token** and **how it receives it**.
- `apps/web` has only `app/layout.tsx` and `app/page.tsx`. There is no middleware/proxy and no auth or JWT library (`jose` and `@supabase/*` are not installed). `next` is `^16.4.2`.

**Assumed, not in the repo:**
- That Authen is a standard Supabase Auth project whose access tokens have `iss = <AUTHEN_SUPABASE_URL>/auth/v1`, `aud = "authenticated"`, and `sub = user UUID`.
- That Authen uses asymmetric JWT signing keys, so a JWKS is published at `<url>/auth/v1/.well-known/jwks.json`. Older Supabase projects use a legacy HS256 shared secret.
- Whether the token arrives as a cookie on `.mmlabs.online` or through a redirect with a token or code.
- That the allowlist identifier is the Authen `sub`.

## Recommendations
1. **Verification (AC1).** Use `jose` `jwtVerify` with `createRemoteJWKSet(AUTHEN_JWKS_URL)`. Pin the algorithms (`ES256`/`RS256`, never `none`/`HS*` on this path) and check `iss`, `aud`, `exp` and `nbf` with a small clock tolerance (≤30s). Then check `sub ∈ ALLOWLIST_USER_IDS`.
   - Inject the key resolver so unit tests (AC5) can sign with a locally generated key pair and need no network.
   - Fallback only if Ming confirms Authen is still on legacy HS256: a server-only `AUTHEN_JWT_SECRET`. That is weaker, because anyone holding the secret can mint tokens. Record it as a follow-up to migrate.
   - Allowlist parsing: trim the values, drop empty ones, and **fail closed** when the list is empty or unset.
2. **One helper (AC1, R6).** Put `requireUser()` in `apps/web/lib/auth/` (or a server-only module), importing `'server-only'`.
   - It returns either `{ userId }` or a typed failure (`unauthenticated` | `forbidden`).
   - Pages call it and use `redirect()` or `forbidden()`/render the 403 page. Route handlers map the failure to 401/403. Server actions throw.
   - Keep it out of `packages/core`: core is domain logic (R1), and auth is a delivery concern.
3. **Edge gate (AC2).** Next 16 renamed `middleware.ts` to `proxy.ts`, which runs on the Node runtime. The planner should confirm which name the installed version uses.
   - Treat the proxy as a **coarse gate only**: if there is no token, redirect to Authen login with a `return_to` parameter. Do the full verification there too if that is cheap.
   - `requireUser()` must still run in every page, handler and action. Proxy matchers are easy to bypass through matcher gaps and server-action POSTs, so the proxy is not the security boundary.
   - Public list: `/auth/callback` (if a redirect flow is used), `/api/health`, and `_next/static`/`favicon`.
4. **Token transport.** Do whichever matches Authen's actual flow.
   - Shared cookie on `.mmlabs.online`: read it server-side. No callback route is needed.
   - Redirect with a code or token: add a callback that validates `state`, then sets a stoktok-owned cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, host-only). Never accept a token from a URL fragment or query string beyond that single exchange.
   - Either way, the browser never calls the stoktok DB (R3).
5. **Refresh.** Supabase access tokens expire in about 1 hour. If Authen owns the refresh (shared cookie), redirect to Authen on expiry. Do not implement a refresh flow in stoktok unless Ming specifies one. Anything more is a follow-up (R7).
6. **Env (AC6, R3).** Proposed final keys:
   - `AUTHEN_ISSUER`
   - `AUTHEN_JWKS_URL` (or derive both from `AUTHEN_SUPABASE_URL`)
   - `AUTHEN_AUDIENCE=authenticated`
   - `AUTHEN_LOGIN_URL`
   - `AUTHEN_COOKIE_NAME`
   - `ALLOWLIST_USER_IDS`

   Drop `AUTHEN_JWT_SECRET` unless the HS256 fallback is confirmed. None of these may be `NEXT_PUBLIC_*`. Validate them at startup and fail closed.

## Risks
- **Guessing the transport or signing scheme.** The code could work in tests and fail against the real Authen. It could also accept tokens it shouldn't if the issuer or audience is wrong. This is the main reason to block rather than assume.
- **Shared parent-domain cookie.** Every mmlabs app on `.mmlabs.online` can read the same token, so a compromised sibling app gives access to stoktok. The allowlist reduces this, but tokens that other apps can replay are still valid here. Consider checking an app-specific claim if Authen supports one.
- **Proxy-only checks.** Server actions and route handlers can be reached outside the matcher. Mitigation: the reviewer greps that every entry point calls `requireUser()`.
- **JWKS fetch on cold start or during an outage.** Fail closed. `jose` caches keys and handles rotation, so do not hard-code a single `kid`.
- **Empty allowlist env.** Must deny everyone, not allow everyone.
- **Login loop.** If the proxy redirects `/auth/callback` or the 403 page to login, the user loops forever. Put both on the explicit public list.

## Open questions (for Ming)
1. **BLOCKING.** How does the token reach stoktok?
   - (a) Authen sets a cookie on `.mmlabs.online`. If so, what is its name and format: a raw access token, or a Supabase `sb-<ref>-auth-token` JSON/base64 chunked cookie?
   - (b) A redirect back with a code or token. If so, what is the callback contract and the `state` handling?
2. **BLOCKING.** Does the Authen Supabase project use asymmetric JWT signing keys (JWKS available), or the legacy HS256 secret? Please give the Authen project URL or issuer.
3. **BLOCKING.** What are the Authen login URL and the return-to parameter name? What is the expected `aud`? Is it `authenticated`, or does Authen issue an app-specific audience?
4. **BLOCKING (small).** Is `ALLOWLIST_USER_IDS` keyed on the Authen `sub` (UUID)? Please confirm Ming's ID will be supplied through the deploy env.
5. Non-blocking: should stoktok handle token refresh, or always bounce to Authen on expiry?
6. Non-blocking: is there an existing mmlabs app (e.g. CaleChip) whose auth code the planner should copy? It is not in this repo. A path or repo link would answer Q1–Q3 directly.

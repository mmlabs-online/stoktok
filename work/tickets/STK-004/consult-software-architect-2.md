# consult-software-architect (round 2) — STK-004, CaleChip project as identity provider

## Findings
- **CaleChip auth** (`/home/user/didi-code0980/calechip/src/lib/data/supabase.ts:944-958, 2046-2063`): a browser-only `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)`, `auth.signInWithPassword({email,password})` and `auth.signOut()` (the default scope is **global**). It relies on supabase-js's default `persistSession` and `autoRefreshToken`. There is no SSR and no shared cookie, so stoktok has to own the whole session.
- **CaleChip `supabase/config.toml`** (local values only, but they show intent): `enable_signup = true` (lines 178/223), `enable_refresh_token_rotation = true`, `jwt_expiry = 3600`, signing keys commented out. **Anyone can create a CaleChip account and get a valid session**, so the allowlist is the real access control, not a formality.
- **stoktok today**: `apps/web` has no `proxy.ts`/`middleware.ts` and no `@supabase/ssr`. `@supabase/supabase-js ^2.118` is only in `packages/db`. `server/db.ts` already says "call requireUser() at the top of every caller of getDb()". Entry points: `app/(app)/**/page.tsx`, plus `actions.ts` in assets, settings, transactions and watchlist. `/healthz` (`app/healthz/route.ts`) has no imports.
- **Deploy pattern**: the deploy repo secret `STOKTOK_X` is written into `stoktok.env` as `X` (`deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:157-182`, which validates and fails closed). `scripts/check-deploy-env.sh` requires the `.env.example` keys to match the `docs/deploy.md` env table. Both services share one `env_file`.
- **Doc conflict**: `docs/figma-make-prompts.md:37` says "No login screen". Ming's 2026-11-05 note replaces that. The brief should be updated or the conflict flagged.

## Recommendations
1. **Login is a server action, with no browser client** (AC1, R3).
   - Put `app/login/page.tsx` and `app/login/actions.ts` outside the `(app)` group so AppShell doesn't render. Use a plain `<form action={signIn}>`, which works without JS.
   - The action builds `createServerClient(AUTHEN_SUPABASE_URL, AUTHEN_SUPABASE_ANON_KEY, { cookies: { getAll, setAll } })` from `@supabase/ssr` over `await cookies()` and calls `signInWithPassword`.
   - Why not a browser client: it would need `NEXT_PUBLIC_*` keys, would make the browser talk to a Supabase project, and would need non-httpOnly cookies. The cost of the server route is that the password passes through stoktok's server. That is acceptable (it's Ming's own box), but never log form data.
   - Show one Vietnamese error for every auth failure (no enumeration).
   - The post-login `next` must be a relative path that starts with `/` and not `//`, otherwise use `/`.
2. **Cookie** (R3).
   - Set `cookieOptions: { name: 'stoktok-auth', httpOnly: true, secure: NODE_ENV==='production', sameSite: 'lax', path: '/' }`.
   - Leave out `domain` so the cookie is host-only.
   - httpOnly is safe only because no browser client ever needs to read it. `@supabase/ssr` defaults to non-httpOnly, so it must be overridden.
   - A custom name avoids confusion with `sb-<ref>-auth-token`. The value is chunked base64 JSON holding the access and refresh tokens, and `@supabase/ssr` handles that.
   - Put the CaleChip client in its own module (`lib/auth/authen-client.ts`, `import 'server-only'`) so it is never mixed up with `getDb()` (a different project, a different key).
3. **Refresh happens in `proxy.ts`** (Next 16, Node runtime). Server Components can't set cookies.
   - Use the standard Supabase SSR proxy pattern: create the server client with a request→response cookie adapter, call `supabase.auth.getClaims()` (it refreshes an expired access token through the refresh token and writes new cookies through `setAll`), then **return that same response object**.
   - In `requireUser()` on Server Components, make `setAll` a try/catch no-op, because the proxy has already refreshed.
   - Set `Cache-Control: private, no-store` on responses that set cookies (Cloudflare sits in front).
4. **Verification works for both signing modes with no shared secret** (AC1, AC5).
   - Use `supabase.auth.getClaims()`. On a project with asymmetric keys it verifies locally against `<url>/auth/v1/.well-known/jwks.json` (cached). On a legacy HS256 project it falls back to a `getUser()` round trip to CaleChip Auth.
   - So drop `AUTHEN_JWT_SECRET` and `jose`. **Implementer: check this fallback and the `exp` handling on disk** in `node_modules/@supabase/auth-js` (`GoTrueClient.getClaims`) before relying on it.
   - After `getClaims()`, always run a pure `checkClaims(claims, cfg)`:
     - `iss === ${AUTHEN_SUPABASE_URL}/auth/v1`
     - `aud` includes `authenticated` and `role === 'authenticated'`
     - `exp` is present and in the future
     - `sub` is a string and is in the allowlist
   - It returns `ok | unauthenticated | forbidden`.
   - Any error or thrown exception, including a JWKS or Auth outage, means `unauthenticated`. Fail closed.
5. **Allowlist** (AC1): `ALLOWLIST_USER_IDS` holds CaleChip `auth.users.id` UUIDs. Trim the values, drop empty ones, validate the UUID shape, and **throw at config load if it is empty**. A valid session that is not allowlisted renders `forbidden.tsx` ("Không có quyền truy cập") with a logout button. Optionally clear the cookies too.
6. **One gate** (R6): `requireUser()` stays the single entry point and is called first in every page, route handler and server action. The proxy is only a coarse gate and refresher.
   - Public list: `/login` (page and its action), `/healthz`, `_next/static|_next/image|favicon.ico`.
   - An authenticated visit to `/login` redirects to `/`.
   - Keep `entrypoints.test.ts` (scan `page.tsx`/`route.ts`/`'use server'`), with `/login` and `/healthz` as the only exemptions.
7. **Logout**: a server action, never a GET link, that calls `supabase.auth.signOut({ scope: 'local' })` and then `redirect('/login')`. **`scope: 'local'` is required.** The default `global` would revoke Ming's CaleChip sessions on every device.
8. **Env** (AC6, R3, R5). No `NEXT_PUBLIC_*`.
   - App-read names in `.env.example`: `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY` (the CaleChip anon or publishable key, kept server-only even though it isn't secret), `ALLOWLIST_USER_IDS`. Remove `AUTHEN_JWT_SECRET` and the "provisional" comment.
   - Deploy secrets: `STOKTOK_AUTHEN_SUPABASE_URL`, `STOKTOK_AUTHEN_SUPABASE_ANON_KEY`, `STOKTOK_ALLOWLIST_USER_IDS`. `deploy-stoktok.yml` maps them to the unprefixed names, with the same missing and regex checks (https host; `[A-Za-z0-9._-]+`; comma-separated UUIDs).
   - Update the `docs/deploy.md` env table, or `check-deploy-env.sh` fails.
   - Keep the `AUTHEN_` prefix for the role rather than `CALECHIP_`, so a future real SSO is a value change, not a rename.
9. **Cloudflare Access**: keep it in front (defence in depth). Ming logs in twice, which is acceptable.
   - The container healthcheck hits `127.0.0.1:3000/healthz` and never passes through Access.
   - If a CI or public smoke test hits `/healthz` through the tunnel, it needs an Access bypass policy or a service token for that path.
   - Server actions check `Origin` against `Host`. If Host differs behind the tunnel, set `experimental.serverActions.allowedOrigins` to the public host. Do not build redirects from `Host`.
10. **Worker is unaffected.** It never imports `lib/auth`, and the auth keys in the shared `env_file` are inert there. Optionally the planner can add a grep test that `apps/worker` doesn't reference `AUTHEN_`.
11. **Tests** (AC5, R8).
    - Pure `checkClaims` tests: valid, expired, wrong `iss`, wrong `aud`/`role`, missing `sub`, not allowlisted, empty allowlist.
    - Config tests: fail closed, UUID parsing.
    - Signature path: a real supabase-js client with an injected `global.fetch` that serves a local JWKS (a `jose` ES256 key pair, as a devDependency only). Call `getClaims(jwt)` for a valid token, a bad signature (signed by a different key) and an expired token.
    - `requireUser` tests mapping each outcome to `redirect('/login?next=…')` or `forbidden()`.
    - Proxy tests: public paths, redirect when unauthenticated, and that refreshed cookies are copied onto the response.
    - Login and logout action tests with a mocked auth client: the error maps to one message; `signOut` is called with `scope:'local'`; open-redirect guard on `next`.
12. **Ticket wording**: AC2/AC3 "redirect to Authen login" now means "redirect to stoktok `/login`", and "auth callback" in the public list becomes `/login`. The planner should restate these ACs. That is a wording change, not new scope.

## Risks
- **HS256 mode**: every request needs a network round trip to CaleChip Auth (latency, and an outage means a lockout because we fail closed). Asymmetric mode doesn't revoke a session until the token expires (≤1h). Both are acceptable for one user.
- **Brute force**: every attempt reaches Supabase from stoktok's single IP, so Supabase's per-IP limits apply to the server, not the attacker. Cloudflare Access is the real mitigation. Turning Access off before adding rate limiting raises this risk (follow-up).
- **Coupling to CaleChip**: CaleChip changes (key rotation, revoking the legacy secret, disabling the user, a project pause or deletion) lock stoktok out. Refresh-token rotation plus parallel requests can occasionally log Ming out (Supabase reuse interval). That is tolerable.
- **Forgetting `cookieOptions.httpOnly`** or `scope:'local'` gives you, respectively, cookies readable by scripts or a global logout across CaleChip. The reviewer should check both.
- **Login loop**: if `/login` or its action is caught by the proxy matcher, the redirect loops. `forbidden.tsx` must not redirect.
- **Deploy ordering**: once the workflow requires the new secrets, deploys fail until Ming sets them. Set the secrets before merging.

## Open questions (for Ming, none block planning)
1. In the CaleChip dashboard → Project Settings → **JWT Keys**: is the current key "Legacy JWT secret (HS256)" or ECC/RSA? The plan works either way. Migrating CaleChip to ECC P-256 (without revoking the legacy secret) removes the per-request round trip, but it is a CaleChip change, so it is your call.
2. Which key to use: the legacy `anon` JWT or the new `sb_publishable_…` key? Either works server-side.
3. Is it OK that the login form POSTs your CaleChip password through stoktok's server (it is never stored or logged)?
4. Should `/healthz` be reachable through Cloudflare Access (a bypass policy) for an external smoke test, or only from inside the container?
5. On a 403 (a valid CaleChip user who isn't you), should stoktok also clear the cookies automatically, or only show the page with a logout button?

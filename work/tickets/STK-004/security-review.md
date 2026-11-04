# STK-004 security review, attempt 1

## Security review: STK-004 attempt 1

**Verdict: one 🟡 open redirect needs a fix before PASS. Everything else is 🟢: I found nothing critical.** This was a static read of the working tree (the env says it is not a git repo, so I read the touched files rather than a HEAD~1 diff). I also read the installed libraries on disk: `@supabase/auth-js@2.118.0`, `@supabase/ssr@0.12.7` and `next@16.4.2`. I opened no `.env` file other than `.env.example`.

### Findings

**🟡 F1 Open redirect through `next` using a tab or other control character** (CWE-601). Confidence medium-high; a test is needed to confirm.
- **Where:** `/home/user/stoktok/apps/web/server/auth/login-path.ts:3-6`.
- **Problem:** `safeNext` blocks `//`, `/\`, `\r`, `\n` and `\`, but not `\t` or other control characters.
- **Why it works:** browsers and the WHATWG URL parser strip tab, CR and LF *inside* a URL. So `next=/%09/evil.com` passes the check as `"/\t/evil.com"` and the browser then resolves it as `//evil.com`, which is another site.
- **Sinks, all of which pass the value through unchanged:**
  - `app/login/page.tsx:10` (`redirect(safeNext(next))` when already signed in).
  - `app/login/page.tsx:16` (hidden field), which leads to `app/login/actions.ts:30` `redirect(next)` after a successful sign-in.
  - Next sends this raw in `x-action-redirect` or `Location` (`next/dist/server/app-render/action-handler.js:267,874`). Even Next's own `new URL('/\t/evil.com','http://n')` at line 244 resolves the host to `evil.com`.
- **Attack:** send Ming a link to `/login?next=/%09/evil.com`. He signs in and lands on a phishing copy of the site. Cloudflare Access lowers the risk but does not remove it, because Ming can pass Access.
- **Fix (one commit):**
  - Reject `/[\x00-\x20\x7f\\]/` (this covers tab and space too).
  - Better: parse with `const u = new URL(raw, 'https://stoktok.invalid')`, require `u.origin === 'https://stoktok.invalid'`, then return `u.pathname + u.search + u.hash`.
  - Add `'/\t/evil.com'`, `'/\x0b/evil.com'` and `' //evil.com'` to `login-path.test.ts:12`.

**🟢 F2 Server components that refresh the session cannot save the new tokens** (robustness; it fails closed).
- **Where:** `require-user.ts:21` and `login/page.tsx:10` use `canWrite: false`. `getClaims()` → `getSession()` refreshes an expired access token and rotates the refresh token.
- **Where it bites:** on `/login`, which is public, the proxy skips the refresh (`proxy.ts:16`). The rotated tokens there are thrown away.
- **Effect:** a later refresh reuses the old refresh token after Supabase's reuse window. CaleChip then revokes the session and Ming is logged out. This is annoying, not a security hole.
- **Option:** let the proxy refresh on `/login` too, without redirecting. Record it as a follow-up.

**🟢 F3 A failed refresh in the proxy drops the cookie-clearing headers.**
- **Where:** `proxy.ts:29-31`. `toLogin()` builds a new response, so any clearing `Set-Cookie` that `@supabase/ssr` wrote to `ctx.res` is lost.
- **Effect:** the stale cookie stays, and each request makes one failed refresh call to CaleChip.
- **Fix:** copy `ctx.res.cookies` onto the redirect.

**🟢 F4 The entry-point test has blind spots** (`test/entrypoints.test.ts:5,26,30`). All 14 pages and 11 actions are gated today; I checked each one, and each calls `await requireUser()` before reading params or calling `getDb(`. The test, though, would not catch:
- `'use server'` files outside `app/` (for example `components/`).
- Inline `'use server'` inside a function.
- `export const x = async () =>` actions.
- A future `route.ts` that calls `requireUser()` after a data read. The test only looks for the string, not the order.
- **Fix:** walk `apps/web` minus `.next` and `node_modules`, and also match `export const \w+ = async`.

**🟢 F5 Cache headers.** The proxy sets `private, no-store` only when it writes cookies (`proxy.ts:33`). It ignores the cache-header argument that `@supabase/ssr` passes to `setAll` (`authen-client.ts:57`). Next already sends `no-store` on dynamic pages, and Cloudflare does not cache HTML by default, so this is acceptable. Do not add a "Cache Everything" rule on this host.

**🟢 F6 Brute-force and lockout exposure** (already a plan follow-up). There is no rate limit, and every CaleChip sign-in now comes from the home server's single IP. CaleChip's per-IP auth limits therefore apply to everyone together: an attacker who reaches `/login` could exhaust them and lock Ming out. Cloudflare Access makes this unreachable today. Make it a blocker before Access is ever removed.

**🟢 F7 Revocation delay with JWKS.** In asymmetric-key mode, tokens are verified locally. A CaleChip sign-out elsewhere, or a ban, only takes effect when the access token expires (about 1 h). That is acceptable for one user; record it in the ADR.

**🟢 F8 Least privilege.** The worker gets `AUTHEN_*` and `ALLOWLIST_USER_IDS` through the shared `env_file`. It is harmless (the anon key is publishable, and the impl-log already notes it). Use a separate env file later.

### What I verified and found correct (no action needed)
- **`getClaims()` behaviour** (`GoTrueClient.js:5515-5584`, `fetchJwk` at 5418):
  - It checks `exp` itself.
  - With a `kid` and a non-HS algorithm, it verifies locally with WebCrypto against the global JWKS cache.
  - For HS*, a missing `kid` or an unknown `kid`, it falls back to `getUser(token)` on the CaleChip server.
  - `alg: none` or algorithm-confusion tokens end in an error or a non-Auth exception. Both `authenticate()` (`require-user.ts:25`) and the proxy (`proxy.ts:30`) catch these and treat the request as unauthenticated (fail closed).
  - No JWT secret is shared with stoktok.
- **`checkClaims`** (`claims.ts:9-18`): `exp` must be finite and in the future, `iss` must match exactly, `aud` (string or array) must include `authenticated`, `role === 'authenticated'` (rejects anon and service_role), and `sub` must be a non-empty string, lowercased, then checked against the allowlist. Anonymous CaleChip users and sign-ups get 403.
- **Allowlist** (`config.ts:21-27`): trimmed, empties dropped, lowercased, strict UUID check, and it throws if empty. The workflow regex (`deploy-stoktok.yml:193-197`) agrees.
- **Cookie:** `httpOnly: true`, `sameSite: lax`, `path: /`, no `domain` (host-only), `secure` in production (`authen-client.ts:12-18`). I confirmed `@supabase/ssr` spreads these over its defaults (`cookies.js:227-235, 467-475`). The 400-day maxAge is the library default.
- **CSRF:** there are no GET state changes; server actions rely on Next's Origin/Host check plus SameSite=Lax. Do not add `allowedOrigins` wildcards.
- **Login:** one error message for every failure, so no account enumeration (`actions.ts:9-29`). The password is never logged, and errors are swallowed.
- **Logout:** `signOut({ scope: 'local' })`.
- **`x-stoktok-path`:** the proxy overwrites it on protected paths. A spoofed value on public paths can only reach `safeNext`, so it is harmless apart from F1.
- **Proxy matcher:** it only excludes `_next/static`, `_next/image` and `favicon.ico`, and `isPublicPath` is exact or prefix-plus-`/`. There is no hole: anything misclassified falls on the closed side, and every entry point checks again.
- **Secrets in the workflow:** `secrets.` appears only in step env. No echo, no heredoc, no `set -x`. `umask 077`, `mktemp` in a mode-700 dir, `chmod 600`, atomic `mv`, then an owner and mode check. Each value is regex-checked before it is written.
- **R3:**
  - No `NEXT_PUBLIC_` anywhere in `apps/` or `.env.example`.
  - `grep` of `apps/web/.next/static` for `AUTHEN_|SERVICE_ROLE|ALLOWLIST_USER|stoktok-auth|supabase.co` finds nothing.
  - Every auth module imports `server-only`, and there is no `createBrowserClient`.
  - The CaleChip anon key is publishable by design. Treating it as a secret is fine, and it is not a finding.

### Recommendations
1. Fix F1 now and add the tab and control-character test cases. This is the condition for PASS. It belongs to AC3, whose plan row is titled "open-redirect guard".
2. Put F2 and F3 in the follow-ups as one robustness ticket.
3. Harden the entry-point test as in F4 (R6).
4. Make F6 rate limiting a go-live blocker in `docs/deploy.md`, for the moment Access is removed.

### Risks
- With legacy HS256 signing, a CaleChip Auth outage locks Ming out of stoktok. This is expected and fails closed.
- Nobody has done a real sign-in end to end yet; the impl-log says the manual curl check and CaleChip sign-in were not run. Do that before go-live.

### Open questions
- Does CaleChip have anonymous sign-in or open sign-up enabled? It is safe either way because of the allowlist, but it widens who can hold a valid session.
- Which signing mode does CaleChip use (the plan's D1)? It decides whether F7 applies.

Status: READY

# Plan — STK-004: Authen login and allowlist on the Next.js server

> **Replan (2026-11-05 answer from Ming).** "Authen" is the **CaleChip Supabase project**. There is no shared mmlabs SSO, no `.mmlabs.online` cookie and no external login URL. stoktok gets **its own `/login` page**. It signs in server-side against the CaleChip project and keeps the session in an httpOnly cookie on stoktok's own host. The server verifies every request with `supabase.auth.getClaims()` and then the allowlist. All Variant A/B and ⟨Qn⟩ placeholders from the BLOCKED plan are gone. The architect's round-2 open questions are settled below as **planner defaults** (see *Assumptions → Defaults for Ming to confirm in the PR*). None of them blocks the work.
>
> **Restated acceptance criteria (wording change only, not new scope).** Ming's answer removes the external Authen login, so:
> - AC2 "public list (auth callback, health check)" now reads **"public list (`/login`, `/healthz`)"**. There is no callback, because sign-in is a server action on `/login`.
> - AC3 "redirect to Authen login" now reads **"redirect to stoktok `/login`"**, which signs in against the Authen (CaleChip) Supabase project.
> - AC1 "audience" is checked as `aud` includes `authenticated` and `role === 'authenticated'` (Supabase's audience). "Signature" is checked by `getClaims()`. With asymmetric keys it verifies locally against the project JWKS. With legacy HS256 the CaleChip Auth server verifies it (`/auth/v1/user`). Either way no JWT secret is shared with stoktok.
>
> The orchestrator should copy this restatement into `ticket.md` notes. The planner only writes `plan.md`.

## Spec summary
- `docs/spec-v1.md` §1.2: "**v1: Ming only.** Login via Authen (shared mmlabs SSO), restricted by an allowlist."
- §4.1: "`web` | Next.js UI and API routes; reads/writes app DB; verifies Authen JWT + allowlist".
- §4.2: "Login through Authen; `web` validates the shared JWT." / "Allowlist check (Ming's user ID) on every request — v1 rejects all other authenticated mmlabs users." / "App data lives in a **separate Supabase project**; it never stores data in the shared auth project."
- §9 Q1: "JWT trust between Authen and the app's separate Supabase project (shared secret vs server-side checks)."
  - STK-003 settled the DB side: RLS is on, there are no policies, and anon/authenticated are revoked. Access goes through the service role plus app-level checks.
  - Ming's 2026-11-05 answer settles the rest: Authen = the CaleChip Supabase project, verified server-side, with no shared secret.
- `ticket.md` note (Ming, 2026-11-05): "stoktok has **its own login page** that signs in against the CaleChip Supabase project (server-side), stores the session in an httpOnly cookie on stoktok's own domain, and the server verifies the JWT against that project … Project URL, anon key and Ming's user UUID are deploy config (deployment repo environment secrets, `STOKTOK_` prefix) … Cloudflare Access stays in front for now."
- `CLAUDE.md` R3: "Service role key is server-only … Never in `NEXT_PUBLIC_*`, never in client bundles. The browser never talks to the DB directly." R6: "Every server route / server action verifies the Authen JWT and the allowlist." It is currently marked suspended, and this ticket restores it (Ming resumed STK-004).
- **Doc conflicts this ticket resolves:**
  - `docs/figma-make-prompts.md:37` "No login screen — authentication is handled outside this app." Ming's answer supersedes it.
  - `CLAUDE.md` R6 "⏸ Suspended" note.
  - The spec wording "shared mmlabs SSO" / "shared JWT" is now loosely true at most. The role is the same (an external Supabase project plus an allowlist), but the spec text is Ming's to edit, so it is flagged as a follow-up rather than changed here.

## Acceptance criteria → verification
| # | Criterion (restated where marked) | How the reviewer verifies it |
|---|---|---|
| 1 | One server-only helper `requireUser()` verifies the Authen JWT (signature via `getClaims()`, plus `iss`, `aud`/`role`, `exp`) and the allowlist from `ALLOWLIST_USER_IDS`. It is the single entry point used by pages, route handlers and server actions. | `apps/web/server/auth/require-user.ts` starts with `import 'server-only'`. `claims.test.ts`, `get-claims.test.ts`, `config.test.ts` and `require-user.test.ts` pass. `entrypoints.test.ts` passes: every `page.tsx` and `route.ts` under `apps/web/app`, and every `'use server'` file, calls `await requireUser()` (each exported action function does so before `getDb(`). The only exemptions are `app/login/**` and `app/healthz/route.ts`. Grep: `getClaims(` appears only in `server/auth/` and `proxy.ts`. |
| 2 | *(restated)* Next.js proxy (Next 16's name for middleware) protects every route except an explicit public list: `/login` and `/healthz`. | `apps/web/proxy.ts` exists and exports `PUBLIC_PATHS = ['/login', '/healthz']`. The matcher excludes only `_next/static`, `_next/image` and `favicon.ico`. `proxy.test.ts` passes. |
| 3 | *(restated)* Unauthenticated request → redirect to stoktok `/login`. Authenticated but not allowlisted → 403 page. Nothing else is rendered or queried. | `proxy.test.ts`: no cookie, or a failed `getClaims`, gives a 307 to `/login?next=<path>`. `require-user.test.ts`: unauthenticated calls `redirect('/login…')` and forbidden calls `forbidden()`, and both throw before the caller's next line runs (a spy on a fake `getDb` is never called). Manual: `pnpm --filter @stoktok/web dev`; `curl -i localhost:3000/` returns 307 to `/login?next=%2F`; signing in with a non-allowlisted CaleChip user shows "Không có quyền truy cập" with HTTP 403. |
| 4 | No secret or service role key reaches client bundles, and there are no `NEXT_PUBLIC_*` auth secrets (R3). | After `pnpm build`, `grep -rE "AUTHEN_|SERVICE_ROLE|ALLOWLIST|stoktok-auth" apps/web/.next/static` returns nothing. `grep -rn "NEXT_PUBLIC_" apps/web --include=*.ts --include=*.tsx .env.example` returns nothing. Every module in `server/auth/` imports `'server-only'`. No `createBrowserClient` anywhere. The cookie is set with `httpOnly: true` (asserted in `authen-client.test.ts`). |
| 5 | Unit tests for the helper: valid token, expired, wrong issuer/audience, bad signature, not allowlisted, missing token. | `pnpm test` is green, and the named tests in **Tests to write** exist. The signature cases run through a real supabase-js `getClaims(jwt)` against a locally served JWKS, with no network. |
| 6 | `.env.example` is updated to the final auth keys, replacing the provisional ones. | `.env.example` has `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY` and `ALLOWLIST_USER_IDS`. `AUTHEN_JWT_SECRET` and the "provisional" comment are gone. `bash scripts/check-deploy-env.sh` prints `OK`. |
| — | R6 restored in docs and deploy wiring (needed to restore R6; the orchestrator asked for it) | The `CLAUDE.md` R6 row has no "Suspended" text, and the note says it was restored by STK-004. `docs/figma-make-prompts.md:37` no longer says "No login screen". In `deploy-stoktok.yml`, the `secrets` step maps `STOKTOK_AUTHEN_SUPABASE_URL`, `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` and `STOKTOK_ALLOWLIST_USER_IDS`, validates them and writes them. `docs/deploy.md` lists the three secrets and the ordering. `check-deploy-env.sh` passes, and it fails if a "required now" key is not written by the workflow. |
| — | Repo gates (R8) | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` are green, and `bash scripts/check-deploy-env.sh` prints `OK`. |

## Files to create / modify
Conventions: server-only modules live in `apps/web/server/` (as with `server/db.ts`), not `lib/`. The architect's `lib/auth/` path is changed to `server/auth/` to match the codebase.

| File | Change | Required because |
|---|---|---|
| `apps/web/package.json` | Add deps `@supabase/ssr` (latest 0.x) and `@supabase/supabase-js` (`^2.118.0`, same as `packages/db`). Add devDep `jose` (used by tests only, for an ES256 key pair). | AC1, AC5 |
| `pnpm-lock.yaml` | Updated by `pnpm install`. | New deps |
| `apps/web/server/auth/config.ts` | New, `'server-only'`. `loadAuthConfig(env = process.env)` returns `{ supabaseUrl, anonKey, issuer, allowlist: ReadonlySet<string> }`. It **throws** when anything is missing or malformed: the URL must be `https://` with no path; the allowlist must be comma-separated UUIDs, trimmed, empties dropped, lowercased, and non-empty. `issuer` = `${supabaseUrl}/auth/v1`. Memoised per env object. | AC1, AC6, R5 (config, not code) |
| `apps/web/server/auth/claims.ts` | New, pure (no env, no Next, no clock). `checkClaims(claims: unknown, cfg: { issuer, allowlist }, nowSec: number)` returns `'ok' & { userId }`, `'unauthenticated'` or `'forbidden'`. | AC1, AC5 |
| `apps/web/server/auth/authen-client.ts` | New, `'server-only'`. `createAuthenClient(cfg, cookieAdapter)` wraps `createServerClient` from `@supabase/ssr` with `cookieOptions: { name: 'stoktok-auth', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }` (no `domain`) and `auth: { flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false }`. Exports `nextCookieAdapter(store, { canWrite })` for `next/headers` and `requestCookieAdapter(req, getRes)` for the proxy. This is the **only** place that touches the CaleChip project, kept separate from `getDb()`. | AC1, AC4, R3 |
| `apps/web/server/auth/require-user.ts` | New, `'server-only'`. `authenticate()` returns `{ kind: 'ok', userId } \| { kind: 'unauthenticated' } \| { kind: 'forbidden' }`: config → client over `cookies()` (`setAll` is a try/catch no-op) → `getClaims()` → `checkClaims`. Any throw → `unauthenticated`. `requireUser()` returns `{ userId }`, or calls `redirect(loginPath(next))` / `forbidden()`. `next` comes from the `x-stoktok-path` request header set by the proxy. | AC1, AC3, R6 |
| `apps/web/server/auth/login-path.ts` | New, pure. `safeNext(raw)` keeps only a value that starts with `/`, not `//` or `/\`, has no scheme and is not `/login…`; anything else becomes `/`. `loginPath(next)` = `/login?next=<encoded>` (or plain `/login` when next is `/`). | AC3 (open-redirect guard) |
| `apps/web/proxy.ts` | New. Exports `PUBLIC_PATHS`, `isPublicPath`, `proxy(request)` and `config.matcher = ['/((?!_next/static\|_next/image\|favicon.ico).*)']`. A public path returns `NextResponse.next()` **before any config load**, so `/healthz` stays env-free. Otherwise it builds the client with the request→response cookie adapter (the Supabase SSR pattern: `setAll` writes to `request.cookies` and to a recreated `NextResponse.next({ request })`) and calls `getClaims()`, which refreshes. Failure, a throw or missing config → 307 to `loginPath(pathname+search)`. Success → returns **that same response**, with request header `x-stoktok-path` and, when cookies were set, `Cache-Control: private, no-store`. It does not check the allowlist; `requireUser()` does that. | AC2, AC3 |
| `apps/web/next.config.ts` | Add `experimental: { authInterrupts: true }`. | `forbidden()` and `forbidden.tsx` need it (Next 16.4.2 `docs/.../04-functions/forbidden.md`). AC3 |
| `apps/web/app/forbidden.tsx` | New. Static 403 page ("Không có quyền truy cập", "Tài khoản này không được phép dùng stoktok.") and `<LogoutButton />`. No data reads, no redirect. | AC3 |
| `apps/web/app/login/page.tsx` | New (outside `(app)`, so no AppShell). Server component. If `authenticate()` is `ok` → `redirect(safeNext(next))`. Otherwise it renders a plain `<form action={signInAction}>` with fields "Email" and "Mật khẩu", button "Đăng nhập", hidden `next`, and the error line "Đăng nhập không thành công. Kiểm tra email và mật khẩu." when `?error=1`. No sign-up and no reset link. `dynamic = 'force-dynamic'`. | AC2, AC3 |
| `apps/web/app/login/actions.ts` | New, `'use server'`. `signInAction(formData)`: read `email` and `password` as strings (non-empty, ≤ 320 / ≤ 256 chars) → client over `cookies()` with writes allowed → `signInWithPassword`. Any error or throw → `redirect('/login?error=1&next=…')`, one message for every cause. Success → `redirect(safeNext(next))`. Never logs form data. `signOutAction()`: `auth.signOut({ scope: 'local' })` inside try/catch, then `redirect('/login')`. | AC3; logout is needed to leave a 403 session |
| `apps/web/components/shell/logout-button.tsx` | New. `<form action={signOutAction}><button>Đăng xuất</button></form>`. No state, no client JS. | Logout from the shell and the 403 page |
| `apps/web/components/shell/app-shell.tsx` | Render `<LogoutButton />` in the header next to `ThemeToggle`. | Logout reachable |
| `apps/web/app/(app)/page.tsx`, `assets/page.tsx`, `assets/new/page.tsx`, `assets/[id]/edit/page.tsx`, `assets/[id]/delete/page.tsx`, `import/page.tsx`, `settings/page.tsx`, `transactions/page.tsx`, `transactions/new/page.tsx`, `transactions/[id]/edit/page.tsx`, `transactions/[id]/delete/page.tsx`, `transactions/corporate-actions/new/page.tsx`, `watchlist/page.tsx`, `symbols/[symbol]/page.tsx` (all under `apps/web/app/`) | Add `await requireUser();` as the first statement of the default export, and make it `async` where needed. Plus the import. | AC1, AC3, R6 |
| `apps/web/app/(app)/assets/actions.ts`, `settings/actions.ts`, `transactions/actions.ts`, `watchlist/actions.ts` | Add `await requireUser();` as the first statement of each exported action (12 functions). Replace the "R6 is suspended" comment. | AC1, R6 |
| `apps/web/server/db.ts`, `server/dashboard/load-dashboard.ts`, `server/watchlist/load-watchlist.ts`, `server/symbols/load-symbol.ts`, `server/assets/handlers.ts`, `server/watchlist/handlers.ts`, `server/settings/handlers.ts`, `server/transactions/handlers.test.ts` | **Comment only.** Change "R6 is suspended: when it is restored, call requireUser()…" to "Callers must call requireUser() first (R6)." In the transactions test, change the comment to say auth is covered by `entrypoints.test.ts`. | Removes stale R6 notes; no behaviour change |
| `apps/web/server/auth/config.test.ts`, `claims.test.ts`, `get-claims.test.ts`, `login-path.test.ts`, `require-user.test.ts`, `authen-client.test.ts`, `apps/web/app/login/actions.test.ts`, `apps/web/proxy.test.ts`, `apps/web/test/entrypoints.test.ts` | New tests (see below). Each uses `vi.mock('server-only', () => ({}))` as the existing tests do. | AC1–AC5, R8 |
| `.env.example` | Replace the provisional Authen block with the final keys (Approach step 8). | AC6 |
| `docs/deploy.md` | Env table: remove `AUTHEN_JWT_SECRET`; `AUTHEN_SUPABASE_URL` = web, required now, n; add `AUTHEN_SUPABASE_ANON_KEY` = web, required now, y; `ALLOWLIST_USER_IDS` = web, required now, n. Environment step 3: add the three `STOKTOK_` secrets with their formats. Add a **"Restore auth (STK-004) — order"** subsection. In release step 11, change "because the app has no auth" to "Access is the outer layer; stoktok's `/login` is the inner one". In step 12, add the check: after Access, `/login` shows; sign-in with Ming's CaleChip account shows the dashboard; "Đăng xuất" returns to `/login`. | Env/secret mapping, ordering |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | `secrets` step: add env mappings `AUTHEN_SUPABASE_URL: ${{ secrets.STOKTOK_AUTHEN_SUPABASE_URL }}`, `AUTHEN_SUPABASE_ANON_KEY: ${{ secrets.STOKTOK_AUTHEN_SUPABASE_ANON_KEY }}` and `ALLOWLIST_USER_IDS: ${{ secrets.STOKTOK_ALLOWLIST_USER_IDS }}`. Add missing-checks for each, and regexes: URL `^https://[A-Za-z0-9.-]+$`; key `^[A-Za-z0-9._-]+$`; allowlist `^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(,[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})*$`. Extend the single `printf` to write all five keys. Update the header comment (lines 15–17). Keep the existing style: no heredoc, no echo of values, `secrets.` only in step env. | Deploy secret mapping (`STOKTOK_` prefix) |
| `scripts/check-deploy-env.sh` | Add a check: every row in the `docs/deploy.md` env table with Status `required now` must appear as `NAME=` in the workflow's `printf '…'` line and as `NAME: ${{ secrets.STOKTOK_NAME }}`, and the reverse (the workflow writes nothing that is not `required now`). | Keeps the doc table, `.env.example` and the workflow in sync |
| `CLAUDE.md` | R6 row: remove "⏸ **Suspended by Ming (2026-10-23)** — see note below." Replace the suspension note block with a short "R6 restored (Ming resumed STK-004, 2026-11-05)" note: Authen = the CaleChip Supabase project; stoktok `/login`; `requireUser()` in every page, route and action; public list `/login` and `/healthz`; Cloudflare Access stays in front. Stack table "Auth" row: "Authen = CaleChip Supabase project (separate). stoktok's own `/login` signs in server-side; the server verifies via `getClaims()` + allowlist." | Restoring R6 (Ming's decision, recorded in ticket.md). Ming approves it via the PR. |
| `docs/figma-make-prompts.md` | Line 37: replace it with "Login screen: one simple `/login` page (email + password, Vietnamese labels; no sign-up, no password reset). Ming, 2026-11-05." | Resolves the documented conflict |

Size estimate: about 500 changed non-test lines (about 60 of them one-line `requireUser` insertions and comment edits, about 80 of deploy/docs) and about 450 test lines. That is over the ~400 guide, but it is one spec feature (§4.2) and the orchestrator asked to keep the deploy wiring in scope. See **Split proposal**.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `claims.test.ts › ok for valid claims of an allowlisted sub` | AC5 valid |
| `claims.test.ts › unauthenticated when exp is in the past` | AC5 expired |
| `claims.test.ts › unauthenticated when exp is missing or not a number` | expiry edge |
| `claims.test.ts › unauthenticated when iss differs (incl. trailing slash / other project)` | AC5 wrong issuer |
| `claims.test.ts › unauthenticated when aud lacks "authenticated" (string and array forms)` | AC5 wrong audience |
| `claims.test.ts › unauthenticated when role is anon or service_role` | role check (an anon key JWT is not a session) |
| `claims.test.ts › unauthenticated when sub is missing or not a string` | robustness |
| `claims.test.ts › forbidden when sub is valid but not allowlisted` | AC5 not allowlisted |
| `claims.test.ts › allowlist match is case-insensitive` | UUID normalisation |
| `claims.test.ts › unauthenticated for null/undefined/non-object claims` | AC5 missing token |
| `get-claims.test.ts › getClaims(jwt) accepts an ES256 token signed by the served JWKS key` | AC5 valid, signature path |
| `get-claims.test.ts › getClaims(jwt) errors for a token signed by a different key` | AC5 bad signature |
| `get-claims.test.ts › expired ES256 token ends as unauthenticated (getClaims error or checkClaims exp)` | AC5 expired, end-to-end |
| `get-claims.test.ts › HS256 token falls back to /auth/v1/user and a 401 there ends as unauthenticated` | legacy signing mode |
| `config.test.ts › parses ALLOWLIST_USER_IDS trimming spaces, dropping empties, lowercasing` | allowlist |
| `config.test.ts › throws when ALLOWLIST_USER_IDS is empty, unset or has a non-UUID` | fail closed |
| `config.test.ts › throws when AUTHEN_SUPABASE_URL is missing, not https, or has a path` | fail closed, AC6 |
| `config.test.ts › throws when AUTHEN_SUPABASE_ANON_KEY is missing` | fail closed, AC6 |
| `config.test.ts › derives issuer as <url>/auth/v1` | iss |
| `login-path.test.ts › keeps a relative path with query` | AC3 |
| `login-path.test.ts › replaces //evil, /\\evil, https://evil, javascript:, empty and /login with /` | open-redirect guard |
| `authen-client.test.ts › cookie options are httpOnly, sameSite lax, path /, no domain, name stoktok-auth` | AC4, R3 |
| `require-user.test.ts › returns userId when getClaims and checkClaims succeed` | AC1 |
| `require-user.test.ts › redirects to /login?next=<x-stoktok-path> when there is no session` | AC3, missing token |
| `require-user.test.ts › redirects to /login when getClaims throws (Auth/JWKS outage)` | fail closed |
| `require-user.test.ts › redirects to /login when auth config is missing` | fail closed |
| `require-user.test.ts › calls forbidden() when not allowlisted, and the caller's next line never runs` | AC3 |
| `proxy.test.ts › lets /login and /healthz through without a cookie and without auth env` | AC2, healthz env-free |
| `proxy.test.ts › redirects a protected path with no session to /login?next=<path+search>` | AC2, AC3 |
| `proxy.test.ts › redirects when getClaims returns an error` | AC3 |
| `proxy.test.ts › passes a valid session through and copies refreshed cookies onto the returned response` | refresh |
| `proxy.test.ts › sets Cache-Control private, no-store when cookies are written` | Cloudflare caching |
| `actions.test.ts › signInAction redirects to safeNext(next) on success` | login |
| `actions.test.ts › signInAction redirects to /login?error=1 for any auth error and for empty fields` | one message, no enumeration |
| `actions.test.ts › signInAction never passes form data to console` | no password logging |
| `actions.test.ts › signOutAction calls signOut({ scope: 'local' }) and redirects to /login` | no global CaleChip logout |
| `entrypoints.test.ts › every page.tsx and route.ts outside /login and /healthz calls await requireUser()` | AC1, R6 |
| `entrypoints.test.ts › every exported function in non-login 'use server' files calls await requireUser() before getDb(` | AC1, R6 |

Test technique for `get-claims.test.ts`:
- Generate an ES256 pair with `jose.generateKeyPair('ES256')`, export the public JWK with a `kid`, and sign tokens with `SignJWT` (`iss` = `https://test.supabase.co/auth/v1`, `aud: 'authenticated'`, `role: 'authenticated'`).
- Create `createClient('https://test.supabase.co', 'anon', { global: { fetch: fakeFetch }, auth: { persistSession: false } })`. `fakeFetch` serves `/auth/v1/.well-known/jwks.json` and `/auth/v1/user`. Call `auth.getClaims(jwt)`.
- Use a fresh client per test so the JWKS cache doesn't leak between tests.
- Other modules mock `next/headers`, `next/navigation` and the `authen-client` factory with `vi.mock`.

## Approach
1. **Verify the libraries on disk first.** After `pnpm install`, read `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` (`getClaims`) and `@supabase/ssr` (`createServerClient`, `cookieOptions`) and confirm four things:
   - (a) with a `kid` and alg ES256/RS256 it fetches `<url>/auth/v1/.well-known/jwks.json` and verifies locally;
   - (b) with HS256 or no `kid` it falls back to `getUser()`;
   - (c) whether it rejects an expired `exp` itself (`checkClaims` checks it anyway);
   - (d) `cookieOptions.name` sets the storage key and `httpOnly` is honoured.
   
   Record the findings in `impl-log.md`. If (a) or (b) does not hold, stop and record it; the reviewer escalates.
2. **`config.ts`, `claims.ts`, `login-path.ts`**: pure or nearly pure modules with their tests.
   - `checkClaims` takes `nowSec` from the caller. `require-user.ts` and `proxy.ts` pass `Math.floor(nowInstant()/1000)`, or the equivalent from `server/clock.ts`. No `Date.now()` under `app/**/*.tsx` (the R1 test bans it).
3. **`authen-client.ts`**: a single factory plus two cookie adapters. Use `httpOnly: true` and leave out `domain`. There is no browser client anywhere.
4. **`require-user.ts`**: `authenticate()`/`requireUser()` as listed. Every exception means `unauthenticated` (fail closed). Never log tokens or cookies; log only an error *kind* such as `auth: config invalid` or `auth: getClaims failed`.
5. **`proxy.ts`**: check the public path first; then `getClaims()` with the request→response adapter; return the same response object. No allowlist check in the proxy (a coarse gate only). The proxy doc says to verify inside each Server Function, and `requireUser()` is the boundary.
6. **Login, logout and 403**: `app/login/page.tsx` and `actions.ts`, `app/forbidden.tsx`, `LogoutButton`, `authInterrupts`.
   - `forbidden.tsx` does not redirect, and `/login` is public: no login loop.
   - `/login` with a valid allowlisted session → redirect to `next`. A forbidden session sees the form, so it can sign in as another account or log out.
7. **Gate every entry point**: 14 pages and 12 actions, then `entrypoints.test.ts`.
   - Pages are gated at page level, not in `(app)/layout.tsx`, because layouts don't guard actions or parallel page renders.
   - `app/healthz/route.ts` stays unchanged; `healthz.test.ts` already asserts it has no imports.
8. **`.env.example`** auth block (no `NEXT_PUBLIC_`):
   ```
   # Authen = CaleChip Supabase project (identity only; server-only, R3). STK-004.
   AUTHEN_SUPABASE_URL=          # https://<calechip-ref>.supabase.co (no path, no trailing slash)
   AUTHEN_SUPABASE_ANON_KEY=     # CaleChip anon (legacy JWT) or sb_publishable_ key; read by web server code only
   # Allowlist: comma-separated CaleChip auth.users.id UUIDs (JWT sub). Empty = nobody can log in.
   ALLOWLIST_USER_IDS=
   ```
   Remove `AUTHEN_JWT_SECRET` and the "provisional" comment. Leave the DB and LLM keys unchanged.
9. **Deploy wiring**: update the workflow `secrets` step, the `docs/deploy.md` table and sections, and `check-deploy-env.sh` as listed. **Ordering, written into `docs/deploy.md`:**
   1. Ming sets `STOKTOK_AUTHEN_SUPABASE_URL`, `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` and `STOKTOK_ALLOWLIST_USER_IDS` in the deployment repo environment **`stoktok`**.
   2. Ming merges the deployment-repo PR that carries the updated `deploy-stoktok.yml`. A workflow-file change alone does not trigger the deploy (paths filter is `apps/stoktok/**`), so run `workflow_dispatch` on `main` once to rewrite `stoktok.env`.
   3. Only then cut the release that contains STK-004.
   
   If step 2 runs before step 1, `deploy-stoktok` stops at `secrets`, names the missing secret and starts nothing. If a STK-004 image runs without the env, `/healthz` stays 200 (so no auto-rollback) and every page redirects to `/login`, where sign-in fails. That locks Ming out but exposes nothing.
10. **Docs**: the `CLAUDE.md` R6 restore and Auth row, `figma-make-prompts.md:37`, and the comment-only edits in `server/*`.
11. **Gates**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, the AC4 bundle grep, and `bash scripts/check-deploy-env.sh`.
    - `scripts/check-image.sh` smoke: it runs without the auth env. `/healthz` returns 200, and `/` returns 307 → `/login`, which renders the form (auth config failure is caught). The smoke only requires `/` to answer, so it stays green.

Rules:
- **R1**: auth is delivery code in `apps/web/server/auth`, with no financial calculation. No clock or arithmetic in `app/**/*.tsx`.
- **R2**: not applicable.
- **R3**: no `NEXT_PUBLIC_`; the browser talks only to stoktok, never to the CaleChip or stoktok Supabase; the cookie is httpOnly and host-only; every auth module imports `server-only`; the service role key is untouched.
- **R4**: not applicable.
- **R5**: the URL, key and allowlist are configuration. The cookie name is a code constant, because it is not a market rule and not deploy-varying.
- **R6**: restored; a single `requireUser()`, enforced by `entrypoints.test.ts`.
- **R7**: no sign-up, password reset, rate limiting, ADR or spec edit (follow-ups).
- **R8**: tests listed above.
- **R10**: no brokerage login. The CaleChip login is identity only.

## Specialist input used
From `consult-software-architect-2.md` (round 2, current direction):
- **Adopted** Rec 1: the login is a server action with no browser client, a plain `<form>`, one Vietnamese error and a `next` guard. Adjusted: the error goes back through `?error=1` on a redirect rather than `useActionState`, so no client component is needed.
- **Adopted** Rec 2: cookie `stoktok-auth`, httpOnly, host-only, sameSite lax, secure in production; the CaleChip client sits in its own module apart from `getDb()`. Path changed from `lib/auth/` to `server/auth/` to match `server/db.ts`.
- **Adopted** Rec 3: refresh in `proxy.ts` using the Supabase SSR pattern, returning the same response; no-op `setAll` in Server Components; `Cache-Control: private, no-store`.
- **Adopted** Rec 4: `getClaims()` for both signing modes, followed by a pure `checkClaims`, failing closed. `AUTHEN_JWT_SECRET` dropped; `jose` is a devDependency only. The on-disk verification is Approach step 1.
- **Adopted** Rec 5: allowlist of UUIDs, validated, throw if empty, `forbidden.tsx` with a logout button. Cookie clearing on 403 is not automatic (default D5).
- **Adopted** Rec 6: one gate, public list `/login` and `/healthz`, authenticated `/login` → `/`, `entrypoints.test.ts`.
- **Adopted** Rec 7: logout is a server action with `signOut({ scope: 'local' })`.
- **Adopted** Rec 8: env names with the `AUTHEN_` prefix, `STOKTOK_`-prefixed deploy secrets with regex checks, the `docs/deploy.md` table and `check-deploy-env.sh`.
- **Adopted** Rec 9: Access stays in front; `/healthz` is reached from inside the container only. `allowedOrigins` is not set now; `docs/deploy.md` step 12 already says to record a follow-up if form submission fails behind the tunnel.
- **Not adopted** Rec 10 (optional grep test that the worker does not reference `AUTHEN_`): not required by any AC, and the worker never imports `server/auth`. Listed as a follow-up.
- **Adopted** Rec 11: the test list, including the real-supabase-js JWKS path and the HS256 fallback.
- **Adopted** Rec 12: AC2/AC3 wording restated (top of this plan).

From `consult-software-architect.md` (round 1):
- Still used: proxy as a coarse gate with `requireUser()` as the boundary, fail closed on an empty allowlist, avoiding the login loop, auth kept out of `packages/core`.
- Superseded: the `jose`/`createRemoteJWKSet` verifier, transport variants and external login URL. They no longer apply, because there is no external Authen app.

## Assumptions
- `@supabase/supabase-js@^2.118` `getClaims()` behaves as described in Approach step 1. This is verified on disk before relying on it; if not, stop.
- CaleChip tokens are standard Supabase access tokens: `iss` = `<url>/auth/v1`, `aud` = `authenticated`, `role` = `authenticated`, `sub` = `auth.users.id`, about 1 h expiry.
- Ming's CaleChip account uses email and password. MFA and OAuth are out of scope.
- `experimental.authInterrupts` in Next 16.4.2 is acceptable (the documented way to return a real 403).
- Two logins (Cloudflare Access, then stoktok) are acceptable while Access stays in front (Ming: "Cloudflare Access stays in front for now").
- **Defaults for Ming to confirm in the PR** (the consult's open questions; none changes the code shape):
  - **D1 Signing mode.** No decision is needed in code, because `getClaims()` handles both. Ming may check CaleChip dashboard → Project Settings → JWT Keys. With "Legacy JWT secret (HS256)", every request makes one round trip to CaleChip Auth, and a CaleChip outage locks stoktok out. Migrating CaleChip to ECC P-256 is a CaleChip change and a follow-up, Ming's call.
  - **D2 Key type.** Use the same client key CaleChip already ships (its `VITE_SUPABASE_ANON_KEY` value, legacy anon or `sb_publishable_…`). Both pass the workflow regex and work server-side.
  - **D3 Password through the server.** Yes. The form POSTs to stoktok's server action, which forwards it to CaleChip Auth. It is never stored or logged (tested).
  - **D4 `/healthz`.** Reachable from inside the container only (the compose healthcheck and the CI smoke use `127.0.0.1:3000`). No Access bypass. `docs/deploy.md` step 12 already expects 302/403 through the tunnel.
  - **D5 403 cookie clearing.** Not automatic. The 403 page shows "Đăng xuất", which clears the stoktok cookies (`scope: 'local'`). Server Components cannot write cookies, and auto-clearing would add proxy logic for no gain with one user.

## Blocking questions
None.

## Split proposal
None. It is one spec feature (§4.2). The diff is about 500 non-test plus about 450 test lines, above the ~400 guide, but much of it is mechanical: one-line `requireUser()` insertions, comments, and deploy and doc wiring the orchestrator asked to keep in scope.

If the orchestrator or reviewer prefers a split, the clean cut is:
- **Slice A**: everything except the deployment-repo workflow and the `check-deploy-env.sh` workflow check.
- **Slice B**: those two files plus the `docs/deploy.md` ordering subsection.

`.env.example` and the `docs/deploy.md` env table must stay in slice A together, because `check-deploy-env.sh` already compares them.

### Follow-ups (not in this diff, R7)
- Update spec §1.2, §4.2 and §9 Q1 wording: "Authen (shared mmlabs SSO)" becomes the CaleChip Supabase project, with stoktok `/login`. This is Ming's spec.
- ADR `docs/adr/0004-auth-calechip.md` recording this decision.
- Login rate limiting / lockout before Cloudflare Access is ever removed (brute-force risk from the consult).
- CaleChip `enable_signup = true`: anyone can get a valid session, and only the allowlist stops them. Consider disabling sign-up in CaleChip, or accept it.
- Migrate CaleChip to asymmetric JWT signing keys (D1), if Ming wants to drop the per-request round trip.
- `experimental.serverActions.allowedOrigins` if form submission fails behind the tunnel (deploy step 12).
- Optional test that `apps/worker` never references `AUTHEN_` (architect Rec 10).
- `CLAUDE.md` "Runtime: WSL2 home server" vs `docs/deploy.md` (Mac/OrbStack): the docs disagree; outside this ticket.

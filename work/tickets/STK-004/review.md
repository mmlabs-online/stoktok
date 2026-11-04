## Attempt 1 — 2026-11-04
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` — exit 0, all packages.
- lint: `pnpm lint` — exit 0, all packages.
- test: `pnpm test` — exit 0. core 539 passed (43 files), db 121 passed + 1 todo (14), worker 236 passed (15), web 264 passed (35). Matches impl-log.
- build: `pnpm build` — exit 0. `/login` ƒ, `Proxy (Middleware)` listed. Prints `auth: config invalid` twice during static generation (no auth env), as impl-log says.
- AC4 bundle grep: `grep -rlE "AUTHEN_|SERVICE_ROLE|ALLOWLIST|stoktok-auth|supabase\.co|signInWithPassword|getClaims" apps/web/.next/static` matched nothing (rc=1).
- `grep -rn NEXT_PUBLIC_ apps/web (ts/tsx, excl. node_modules/.next) .env.example`: nothing. `createBrowserClient`: nothing. `getClaims(`: only `server/auth/require-user.ts:22` and `proxy.ts:28`.
- `bash scripts/check-deploy-env.sh` printed `OK: deploy env lists consistent`. Negative tests on a scratch `git archive` copy: removing `ALLOWLIST_USER_IDS=%s` from the workflow `printf` → `FAIL: 'required now' keys … differ`; removing the `AUTHEN_SUPABASE_ANON_KEY: ${{ secrets… }}` mapping → `FAIL: workflow lacks …`, rc=1.
- Runtime smoke (`next start` on the build, no auth env): `/` → 307 `location: /login`; `/transactions?page=2` → 307 `/login?next=%2Ftransactions%3Fpage%3D2`; `/login` → 200; `/healthz` → 200 `no-store`; `/login?next=%2F%2Fevil.com` renders hidden `next` = `/`; `curl -L /settings` ends at `/login?next=%2Fsettings`, 200 after 1 redirect (no loop). A real CaleChip sign-in, the 403 page and session refresh could not be run (no credentials).

### Acceptance criteria
- [x] AC1 one server-only `requireUser()` (signature via `getClaims()`, iss, aud/role, exp, allowlist) used by every entry point — evidence: `server/auth/require-user.ts:1,12-37`, `claims.ts:9-18`, `config.ts:13-30`. 25 `await requireUser()` calls = 14 pages + 11 exported actions, each first in its function. `test/entrypoints.test.ts` (2) passes. Exempt: only `app/login/**` and `app/healthz/route.ts`.
- [x] AC2 (restated) proxy protects everything except `/login`, `/healthz` — evidence: `proxy.ts:7,16,37`, `proxy.test.ts` (5) pass, runtime smoke above.
- [x] AC3 (restated) unauthenticated → `/login`, not allowlisted → 403, nothing else runs — evidence: `require-user.test.ts` (5) incl. "caller's next line never runs", `proxy.test.ts`, runtime 307s. `forbidden.tsx` + `experimental.authInterrupts` (`next.config.ts:10`). The real 403 was not exercised at runtime (no CaleChip account). Fail-closed holds: a config error or a `getClaims` throw both return `unauthenticated` (`require-user.ts:14-28`, `proxy.ts:22-32`). The `next` handling has a gap, see Issue 1.
- [x] AC4 no secret in client bundles, no `NEXT_PUBLIC_*` — evidence: greps above. Cookie `httpOnly: true`, no `domain` (host-only), `sameSite: 'lax'`, `secure` in production (`authen-client.ts:12-18`, `authen-client.test.ts`). No browser client.
- [x] AC5 helper unit tests (valid, expired, wrong iss/aud, bad signature, not allowlisted, missing token) — evidence: `claims.test.ts` (10), `get-claims.test.ts` (4, real supabase-js against a fake-fetch JWKS, ES256 plus the HS256 `/auth/v1/user` fallback), `config.test.ts` (5), `require-user.test.ts` (5). All pass.
- [x] AC6 `.env.example` final keys — evidence: `.env.example` has `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY`, `ALLOWLIST_USER_IDS`. `AUTHEN_JWT_SECRET` and the "provisional" comment are removed. `check-deploy-env.sh` OK.
- [x] R6 restore / deploy wiring — evidence: CLAUDE.md R6 row and note; `figma-make-prompts.md:37`; `deploy-stoktok.yml` mapping, missing-checks, regexes, `printf` with 5 keys and no echo of values; `docs/deploy.md` table, step 3 and the "Restore auth (STK-004) – order" section.
- [x] signOut scope — `app/login/actions.ts:36` `signOut({ scope: 'local' })`, asserted in `actions.test.ts`.
- [ ] Open-redirect guard on `next` (plan `login-path.ts` row: "has no scheme … anything else becomes `/`") — FAILED, see Issue 1.

### Issues
#### Issue 1 — 🔴 blocker — security (open redirect)
- **Where**: `apps/web/server/auth/login-path.ts:4`. It is used by `app/login/page.tsx:10` (an authenticated visit to `/login` redirects straight to `safeNext(next)`) and by `app/login/actions.ts:17,30` (redirect after sign-in).
- **Expected**: `safeNext` returns only a same-origin relative path; the plan says `//evil`-style values become `/`.
- **Actual**: the WHATWG URL parser strips ASCII tab, LF and CR anywhere in a URL. The check rejects `\r`, `\n` and `\`, but not `\t`, so `safeNext('/\t/evil.com')` returns `'/\t/evil.com'` unchanged. The browser resolves it as `new URL('/\t/evil.com', 'https://stoktok…').href === 'https://evil.com/'` (verified in node). Next writes the redirect target to `location` raw (`next/dist/server/app-render/app-render.js:2501,5254` `setHeader('location', addPathPrefix(getURLFromRedirectError(err)))`), and Node allows tab in header values. Exploit: `https://<host>/login?next=%2F%09%2Fevil.com`. An already-signed-in Ming is redirected to evil.com immediately; otherwise she is redirected right after signing in. That is a phishing vector on the login page.
- **Fix instruction**: in `safeNext`, reject any ASCII control character and backslash. Replace `/[\\\r\n]/` with `/[\x00-\x1f\x7f\\]/`, keeping the existing `//` and `/login` checks. Optionally also require `new URL(raw, 'http://x').origin === 'http://x'`. Add to the `bad` list in `login-path.test.ts` › "replaces //evil…": `'/\t/evil.com'`, `'/\n/evil.com'`, `'/\r/evil.com'`, `'/\x00/evil.com'`. Add one `actions.test.ts` case where `next: '/\t/evil.com'` gives `REDIRECT:/`.

### Rules R1–R10
No violations found. R1: auth is delivery code in `apps/web/server/auth`; the clock arithmetic is in `require-user.ts:24`, not in `app/**/*.tsx`. R3: no `NEXT_PUBLIC_`, no browser client, `server-only` in config, authen-client and require-user; the service role key is untouched. R5: URL, key and allowlist are configuration. R7: the only out-of-plan file, `components/components.test.tsx` (`server-only` mock), is justified in impl-log; the non-memoised config and the 11-vs-12 action count are justified deviations. R8: green.

### Nits (do not block)
- 💭 `server/auth/claims.ts` and `login-path.ts` do not import `'server-only'`. The plan's AC4 column says "every module in `server/auth/`" does, but its file table calls them pure. They hold no secrets; adding the import costs nothing.
- 💭 `test/entrypoints.test.ts:30` only detects `export (async) function`. An action written as `export const x = async () => …`, or an inline `'use server'` function, would slip past the guard. Consider also failing on `export const` in `'use server'` files.
- 💭 `app/login/page.tsx` calls `authenticate()` with `canWrite: false` on a path the proxy skips. If Ming opens `/login` directly with an expired access token, supabase-js refreshes (rotating the refresh token) and the new cookies are dropped. The likely result is a logout (fails closed). Acceptable for v1.
- 💭 The `auth: config invalid` log during `next build` (already in impl-log follow-ups).

### Follow-ups (out of scope)
- Plan follow-ups stand: spec §1.2/§4.2/§9 wording, ADR 0004, login rate limiting before Access is removed, CaleChip `enable_signup`, CaleChip asymmetric keys (D1), `serverActions.allowedOrigins` if forms fail behind the tunnel, worker `AUTHEN_` grep test.
- Worker receives `AUTHEN_*` and `ALLOWLIST_USER_IDS` through the shared `env_file`. Harmless; scope to web if the compose file ever splits env files.

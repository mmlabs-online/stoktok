## Attempt 1 — 2026-11-04

### Library check (Approach step 1; read on disk after `pnpm install`)
Versions: `@supabase/ssr` ^0.12.7, `@supabase/supabase-js` ^2.118.0 (auth-js `GoTrueClient.js` `getClaims`).
- (a) HOLDS. With `header.alg` not `HS*` and a `kid`, it fetches `${url}/.well-known/jwks.json` (url = `<project>/auth/v1`), imports the JWK and verifies with WebCrypto locally.
- (b) HOLDS. With `HS*`, no `kid` or no WebCrypto it falls back to `getUser(token)` (`/auth/v1/user`) and throws on error.
- (c) `getClaims` rejects an expired `exp` itself (`validateExp`, unless `allowExpired`). `checkClaims` checks `exp` anyway.
- (d) HOLDS. `createServerClient` maps `cookieOptions.name` to `auth.storageKey`. `cookieOptions` (incl. `httpOnly`) is spread over `DEFAULT_COOKIE_OPTIONS` (`httpOnly: false`) and passed to `setAll`, so `httpOnly: true` is honoured. Note: `getClaims()` without an argument calls `getSession()`, which can refresh an expired session; Server Component writes are a no-op, the proxy persists the refresh.
No deviation from the plan; no stop needed.

### Files touched
| File | Required because |
|---|---|
| `apps/web/package.json`, `pnpm-lock.yaml` | deps `@supabase/ssr`, `@supabase/supabase-js`, devDep `jose` |
| `apps/web/server/auth/{config,claims,login-path,authen-client,require-user}.ts` | requireUser, claims check, cookie client (AC1, AC3, AC4) |
| `apps/web/proxy.ts` | coarse gate, public list `/login`, `/healthz` (AC2, AC3) |
| `apps/web/next.config.ts` | `experimental.authInterrupts` for `forbidden()` |
| `apps/web/app/forbidden.tsx`, `app/login/{page,actions}.tsx/ts`, `components/shell/logout-button.tsx`, `components/shell/app-shell.tsx` | 403 page, login, logout |
| 14 `app/(app)/**/page.tsx` and 4 `actions.ts` (11 exported actions) | `await requireUser()` first (R6) |
| 4 `actions.ts` comments; `server/{db.ts,dashboard/load-dashboard.ts,watchlist/load-watchlist.ts,symbols/load-symbol.ts,assets/handlers.ts,watchlist/handlers.ts,settings/handlers.ts,transactions/handlers.test.ts}` | comment-only: stale "R6 suspended" notes |
| `.env.example` | final auth keys (AC6) |
| `docs/deploy.md`, `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml`, `scripts/check-deploy-env.sh` | secret mapping, ordering, sync check |
| `CLAUDE.md`, `docs/figma-make-prompts.md` | R6 restored, Auth row, login screen line |

### Tests added / changed
- `server/auth/config.test.ts` (5), `claims.test.ts` (10), `login-path.test.ts` (2), `authen-client.test.ts` (1), `get-claims.test.ts` (4, real supabase-js against a fake-fetch JWKS, ES256 via jose, HS256 fallback), `require-user.test.ts` (5)
- `proxy.test.ts` (5), `app/login/actions.test.ts` (5), `test/entrypoints.test.ts` (2)

### Checks (actual output summary)
- typecheck: `pnpm typecheck` all packages pass, 0 errors
- lint: `pnpm lint` all packages pass, 0 errors
- test: `pnpm test` core 539, db 121 (+1 todo), worker 236, web 264 passed, 0 failed
- build: `pnpm build` succeeds; `/login` listed, `Proxy (Middleware)` listed
- `bash scripts/check-deploy-env.sh`: `OK: deploy env lists consistent`
- AC4: `grep -rE "AUTHEN_|SERVICE_ROLE|ALLOWLIST|stoktok-auth" apps/web/.next/static` returns nothing; no `NEXT_PUBLIC_` or `createBrowserClient` in apps/web or `.env.example`
- Not run: manual dev-server curl / real CaleChip sign-in (no credentials)

### Out-of-plan files
- `apps/web/components/components.test.tsx` — added `vi.mock('server-only', () => ({}))`: its AppShell test now imports LogoutButton, whose action chain reaches `server-only`.
- `apps/web/server/auth/config.ts` deviates from the plan: not memoised (memoising on `process.env` went stale across tests and gains nothing).
- Plan said 12 actions; the files have 11 exported actions, all gated.

### Follow-ups (noticed, not done)
- `next build` prints `auth: config invalid` during static generation when the auth env is unset (the not-found/static pages render without the env); harmless, goes away with env set. Consider silencing the log.
- Plan follow-ups stand: spec wording, ADR, login rate limiting, CaleChip signup/asymmetric keys, `allowedOrigins`, worker `AUTHEN_` grep test. The worker also receives the new keys through the shared `env_file`.

### Scope self-check
- Could the diff be smaller? No; the page/action edits are one line each.
- Diff size: not measured (no git commit made; working tree only).

# STK-060: Remove the allowlist check; any verified Supabase Auth user can sign in

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P2 |
| Areas | security, architecture |
| Attempts | 0 |
| Created | 2026-11-07 |
| PR | — |

## Goal
Drop `ALLOWLIST_USER_IDS`: any user of the stoktok Supabase project's Auth with a valid session (correct email + password, JWT verified via `getClaims()`) can use the app. Single-user access is kept by disabling public sign-ups in the Supabase dashboard instead of an app-level allowlist.

## Spec reference
- §1.2 Users ("restricted by an allowlist") — to be changed by this ticket (Ming's decision, 2026-11-07).
- §4.1 Services (`web` row) and §4.2 Auth integration ("Allowlist check … on every request") — to be changed.

## Acceptance criteria
- [ ] `loadAuthConfig()` (`apps/web/server/auth/config.ts`) no longer reads or requires `ALLOWLIST_USER_IDS`; the app starts with the variable unset.
- [ ] The claims check (`apps/web/server/auth/claims.ts`) and `requireUser()` still verify issuer, audience/role and expiry and fail closed; a valid session for any user ID returns `ok`. The `forbidden` path from the allowlist is removed (or kept only if still reachable for another reason).
- [ ] Tests updated: allowlist tests removed or replaced; tests prove a valid token for an arbitrary `sub` is accepted and invalid/expired/wrong-issuer tokens are still rejected. `pnpm typecheck`, `pnpm lint`, `pnpm test` green.
- [ ] `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` no longer requires, validates or writes `STOKTOK_ALLOWLIST_USER_IDS` / `ALLOWLIST_USER_IDS`.
- [ ] `.env.example`, `docs/deploy.md` (env table, setup steps; disabling sign-ups becomes the access control, not optional hardening) and `work/ming-todo.md` no longer mention the allowlist.
- [ ] `docs/spec-v1.md` §1.2, §4.1, §4.2 and `CLAUDE.md` (Auth row, R6, intro line) describe the new rule: verified Authen JWT on every server route/action; single user enforced by disabled sign-ups.
- [ ] No remaining reference to `ALLOWLIST_USER_IDS` outside `work/tickets/**` history (grep).

## Notes / answers from Ming
- 2026-11-07: "không cần, cứ đúng user password là đc" — remove the allowlist. Ming confirmed public sign-ups will be disabled in the Supabase dashboard (human step) and asked for a ticket rather than a direct edit.
- Risk accepted by Ming: any account that exists in the stoktok project's Auth gets full access (all data is read via the service role, no per-user RLS). Cloudflare Access stays in front for now.

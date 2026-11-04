# STK-004: Authen login and allowlist on the Next.js server

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Only Ming can use stoktok: every page, route handler and server action verifies the Authen (mmlabs SSO) JWT on the server and checks the allowlist before doing anything.

## Spec reference
docs/spec-v1.md §1.2 Users, §4.2 Auth integration, §9 Open question 1 (JWT trust). CLAUDE.md R3, R6.

## Acceptance criteria
- [ ] One server-only helper (e.g. `requireUser()`) verifies the Authen JWT (signature, issuer, audience, expiry) and the allowlist from `ALLOWLIST_USER_IDS`; it is the single entry point used by pages, route handlers and server actions.
- [ ] Next.js middleware protects all routes except an explicit public list (auth callback, health check).
- [ ] Unauthenticated request → redirect to Authen login; authenticated but not allowlisted → 403 page; nothing else is rendered or queried.
- [ ] No secret or service role key reaches client bundles; no `NEXT_PUBLIC_*` auth secrets (R3).
- [ ] Unit tests for the helper: valid token, expired, wrong issuer/audience, bad signature, not allowlisted, missing token.
- [ ] `.env.example` updated to the final auth keys (replacing the provisional ones).

## Notes / answers from Ming
- **On hold (Ming, 2026-10-23):** ignore Authen for now; no page is authenticated. R6 is suspended in CLAUDE.md. Resume this ticket (and answer the plan.md questions) before public go-live.
- **Open (spec §9 Q1), likely blocking:** how the Authen token reaches stoktok (shared cookie on `.mmlabs.online`, or redirect with token/code) and how it is verified. Recommendation from the consultant: verify with the Authen Supabase project's public JWKS (asymmetric signing keys), so no shared JWT secret is needed — confirm Authen's project uses JWT signing keys. Planner: if the CaleChip/Authen code does not answer this, return BLOCKED with the exact questions.
- **Answer (Ming, 2026-11-05): use the CaleChip Supabase project as "Authen".** Findings from reading `didi-code0980/calechip` (public): there is no shared mmlabs SSO service. CaleChip is a Vite SPA that signs in with `supabase.auth.signInWithPassword` against its own Supabase project (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`); no `.mmlabs.online` cookie, no shared login URL. So the plan's Q1–Q4 resolve as: stoktok has **its own login page** that signs in against the CaleChip Supabase project (server-side), stores the session in an httpOnly cookie on stoktok's own domain, and the server verifies the JWT against that project. Signing (JWKS vs legacy HS256) is not visible in the repo (`supabase/config.toml` is local-only) — the plan must work for both or say what Ming checks in the CaleChip dashboard. Project URL, anon key and Ming's user UUID are deploy config (deployment repo environment secrets, `STOKTOK_` prefix), not code; they do not block planning. Cloudflare Access stays in front for now.
- **AC wording restated by the planner (2026-11-05), per Ming's answer:** AC2 public list = `/login` and `/healthz` (was "auth callback, health check"). AC3 unauthenticated → redirect to stoktok `/login` (was "Authen login"). AC1 "signature" = verified by `getClaims()` (JWKS locally, or a round trip to CaleChip Auth for legacy HS256); "audience" = `aud` includes `authenticated` and `role` is `authenticated`. See plan.md.

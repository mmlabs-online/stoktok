# STK-004: Authen login and allowlist on the Next.js server

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 0 |
| Created | 2026-10-22 |

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
- **Open (spec §9 Q1), likely blocking:** how the Authen token reaches stoktok (shared cookie on `.mmlabs.online`, or redirect with token/code) and how it is verified. Recommendation from the consultant: verify with the Authen Supabase project's public JWKS (asymmetric signing keys), so no shared JWT secret is needed — confirm Authen's project uses JWT signing keys. Planner: if the CaleChip/Authen code does not answer this, return BLOCKED with the exact questions.

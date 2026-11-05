# STK-048: Authen = Supabase Auth of stoktok's own project (docs and comments)

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P1 |
| Areas | security |
| Attempts | 1 |
| Created | 2026-11-05 |
| PR | — |

## Goal
Record Ming's decision that stoktok signs in with Supabase Auth of **its own** Supabase project (the same concept CaleChip uses for its own login), not the CaleChip project. STK-004's code is provider-agnostic, so this is a wording and setup-docs change only.

## Spec reference
docs/spec-v1.md §1.2, §4.2, §9 Q1 (auth). CLAUDE.md Stack "Auth" row and R6 note. STK-004 (merged, PR #35).

## Acceptance criteria
- [ ] Every mention of "Authen = CaleChip" (CLAUDE.md stack row and R6 note, `.env.example` comments, comments in `apps/web/server/auth/config.ts` and `authen-client.ts`, `docs/deploy.md`) says Authen is Supabase Auth of stoktok's own Supabase project.
- [ ] `docs/deploy.md` says what to put in the three secrets: `STOKTOK_AUTHEN_SUPABASE_URL` = the stoktok project URL (same value as `STOKTOK_SUPABASE_URL`), `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` = the stoktok project's anon/publishable key, `STOKTOK_ALLOWLIST_USER_IDS` = Ming's user UUID in the stoktok project's Auth.
- [ ] `docs/deploy.md` adds the one-time setup: create Ming's user in the stoktok project's Supabase Auth (dashboard), disable public sign-ups, copy the user UUID; the verify step signs in with that account.
- [ ] No logic change: `git diff` touches only comments, docs and work files; `pnpm typecheck`, `pnpm lint`, `pnpm test` and `scripts/check-deploy-env.sh` pass.

## Notes / answers from Ming
- 2026-11-05: "giống concept authen của calechip tức là dùng supabase authen" — use Supabase Auth (of stoktok's own project), like CaleChip does for itself. Chose a ticket over /solo because the change spans ~6 files touching auth/secrets docs.
- Out of scope (follow-up): reusing `SUPABASE_URL` instead of a separate `AUTHEN_SUPABASE_URL` (a code/env change).
- **Ming (2026-11-05):** fix security-review 🟡 M1 (key-rotation runbook) and M2 (Auth setup settings) in docs/deploy.md before the PR (rework 1).

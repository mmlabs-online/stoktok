# STK-081: Data layer on pg + Kysely: port repos and callers (STK-080 slice b)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | architecture, db, data, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/). Scope:

Port all 17 repos to Kysely through `@stoktok/db` (index), with the same exported functions and signatures. Replace `Db` with the `PgDb` handle. Change `apps/web/server/db.ts` (lazy, `globalThis` in dev), `apps/worker/src/cli.ts` (`await end()` in `finally`, including the `.catch` path) and `apps/worker/src/ai.ts` (reuse the CLI pool). `ai_reserve`/`ai_month_spend` via `select * from public.ai_reserve(…)` with explicit casts. Vault RPCs kept as `select * from public.ai_key_*(…)`. Delete `fetchAll` and `fake-client.ts`. Repo behaviour tests move to `test-db/` (every upsert conflict key, news insert count, `count(*) over()`, guarded gap updates, an `ai_reserve` concurrency test); pure tests stay. Remove `@supabase/supabase-js` from `packages/db` and `apps/worker`. `next.config.ts` `serverExternalPackages` adds `pg` (plus web dependency if standalone tracing needs it). Worker tsup external and `pg`/`kysely` worker runtime deps. `check-image.sh` uses a dummy `STOKTOK_DATABASE_URL` and adds a worker `pg` resolve probe. `check-deploy-env.sh` and `deploy/deployment-repo` compose/workflow get validation and env-file writing for `STOKTOK_DATABASE_URL` (special characters). r3-guard: `@supabase/` only under `apps/web/server/auth/**`; drop the `SUPABASE_SERVICE_ROLE_KEY` rule. `.env.example`. CLAUDE.md R3 text. Production points `STOKTOK_DATABASE_URL` at Supabase's Postgres (session pooler, a role that bypasses RLS, e.g. `postgres`)

## Spec reference
STK-080 ticket ACs: AC1 (port), AC2 (wired), AC5 (no auth change; guard), AC7. CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Depends on STK-080.

## Acceptance criteria
- [ ] Every item in the scope above is done, meeting the STK-080 ticket ACs listed (AC1 (port), AC2 (wired), AC5 (no auth change; guard), AC7) for this slice.
- [ ] Production keeps working after this slice is deployed on its own (strangler path in STK-080 plan.md).
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- Ming's manual step: Set `STOKTOK_DATABASE_URL` (Supabase session pooler) in the deploy repo secrets.
- STK-081 must require TLS (sslmode=verify-full) for any STOKTOK_DATABASE_URL host off the Docker network and enforce run() wrapping of kysely calls in repos (STK-080 security review S3, S5); the @stoktok/db/pg importer rule was done in STK-080 attempt 2.

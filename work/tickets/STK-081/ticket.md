# STK-081: Data layer on pg + Kysely: port repos and callers (STK-080 slice b)

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P1 |
| Areas | architecture, db, data, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/), re-scoped on 2026-11-11 to the deployment repo's shared-Postgres standard. Scope:

Port all 17 repos to Kysely through `@stoktok/db` (index), with the same exported functions and signatures. Replace `Db` with the `PgDb` handle. Change `apps/web/server/db.ts` (lazy, `globalThis` in dev), `apps/worker/src/cli.ts` (`await end()` in `finally`, including the `.catch` path) and `apps/worker/src/ai.ts` (reuse the CLI pool). `ai_reserve`/`ai_month_spend` via `select * from public.ai_reserve(…)` with explicit casts. Vault RPCs kept as `select * from public.ai_key_*(…)` until STK-082. Delete `fetchAll` and `fake-client.ts`. Repo behaviour tests move to `test-db/` (every upsert conflict key, news insert count, `count(*) over()`, guarded gap updates, an `ai_reserve` concurrency test); pure tests stay. Remove `@supabase/supabase-js` from `packages/db` and `apps/worker`. `next.config.ts` `serverExternalPackages` adds `pg` (plus web dependency if standalone tracing needs it). Worker tsup external and `pg`/`kysely` worker runtime deps. `check-image.sh` uses a dummy `STOKTOK_DATABASE_URL` and adds a worker `pg` resolve probe. r3-guard: `@supabase/` only under `apps/web/server/auth/**`. `.env.example`. CLAUDE.md R3 text. Deploy plumbing (env file, compose network `db`) is NOT in this slice: it moves to STK-084.

## Shared-Postgres standard (deployment repo, Ming 2026-11-11)
Follow how TuDoCuaTui (D23–D25) and org-admin-api use the shared Postgres in `mmlabs-online/deployment`:
- `postgres:17`, reachable only as `postgres:5432` on the external Docker network `db`; no published port, no TLS on that hop.
- One login role + one database per app, same name (`stoktok`), created by `bash postgres/scripts/add-app-db.sh stoktok` (password in `postgres/secrets/apps/stoktok.password`, app listed in `postgres/config/databases`). The role owns its database and schema `public`; it has no CREATEROLE/CREATEDB/superuser. The same role runs the app and the migrations (least-privilege runtime role is a later follow-up, as in TuDo D24).
- The deploy workflow writes the URL into the host env file from the committed password file (no GitHub secret). stoktok keeps the env name `STOKTOK_DATABASE_URL` (STK-080 guards).
- Migrations: a one-shot `migrate` compose service, run by the deploy after a pre-migration dump (`pg-backup /backup.sh`) and before the app is replaced; a failed migration leaves the old release running. Pattern: TuDoCuaTui `server/migrator.js` (plain SQL `YYYYMMDDHHMMSS_name.sql`, forward-only, checksums in a migrations table, advisory lock, one transaction per file).
- Backups: automatic by the `pg-backup` sidecar for every database in `config/databases` (02:00 daily, 7d/4w/6m, offsite at 03:30).
- No RLS for single-user (TuDo D25 pattern).

**Release rule:** STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084; production stays on the current Supabase-backed release until the cutover. There is no interim hop to Supabase's Postgres.

## Spec reference
CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Reference repos: `mmlabs-online/deployment` (`postgres/`, `apps/tudocuatui/`, `.github/workflows/deploy-tudocuatui.yml`), `mmlabs-online/TuDoCuaTui` (`server/db.js`, `server/migrator.js`, `db/migrations/README.md`, `work/decisions.md` D23–D25). Depends on STK-080.

## Acceptance criteria
- [ ] Every item in the scope above is done, following the shared-Postgres standard.
- [ ] Production keeps working: until STK-084's cutover no stoktok release is cut, and nothing in this slice changes the running release.
- [ ] (from STK-080 security review attempt 3) A socket drop or pool connect timeout during session setup cannot crash the process: an `'error'` listener is held during `initSession` in `packages/db/src/pg/client.ts` (or pg-pool's `onConnect` is used), with a real-PG test that terminates the backend during setup and asserts the process survives and `totalCount` returns to 0.
- [ ] (same source) `PgDb.pool` is no longer a plain enumerable property: replace it with a narrow `stats()` or make it non-enumerable, so logging the handle cannot print `connectionString`; repos may not use it to bypass Kysely/`run()`.
- [ ] (STK-080 security review S5) every repo `kysely` call goes through `run()`, enforced by an r3-guard rule or test.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- 2026-11-11 (Ming): re-scoped to the deployment repo's shared-Postgres standard (see above); replaces the earlier interim plan of pointing production at Supabase's Postgres over TLS and the stoktok_owner/stoktok_app role pair.
- Ming's manual step: none (no release is cut for this slice).

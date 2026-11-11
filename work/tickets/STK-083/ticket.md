# STK-083: Plain-Postgres baseline migration, app roles and db:check rewrite (STK-080 slice d)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/). Scope:

One squashed baseline plus rollback under a new `db/migrations` and `db/rollback` (old `supabase/` files kept read-only for reference and excluded from runners). No Supabase roles or Vault; RLS disabled. One-time role bootstrap `stoktok_owner`/`stoktok_app` outside the chain. Default privileges from `stoktok_owner`; PUBLIC revoked on schema, database and functions. `alter role stoktok_app set idle_in_transaction_session_timeout`. `scripts/db-migrate.sh` (psql plus `schema_migrations`). db:check rewritten: app-role privilege matrix (DML yes; DDL/TRUNCATE no), a `stoktok_nobody` role denied, `aclexplode` PUBLIC checks, rollback leaves no tables/functions/sequences/types. `test:db` template switched to the baseline. A recorded normalised `pg_dump --schema-only` diff vs Supabase (grants and Vault excluded) proves the squash is faithful. CI also runs db:check on Ming's PG major if it is not 16

## Spec reference
STK-080 ticket ACs: AC3. CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Depends on STK-082.

## Acceptance criteria
- [ ] Every item in the scope above is done, meeting the STK-080 ticket ACs listed (AC3) for this slice.
- [ ] Production keeps working after this slice is deployed on its own (strangler path in STK-080 plan.md).
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- Ming's manual step: One-time role bootstrap in the Postgres container. Open: the container's PG major version, and whether pgAdmin connects as superuser or `stoktok_owner`.

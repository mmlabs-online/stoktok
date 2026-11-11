# STK-080: Postgres driver foundation: pg + Kysely in packages/db (self-hosted Postgres, slice a)

| Field | Value |
|---|---|
| State | DONE |
| Priority | P1 |
| Areas | architecture, db, data, security |
| Attempts | 3 |
| Created | 2026-11-11 |
| PR | https://github.com/mmlabs-online/stoktok/pull/59 |

## Goal
Replace supabase-js / PostgREST data access with direct Postgres access from server code (web server and worker) against the Postgres instance Ming runs on the home server, managed with pgAdmin. Login stays on Supabase Auth until the shared mmlabs user service exists. Existing data moves over from Supabase.

## Spec reference
CLAUDE.md Stack (DB, Auth), R2, R3, R6; docs/spec-v1.md §7 Deployment; ADR 0008 (AI budget), ADR 0009 (AI keys in Vault — must be superseded). **Stack change by Ming's decision (2026-11-11); CLAUDE.md and spec must be updated.**

## Acceptance criteria
- [ ] `packages/db` talks to Postgres through a server-only driver (`pg` or a query builder, planner/architect to choose with reasons). No `@supabase/supabase-js` in `packages/db`; all 17 repos and their callers keep the same public functions and behaviour (upserts, conflict keys, the `ai_reserve` / `ai_month_spend` functions).
- [ ] Connection string is server-only config (R3): never `NEXT_PUBLIC_*`, never in client bundles; the existing service-key bundle check is updated to cover it. A connection pool with sensible limits for web + worker on one host.
- [ ] Migrations run on plain Postgres (no Supabase-only roles or extensions required). The Supabase role setup (`service_role`, `anon`, `authenticated`) is replaced by a least-privilege app role; `db:check` keeps passing, including rollbacks.
- [ ] AI keys no longer use Supabase Vault: encrypted at rest with a server-only master key (or `pgcrypto`), still never returned to the browser or logged; new ADR supersedes ADR 0009.
- [ ] Login still works through Supabase Auth (`requireUser()`, `/login`, `proxy.ts` unchanged in behaviour).
- [ ] A documented, tested data-migration runbook moves existing tables from Supabase to the new Postgres (AI keys are re-entered on Settings), plus a backup note (pg_dump schedule) for Ming.
- [ ] CLAUDE.md (Stack, R3, Conventions), spec §7 and `.env.example` updated. `typecheck`, `lint`, `test`, `db:check` green; repo tests work without Supabase.

## Notes / answers from Ming
- 2026-11-11 (Ming): Ming has set up a Postgres DB on the server and will later build a user service shared by all mmlabs apps, so stoktok moves off Supabase to Postgres (managed with pgAdmin) with its own API, not through Supabase.
- 2026-11-11 (Ming, choices): (1) "own API" = the Next.js server and worker call Postgres directly (no separate API service). (2) Keep Supabase Auth for login until the shared user service exists; switching login is a later ticket. (3) Migrate existing Supabase data to the new Postgres (AI keys re-entered, Vault cannot be exported).
- Orchestrator note: this is large (estimated 6–7 STK-074-sized tickets). Expect the planner to split it (e.g. driver + repos, roles/migrations, AI key storage, data migration + docs).
- Open for the planner/architect: where pgAdmin's DB lives (host/port reachable from the Docker Compose network), and how STK-077 (AI summaries job) should be ordered relative to this ticket.
- 2026-11-11 (Ming, after consults): (1) Postgres runs as a container on a shared Docker network with the stoktok containers (reach it by service name, e.g. `postgres:5432`; DB port not published). (2) Squash the migration history into one plain-Postgres baseline (keep the old files for reference). (3) Driver: `pg` + Kysely. (4) Supabase Free pausing (Auth only after the move): accept the risk, no keep-alive.
- Orchestrator note: both consults agree on app-side AES-256-GCM for AI keys (master key in server-only env) over pgcrypto, and on real-Postgres integration tests in CI; the planner may treat these as defaults. RLS (keep with one app policy vs drop) is open between the consults — planner to choose and state why. Deployment is OrbStack on an Intel Mac (ADR 0003), not WSL2; fix CLAUDE.md Stack.
- 2026-11-11 (Ming, after review attempt 1 PASS): fix before the PR, from security-review.md attempt 1: 🟡 S1 (test-db host check also rejects `host`/`hostaddr`/`port` query params, or checks the parsed host; unit case for `?host=`), 🟡 S2 (session init fails closed: log code only and drop the client), 🟡 S3 (ADR 0010: any host off the Docker network needs `sslmode=verify-full`; note it as an STK-081 requirement), and the small 🟢: S9 (escape LIKE in teardown; drop the template if setup fails), S7a/c (widen the NEXT_PUBLIC_ guard; apps/web may import `@stoktok/db/pg` only from server/db.ts), S8 (bundle-check needles `kysely`, `pg-pool`, `pg-connection-string`, `db.invalid`), S4 (assert identifier-shaped upsert keys), S5 nit (only map real pg error codes), plus review nits `usage_id` typed `Int8` and `jsonb(undefined)`.
- 2026-11-11 (Ming, after review attempt 3 PASS): open the PR; the two new 🟡 from security-review.md attempt 3 (crash on socket drop during session init; PgDb.pool exposes connectionString) become required ACs of STK-081.
- 2026-11-11 (Ming): follow the deployment repo's shared-Postgres standard (as TuDoCuaTui and org-admin-api do): database + role `stoktok` via `add-app-db.sh`, one owner role for app and migrate, no TLS on the internal `db` network, URL written by the deploy workflow from the committed password file, `migrate` one-shot service with a pre-migration dump, backups by the `pg-backup` sidecar, Postgres 17. No interim hop to Supabase's Postgres; no stoktok release until the STK-084 cutover. STK-081–STK-084 re-scoped accordingly; ADR 0010 updated in this PR.

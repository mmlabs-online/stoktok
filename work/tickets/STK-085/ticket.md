# STK-085: Data layer on pg + Kysely: port the 17 repos, callers, bundling and guards (STK-080 slice b2)

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P1 |
| Areas | architecture, db, data, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-081 (see work/tickets/STK-081/plan.md "Split proposal"; reuse the consults in work/tickets/STK-081/ and the decisions in that plan's "Specialist input used"; no new consult needed). Scope:

the STK-081 ticket scope minus what STK-081 did. Port all 17 repos to Kysely through `@stoktok/db` (index), with the same exported functions (pageSize options removed as decided). Requirements:
  - every query goes through `q()` from `pg/access.ts`;
  - `export type Db = PgDb`;
  - `apps/web/server/db.ts` is lazy and caches `createPgDb(process.env, 'web')` on `globalThis[Symbol.for('stoktok.db')]` unconditionally;
  - `apps/worker/src/cli.ts` creates the handle after `parseArgs`, inside `main`'s `try`, with `finally { await db.end().catch(() => undefined) }`;
  - `apps/worker/src/ai.ts`: `db` is required, with no fallback pool;
  - `ai_reserve` and `ai_month_spend` use raw `sql` with explicit casts and named columns (DB-optimizer E);
  - the Vault RPCs stay as `select … from public.ai_key_*(…)` until STK-082, with 22023 → VALIDATION via the `q()` map hook;
  - add a `found()` helper in `errors.ts`; delete `unwrap`, `unwrapFound`, `fetchAll`, `client.ts` (supabase) and `fake-client.ts`;
  - `listTransactionsPage`: `count(*) over()` plus a separate `count(*)` when the page is empty and offset > 0;
  - `listAllOpenGaps` is a single select;
  - fan-outs stay per-symbol with `PG_FANOUT_CONCURRENCY`;
  - multi-chunk upserts run in one transaction (except `insertNews`), with chunking `chunkForParams` × `chunkSize`;
  - normalise optional fields to explicit `null` before `upsertInto`;
  - repo behaviour tests move to `test-db/` per DB-optimizer §D (including the `ai_reserve` concurrency test with its mutation proof) and data-engineer Rec. "repo behaviour tests"; pure tests stay;
  - rewrite the three rpc-faking app tests (`apps/web/server/ai-keys.test.ts`, `apps/web/server/ai.test.ts`, `apps/worker/src/ai.test.ts`) with `vi.mock` of repo functions;
  - `store.test.ts` and `config.test.ts` lose the pageSize/cap assertions;
  - remove `@supabase/supabase-js` from `packages/db` and `apps/worker`;
  - web: `pg` as a direct dependency plus `serverExternalPackages: ['pg']`;
  - worker: `pg` and `kysely` deps with the same ranges as `packages/db` (with a guard test), and tsup `external: ['pg','pg-native','kysely']`;
  - `check-image.sh`:
    - web smoke uses a dummy `STOKTOK_DATABASE_URL` and probes the `.next/node_modules` `pg-*` alias;
    - worker smoke adds a `pg`/`kysely` resolve probe;
    - worker smoke adds a no-hang `signals` run against `127.0.0.1:9` under `timeout 20` (exit 1, stderr without host or password);
  - `check-no-service-key-in-client.sh` drops the `SUPABASE_*` build vars;
  - r3-guard:
    - `@supabase/` imports (all forms) only under `apps/web/server/auth/**`;
    - `@supabase/*` absent from the `packages/db` and `apps/worker` package.json files;
    - `SUPABASE_SERVICE_ROLE_KEY` appears nowhere;
    - the `createPgDb(` allowlist adds `apps/web/server/db.ts` and `apps/worker/src/cli.ts`;
    - Vault rules unchanged;
  - `.env.example`;
  - CLAUDE.md R3 text;
  - deploy plumbing stays in STK-084.
  - Suggested commit order: ledger repos → market data → assets/watchlist/lottery → AI → apps and bundling.

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
CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010. Depends on STK-081.

## Acceptance criteria
- [ ] **First commit, before any repo is ported** (from STK-081 review attempt 2, Ming 2026-11-11): widen `Escaping` in `packages/db/src/pg/access.ts` to `Compilable<unknown> | QueryCreator<Database> | TransactionBuilder<Database> | ConnectionBuilder<Database> | DatabaseIntrospector` with `@ts-expect-error` fixtures for `k.transaction()`, `k.connection()`, `k.with(...)` and `k.introspection` (optionally also reject `any` via `0 extends 1 & T`); extend the r3-guard `log` rule to the shorthand `{ log }`, `{ log, dialect }` and quoted `'log':` forms with self-tests.
- [ ] Reviewer rule for every repo port: a `q()` callback returns rows or scalars only — no `as any`/`unknown`, no assigning `k`/`trx` to an outer variable, no wrapper objects or functions around `k`/`trx`.
- [ ] All 17 repos run on Kysely through `q()`. No `@supabase/` import remains outside `apps/web/server/auth/**`. `fetchAll`, `unwrap`, `unwrapFound` and `fake-client.ts` are deleted.
- [ ] The test:db behaviour cases from DB-optimizer §D pass, including the transactions out-of-range-page total, guarded gap updates, the news insert count, every upsert conflict key, the four jsonb round-trips, and the `ai_reserve` concurrency test (mutation proof in the impl-log).
- [ ] Exercise the worker lifecycle: no pool is opened on a usage error; `end()` runs on success and on error; the image smoke with an unreachable DB exits 1 within 20 s and leaks no host or password.
- [ ] Web and worker images resolve `pg` (and `kysely` for the worker) at runtime (`check-image.sh` probes).
- [ ] The r3-guard rules listed above pass, with regex self-tests.
- [ ] Production keeps working; no release is cut (same release rule as STK-081).
- [ ] `typecheck`, `lint`, `test`, `test:db`, `db:check`, `check:service-key` and `build` are green.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-081 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md and the shared-Postgres standard above.
- Ming's manual step: none.

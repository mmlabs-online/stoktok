# STK-080 consult: software-architect

## Findings

**Current data layer**
- F1. `Db` is `Pick<SupabaseClient,'from'|'rpc'>` (`packages/db/src/client.ts:3`). It is built from `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in an env object that the caller passes in (`client.ts:6-13`). It has two callers: `apps/web/server/db.ts:11-13`, which creates it lazily behind `server-only`, and `apps/worker/src/cli.ts:73` / `apps/worker/src/ai.ts:11`.
- F2. The repos use PostgREST semantics that a new driver has to reproduce exactly:
  - Upserts with `onConflict`: `prices-daily.ts:140`, `prices-intraday.ts:46`, `financials.ts:35`, `financial-lines.ts:40`, `signals.ts:53`, `lottery.ts:119`, `symbols.ts:25,38`, `settings.ts:85,139`, `ai-summaries.ts:16`.
  - `ignoreDuplicates` (insert … on conflict do nothing): `news.ts:14`.
  - `count:'exact'`: `transactions.ts:49`.
  - RPCs: `ai_reserve`/`ai_month_spend` (`ai-usage.ts:25,71`) and `ai_key_set/delete/secrets` (`ai-keys.ts:34,47,64`).
  - Errors come back as `res.error` values and are mapped by SQLSTATE (`errors.ts:31-42`). `fetchAll` exists only to page past PostgREST `max_rows` (`errors.ts:50-65`).
- F3. Type shape. Mappers expect DATE and timestamptz as **strings**. Core already rejects a JS `Date` and says "configure the driver to return DATE as string (pg type 1082)" (`packages/core/src/db/mappers.ts:37-39`). The `typeof row.fetched_at !== 'string'` checks (`packages/db/src/mappers.ts:51,107,147,185`) will fail under `pg`'s defaults. PostgREST sends bigint as JSON numbers, while `pg` returns int8 and `count(*)` as strings. `toSafeInt` accepts strings and bigint (`core/src/db/mappers.ts:24-35`), but any mapper that reads a bigint without it will break.
- F4. Tests. `packages/db/test/fake-client.ts:14-53` fakes the supabase-js builder chain. It becomes worthless once the driver changes. CI already runs a `postgres:16` service (`.github/workflows/ci.yml:24-31,48-50`), and `db-check.sh` can start a throwaway cluster locally (`scripts/db-check.sh:26-43`).
- F5. Migrations are tied to Supabase:
  - Every migration grants to `service_role` and revokes from `anon`/`authenticated` (e.g. `20261023000200_v1_rls_grants.sql:6-19`, `20261109000100_ai_usage.sql:29-31,90-93`).
  - `ai_keys` refuses to apply without Vault (`20261110000200_ai_keys.sql:6-11`).
  - `db:check` creates those roles plus a Vault stub that stores plaintext (`scripts/db-check/bootstrap-roles.sql:1-52`).
  - The checks hard-code them: `checks.sql:186-199` (RLS on, no policies), `201-223` (anon/authenticated denied), `242+` (`set local role service_role`), `824` (definer allowlist), `834` (Vault direct denied).
- F6. **RLS trap.** Tables have RLS enabled with **no policies**. That works today only because `service_role` is `BYPASSRLS` (`bootstrap-roles.sql:6`). A plain least-privilege app role without BYPASSRLS would see zero rows and fail every write.
- F7. Auth is already separate from the data layer. `AUTHEN_SUPABASE_URL/ANON_KEY` are read only in `apps/web/server/auth/config.ts:11-16`, and `@supabase/ssr` is used only in `apps/web/server/auth/authen-client.ts:2-3`. One loose end: `.env.example:6` says "same value as SUPABASE_URL", which stops being true.
- F8. R3 tooling names Supabase directly:
  - `r3-guard.test.ts:35-41` (`SUPABASE_SERVICE_ROLE_KEY` allowed only in `client.ts`), `:104-127` (`ai_key_secrets`/`ai_key_set`/`ai_key_delete` allow-lists), `:151-155` (no `vault.` references).
  - `check-no-service-key-in-client.sh:8,17` (sentinel and needles for the service key).
  - `check-image.sh:38-40` (web smoke passes `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).
  - `apps/web/test/healthz.test.ts:29`.
- F9. Bundling. The worker bundles `@stoktok/db` but treats other dependencies as external (`apps/worker/tsup.config.ts:7`), so `pg` must be a runtime dependency of the worker image. Web transpiles `@stoktok/db` (`next.config.ts:7`).
- F10. Deploy facts. The worker is one-shot: one container per job, run by a launchd LaunchAgent on an **Intel Mac running OrbStack**, not WSL2 (`docs/adr/0003-deploy-and-scheduling.md:6-12,32-34`). `CLAUDE.md` Stack ("WSL2 home server") is out of date, and this ticket's CLAUDE.md edit should fix it. `/healthz` does not touch the DB (ADR 0003:15).
- F11. ADR 0009's threat model says DB statement logging can capture RPC parameters, meaning the plaintext key (`0009-ai-provider-keys-in-vault.md:24`). Once Ming runs Postgres himself, he owns `log_statement`.

## Recommendations

**R-1 Driver: `pg` (node-postgres) Pool plus Kysely as a thin query builder.** (AC1)
- **Option A (recommended): `pg` + Kysely.**
  - Kysely is pure TypeScript with no native code, and it sits on a `pg.Pool`. Its chain style is close to the current supabase-js code, so porting 17 repos is mostly mechanical.
  - Dynamic filters (`listTransactionsPage`) and multi-row chunked upserts come out safe and typed (`onConflict(oc => oc.columns([...]).doUpdateSet(...))`, `.doNothing()` for news).
  - RPCs become ``sql`select * from public.ai_reserve(...)` ``.
  - Trade-off: a hand-written `Database` interface (or kysely-codegen) has to be kept in step with the SQL migrations.
- **Option B: raw `pg` plus two helpers** (`upsertRows(table, rows, conflictCols, {ignoreDuplicates})` and `selectWhere`). Fewest dependencies and easiest to read, but SQL gets built by string concatenation across 17 repos, which is where bugs and injection risks live.
- **Rejected:**
  - Drizzle: a TS schema duplicates the SQL migrations and pulls in its own migration tooling, which conflicts with `db:check`.
  - postgres.js: its type and transform conventions differ, and it gives no advantage here.
- **Contract to keep:**
  - Rename `Db` to an opaque handle, e.g. `{ kysely: Kysely<Database>; keyring?: AiKeyring }`. Keep every exported function name and signature from `packages/db/src/index.ts`.
  - Add one helper that reproduces supabase "upsert = update every provided column": `doUpdateSet` over the keys of the row, minus the conflict columns.
  - Replace `unwrap`/`res.error` with a `try`/`catch` that maps `err.code` (SQLSTATE) to `DataError`, with the same codes as `errors.ts:33-38`.
  - Delete `fetchAll`.
- **Type parsers per pool**, using the `types` option on the pool rather than the global `pg.types.setTypeParser`:
  - 1082 DATE → raw string.
  - 1184/1114 timestamptz → normalise to ISO form (`T` separator, `+00:00`) so output matches what PostgREST produced.
  - int8 → keep as string, and add a test asserting every bigint column goes through `toSafeInt`.
  - jsonb params must be `JSON.stringify`'d: `pg` serialises JS arrays as PG array literals, which breaks `lottery_tickets.lines`, `signals.inputs_snapshot`, `ai_summaries.body`.
- **Tests:** replace `fake-client.ts` with integration tests that run against real Postgres. Apply the migrations into a throwaway DB, using `DB_TEST_URL` in CI (the existing service) and the `db-check.sh` initdb path locally, via a `pnpm test:db` script that CI runs. Keep pure mapper unit tests in `pnpm test`. Do not silently skip DB tests when the env var is missing in CI; fail instead. (AC1, AC7, R8)

**R-2 Pooling.** (AC2)
- One `pg.Pool` per process, created lazily:
  - Web: `getDb()` keeps its lazy singleton (`server/db.ts:11-13`); also store it on `globalThis` in dev so HMR does not leak pools.
  - Worker: `max: 2`. Jobs are sequential (ADR 0003:12).
- Web pool settings: `max: 5`, `idleTimeoutMillis: 10_000`, `connectionTimeoutMillis: 5_000`. Set `application_name` to `stoktok-web` / `stoktok-worker`, and add `statement_timeout` (~15s web, ~120s worker) via `options`. All of these values are config, not literals (R5 spirit).
- No PgBouncer: one host, total under 10 connections, well inside the default `max_connections=100`.
- **The worker must `await pool.end()` in a `finally` in `cli.ts` main.** It ends with `process.exitCode`, not `exit()` (`cli.ts:154,159-162`), so idle clients would otherwise hold the process open until the idle timeout.

**R-3 Keeping R3 and r3-guard meaningful.** (AC2, R3)
- Env names:
  - Use specific names: `STOKTOK_DATABASE_URL` (not the generic `DATABASE_URL`, which third-party docs and tools also mention) and `STOKTOK_AI_KEYS_MASTER_KEY`.
  - Each may be referenced only in `packages/db/src/client.ts` (master key: one `keyring.ts`) plus its tests. This replaces the rule at `r3-guard.test.ts:35-41`.
  - Keep the "env read from a passed object, never a module global" pattern (`client.ts:5`).
- New guards, modelled on the SDK guard at `r3-guard.test.ts:65-68`:
  - (a) `pg`/`kysely` are imported only under `packages/db/`.
  - (b) `@supabase/` is imported only under `apps/web/server/auth/**` (tests included). This also enforces "Supabase Auth for login only" (AC5).
  - (c) `node:crypto` decrypt of AI keys happens only in the ai-keys repo or keyring.
  - Keep `:43-55`: no `@stoktok/db` from `'use client'` files, and only `server/db.ts` imports it in web.
- Bundle check (`check-no-service-key-in-client.sh`):
  - Build with sentinels `STOKTOK_DATABASE_URL=postgres://stoktok_app:pw-SENTINEL-$RANDOM@db.invalid:5432/stoktok` and a sentinel master key.
  - Add needles: the two env names, `postgres://`, `postgresql://`, `pg-protocol`.
  - Keep the old Supabase needles for one release (they cost nothing).
- `check-image.sh:38-40`: pass a dummy `STOKTOK_DATABASE_URL` instead of the Supabase vars. Add a worker probe that `pg` resolves in the image (pairs with STK-077's SDK probe).
- `DataError` messages must never include the connection string, and the pool config must never be logged (`errors.ts:10`).

**R-4 Replacing Vault: app-side envelope crypto, not `pgcrypto`.** New ADR 0010 supersedes ADR 0009. (AC4, R3)
- **Recommended: AES-256-GCM in Node** (`node:crypto`).
  - Master key: `STOKTOK_AI_KEYS_MASTER_KEY`, 32 bytes base64, server-only, in the host env file next to the other secrets (ADR 0003:13).
  - `ai_keys` columns: `provider, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4, updated_at`.
  - Use AAD = `provider`, so ciphertext cannot be swapped between providers.
  - Plaintext and the master key never reach Postgres. That removes the parameter-logging exposure (ADR 0009:24) and the "service key → POST rpc → plaintext" exposure (0009:21). Backups hold only ciphertext.
- **Rejected: `pgcrypto` `pgp_sym_encrypt($key, $master)`.** It sends both the plaintext and the master key as statement parameters (logs, `pg_stat_activity`), and needs an extension.
- What to keep from ADR 0009:
  - Precedence UI → env → disabled (§3), no cache (§4), fail closed on read or decrypt error (§5, §9), format rule (§6).
  - **Missing master key with no stored rows** → return empty, so the env fallback still works. **Rows exist but the key is missing or wrong** → fail closed with `provider_unavailable`.
- Signatures: keep `saveAiKey/readAiKeySecrets/deleteAiKey/listAiKeyMeta` unchanged by putting `keyring` on the `Db` handle (see R-1). Without that, 3 callers change: `apps/web/server/ai-keys.ts`, `server/ai.ts`, `apps/worker/src/ai.ts`.
- Writes become one `insert … on conflict` in the repo. The three `security definer` functions go away. `security_definer_allowlist` (`checks.sql:824`) becomes empty, and the check still fails on any new definer function.
- Rewrite r3-guard `:104-127,151-155` for the new entry points.
- Document master-key rotation (`key_version`); implementing rotation is a follow-up.

**R-5 Roles and migrations on plain Postgres.** (AC3)
- **Squash into one baseline**, e.g. `db/migrations/<ts>_baseline.sql` plus a rollback, equal to today's schema minus Supabase roles and Vault. Archive the `supabase/migrations` history read-only.
- Prove the squash is faithful with a schema diff: `pg_dump --schema-only -n public` of Supabase versus the new DB, normalised and with grants and Vault excluded, recorded in the runbook.
- Rejected alternative: creating placeholder `anon/authenticated/service_role` roles in production. That violates AC3.
- Roles:
  - `stoktok_owner` (NOLOGIN, owns all objects; migrations run `SET ROLE stoktok_owner` from Ming's admin login or pgAdmin).
  - `stoktok_app` (LOGIN): CONNECT, USAGE on `public`, DML on the tables, USAGE/SELECT on sequences, EXECUTE on `ai_reserve`/`ai_month_spend`. No CREATE, no BYPASSRLS. Revoke everything from PUBLIC.
- RLS (F6), two options. I lean to (a); ask the database-optimizer.
  - (a) Keep RLS on and add one `for all to stoktok_app using (true) with check (true)` policy per table. This keeps "a new table is closed by default". Rewrite checks `:186-199` as "RLS on and exactly that policy".
  - (b) RLS off and grants as the only gate. Simpler, and with no PostgREST exposure grants are the real gate, but you lose the closed-by-default property.
- `checks.sql`: replace `anon/authenticated` with a `stoktok_noaccess` test role, which must be denied everywhere, and `service_role` with `stoktok_app`. Assert `stoktok_app` cannot run DDL. Remove the Vault stub (`bootstrap-roles.sql:13-52`).
- Migration runner: a small `scripts/db-migrate.sh` (psql + `schema_migrations` table), consistent with `db-check.sh`. No new tool.

**R-6 Supabase Auth for login only.** (AC5)
- No code change in `apps/web/server/auth/*`, `proxy.ts`, or `/login`.
- Remove `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`.env.example:9-13`) and fix the comment at `:6`.
- Remove `@supabase/supabase-js` from `packages/db/package.json:18` and `apps/worker/package.json:23`. Keep it in `apps/web` for `@supabase/ssr` (`apps/web/package.json:20-21`).
- Update `healthz.test.ts:29`.
- Guard (b) in R-3 fixes this boundary in place.

**R-7 Slices**, each deployable on its own (strangler path: swap the driver while still on Supabase's Postgres, cut over last).
- **080a – Driver foundation (no behaviour change).**
  - `pg` + Kysely client, pool config, type parsers, error mapping, upsert helper, DB integration-test harness (`pnpm test:db` in CI).
  - ADR 0010 "Self-hosted Postgres data layer". CLAUDE.md Stack and R3 text.
- **080b – Port all 17 repos and callers in one change.**
  - Remove supabase-js from db and worker; r3-guard and bundle-check updates; worker `pool.end()`.
  - Deploy pointing `STOKTOK_DATABASE_URL` at **Supabase's Postgres** (session pooler, port 5432; `pg` uses unnamed statements, so pooler mode is not an issue). The Vault RPCs keep working there via `select * from ai_key_*(...)`.
  - Largest slice. Splitting it makes `Db` dual-typed, which is not worth it.
- **080c – AI keys app-side crypto.** ADR supersedes 0009. New forward migration for `ai_keys`, applied on Supabase too, dropping the wrappers. r3-guard and checks updates. Ming re-enters keys.
- **080d – Plain-Postgres baseline, roles, RLS decision, `db-migrate.sh`, `db:check` rewrite.** Must come after 080c, so the baseline has no Vault.
- **080e – Data migration and cutover.**
  - Runbook: `pg_dump --data-only` with an explicit table list excluding `ai_keys` (or an ordered `COPY`); load in FK order (`ai_usage` before `ai_summaries`); `setval` identity and serial sequences.
  - Verify with per-table count plus an md5 over rows ordered by PK.
  - Switch `STOKTOK_DATABASE_URL`; keep the Supabase tables untouched for a rollback window.
  - Backup note: nightly `pg_dump -Fc` via LaunchAgent, retention, restore test, master key stored apart from backups.
  - Spec §7 (`docs/spec-v1.md:121-142,208-214,253`).
- **STK-077 ordering:** after 080b. STK-077 likely adds repo queries for its inputs (news, signals, lines per symbol). Before 080b they would be written in supabase-js and ported again. After 080b, STK-077 can run in parallel with 080c–e: it uses `readAiKeySecrets` and the ledger only through the public functions, and its tests use the fake provider. If Ming wants STK-077 sooner, freeze new `packages/db` functions in it, or accept porting them in 080b.

## Risks
- **Supabase Free pausing.** Once the DB moves, the Supabase project sees only login traffic, so the inactivity pause becomes more likely and would break `/login` (spec:253). Mitigations: a keep-alive (the worker calls an Auth health endpoint daily), or Ming moves to a paid plan or accepts the risk.
- Behaviour drift from type parsing (timestamptz format, int8 strings, jsonb arrays) would only show at runtime. That is why integration tests against real Postgres are required in 080b.
- `pg` errors carry `detail` with row values (e.g. "Key (url)=(…)"). `unwrap` attaches errors as `cause` (`errors.ts:34-38`), so anything that logs `cause` leaks data. `ai-keys` must keep the no-`cause` rule (`ai-keys.ts:17-24`); with app-side crypto the key is never in SQL anyway.
- A squashed baseline can silently drop an object (check, index, comment). Mitigate with the recorded schema diff in 080d.
- During 080b–080e the app connects to Supabase Postgres as a role with broad rights (`postgres` or a custom role). A dedicated Supabase login role with only the needed grants limits that.
- The worker hangs on exit if the pool is not ended; the LaunchAgent `mkdir` lock (ADR 0003:12) would then block later jobs.
- The master key is lost → stored AI keys are unrecoverable. Acceptable, because keys can be re-entered and the env fallback exists, but document it.
- Postgres reachability: never route 5432 through the Cloudflare Tunnel. pgAdmin must sit behind Access or stay LAN-only.

## Open questions (for Ming)
1. Where does Postgres run: an OrbStack container on a shared external Docker network (recommended: `stoktok-web` and `stoktok-worker` join it and use `postgres:5432`), or on the macOS host (`host.docker.internal:5432`)? Which PG major version (CI uses 16)? Is TLS needed if it is never exposed?
2. RLS: keep it on with one app policy per table, or turn it off and rely on grants? Database-optimizer to weigh in.
3. Accept squashing migration history into a baseline?
4. Accept app-side AES-GCM with a master key in the host env file over `pgcrypto`?
5. Supabase project pausing: keep-alive, paid plan, or accept?
6. Run STK-077 after 080b (recommended), or before, accepting a port of its repo code?
7. How long to keep the Supabase tables after cutover, and when to drop them?
8. Backup target and retention: local disk, external drive, or cloud; how many days?

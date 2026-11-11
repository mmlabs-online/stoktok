Status: READY

# Plan — STK-080: Move the data layer from Supabase to self-hosted Postgres (keep Supabase Auth) — slice a: driver foundation

This ticket is too big for one implement/review cycle (see `## Split proposal`). **This plan covers slice a (STK-080) only:**
the `pg` + Kysely foundation inside `packages/db`: pool factory and profiles, session settings, per-pool type parsers, the
SQLSTATE → `DataError` mapper for thrown driver errors, the upsert/jsonb helpers that reproduce PostgREST upsert semantics,
the hand-written `Database` schema interface, a real-Postgres integration-test harness (`pnpm test:db`, required in CI),
R3 guards for the new env name and driver imports, and ADR 0010.

**No behaviour change.** Nothing in `apps/` imports the new code in this slice. It is published under a subpath
export (`@stoktok/db/pg`) so the web server graph and the worker bundle stay unchanged (see Approach step 1). All 17
repos keep using supabase-js until STK-081.

Estimated size: about 450 production lines plus about 450 test lines plus the ADR. This is larger than the 400-line
guideline. The `Database` interface (about 200 lines of types) is kept here on purpose so the repo-port slice
(STK-081), which is already the largest, does not grow further.

## Spec summary
- Ticket goal: "Replace supabase-js / PostgREST data access with direct Postgres access from server code (web server and worker) against the Postgres instance Ming runs on the home server."
- Ticket AC1: "`packages/db` talks to Postgres through a server-only driver (`pg` or a query builder …). … all 17 repos and their callers keep the same public functions and behaviour (upserts, conflict keys, the `ai_reserve` / `ai_month_spend` functions)."
- Ticket AC2: "Connection string is server-only config (R3): never `NEXT_PUBLIC_*`, never in client bundles; the existing service-key bundle check is updated to cover it. A connection pool with sensible limits for web + worker on one host."
- Ticket AC7: "`typecheck`, `lint`, `test`, `db:check` green; repo tests work without Supabase."
- Ming, 2026-11-11: "(3) Driver: `pg` + Kysely." "(1) Postgres runs as a container on a shared Docker network with the stoktok containers (reach it by service name, e.g. `postgres:5432`; DB port not published)." "(4) Supabase Free pausing …: accept the risk, no keep-alive." "(2) Squash the migration history into one plain-Postgres baseline (keep the old files for reference)."
- CLAUDE.md R2: "Money and prices are integers in VND … No floats for money."
- CLAUDE.md R3: "Service role key is server-only. … Never in `NEXT_PUBLIC_*`, never in client bundles."
- CLAUDE.md R8: "New or changed `packages/core` logic must have unit tests." (This slice changes `packages/db`, not core. The same standard is applied.)
- `packages/core/src/db/mappers.ts:37-39`: "got a Date; configure the driver to return DATE as string (pg type 1082)".

## Acceptance criteria → verification
Slice a covers AC1 (driver choice and foundation only; no repo is ported), AC2 (pool limits, server-only env name, R3 guard and bundle check) and the test-infrastructure half of AC7. AC3–AC6, the repo port in AC1, and the doc part of AC7 belong to STK-081…STK-084.

| # | Criterion (slice a part) | How the reviewer verifies it |
|---|---|---|
| 1 | `pg` + Kysely are dependencies of `packages/db` only, and are reachable only through `@stoktok/db/pg` | `packages/db/package.json` diff; `r3-guard.test.ts › pg and kysely are imported only under packages/db/` passes; `grep -rn "@stoktok/db/pg" apps` returns nothing |
| 2 | `createPgDb(env, profile)` reads `STOKTOK_DATABASE_URL` from the passed env object. A missing or invalid URL throws a message that names the variable and never echoes the value. No connection is opened at construction. | `src/pg/client.test.ts › throws naming the variable without echoing the value`, `› rejects non-postgres schemes`, `› constructing does not connect` |
| 3 | The pool profiles `web` (max 5) and `worker` (max 2) carry timeouts and `application_name`, and are config, not literals at the call site. Every new connection gets `TimeZone=UTC`, `DateStyle=ISO, YMD`, the statement timeout and the application name. | `src/pg/client.test.ts › profile values reach the pool config`; `test-db/session.test.ts › each connection has UTC, ISO datestyle, statement_timeout and application_name` |
| 4 | Type parsers are per pool (not global): DATE and DATE[] become raw `YYYY-MM-DD` strings; timestamptz becomes a PostgREST-shaped ISO string (`YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00`); int8 stays a string that `toSafeInt` accepts; jsonb, text[] and smallint[] are parsed. | `src/pg/types.test.ts` (pure normaliser cases); `test-db/types.test.ts › round-trips every column type used in public`; `› global pg.types is untouched` |
| 5 | Every column type in `public` is covered by a parser decision. A new type (e.g. `timestamp without time zone`, `numeric`) fails the test. | `test-db/types.test.ts › every public column type is in the handled set` |
| 6 | Thrown driver errors map to `DataError` with the same codes as `unwrap`: 23505 → CONFLICT; 23502/23514/22P02 → VALIDATION; else DB_ERROR. Non-SQLSTATE errors (ECONNREFUSED, ENOTFOUND) → DB_ERROR with no pgCode. The message holds table, op and code only, with no `cause`, so no `detail`, values, host, URL or password can leak. | `src/errors.test.ts › toDataError …` cases; `test-db/errors.test.ts › unique violation on a real table maps to CONFLICT without the key value`, `› unreachable server maps to DB_ERROR without host or password` |
| 7 | `upsertInto` reproduces the PostgREST upsert: `on conflict (cols) do update set` covering exactly the provided non-conflict columns (columns not provided stay unchanged); `ignoreDuplicates` → `do nothing`; rows with different key sets throw; chunks respect the 65 535 bind-parameter limit. | `src/pg/upsert.test.ts` (compiled SQL via a DummyDriver Kysely); `test-db/upsert.test.ts › partial-column upsert leaves other columns unchanged`, `› ignoreDuplicates returns only inserted ids`, `› duplicate conflict key in one batch fails with 21000 → DB_ERROR` |
| 8 | `jsonb(value)` stores JS arrays and objects as jsonb (a raw JS array would otherwise be sent as a PG array literal). | `test-db/upsert.test.ts › jsonb helper round-trips an array and an object` |
| 9 | `PgDb.end()` drains the pool, so a one-shot process can exit. | `test-db/session.test.ts › end() closes all clients (totalCount 0) and later queries reject` |
| 10 | The `Database` interface matches the migrated schema for the 18 public tables. | `pnpm typecheck` plus the test:db queries that use real tables through `Kysely<Database>` (prices_daily, news, signals or ai_summaries, settings) |
| 11 | `pnpm test:db` runs against a real Postgres. It fails, and does not skip, when `DB_TEST_URL` is unset, and it refuses a host that is not localhost. CI runs it. | Run `pnpm test:db` with no env: it exits non-zero with a clear message. `ci.yml` has a `pnpm test:db` step with `DB_TEST_URL`. `test-db/global-setup.ts` has the host check. |
| 12 | R3: `STOKTOK_DATABASE_URL` is referenced only in `packages/db/src/pg/client.ts` and its test. The bundle check builds with a sentinel URL and scans for it, its password, `STOKTOK_DATABASE_URL`, `postgres://`, `postgresql://` and `pg-protocol`. | `r3-guard.test.ts › STOKTOK_DATABASE_URL is referenced only in packages/db/src/pg/client.ts (and its test)`; `pnpm check:service-key` passes and prints the new needles |
| 13 | ADR 0010 records the decisions (driver, network, pool, parsers, errors, roles/RLS, AI-key direction, baseline, data move, Supabase pausing, slice order). | `docs/adr/0010-self-hosted-postgres-data-layer.md` exists and covers the sections listed under Approach step 9 |
| 14 | No behaviour change, and the checks are green. | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm db:check`, `pnpm check:service-key` and `pnpm build` all pass. Existing supabase-js repo tests are unchanged and still pass. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/db/package.json` | Add deps `pg`, `kysely`; devDep `@types/pg`; script `test:db` (`vitest run -c vitest.db.config.ts`); `exports["./pg"] = "./src/pg/index.ts"` | AC1, AC11 |
| `pnpm-lock.yaml` | Lockfile update | New deps |
| `packages/db/src/pg/index.ts` | New. Subpath barrel: `createPgDb`, `PgDb`, `PG_POOL_PROFILES`, `PgProfile`, `upsertInto`, `chunkForParams`, `jsonb`, `Database` types | AC1, keeps apps untouched |
| `packages/db/src/pg/config.ts` | New. `PG_POOL_PROFILES: Record<'web'\|'worker', {max, idleTimeoutMillis, connectionTimeoutMillis, statementTimeoutMs, applicationName}>` = web `{5, 10_000, 5_000, 15_000, 'stoktok-web'}`, worker `{2, 10_000, 5_000, 120_000, 'stoktok-worker'}`; `PG_MAX_BIND_PARAMS = 65_535` | AC3 (limits as config, R5 spirit) |
| `packages/db/src/pg/types.ts` | New. `normalizeTimestamptz(raw)`; `buildTypeParsers()` returning a `pg` `CustomTypesConfig` (1082, 1182, 1184, 1185; int8 left as string) | AC4 (R2 and the core `toDate` contract) |
| `packages/db/src/pg/client.ts` | New. `createPgDb(env, profile, overrides?) → PgDb { kysely: Kysely<Database>; end(): Promise<void> }`; URL validation; the `pool.on('connect')` session `SET`; `pool.on('error')` that logs only `{event:'db_pool_error', code}` | AC2, AC3, AC9 |
| `packages/db/src/pg/schema.ts` | New. Hand-written `Database` interface for the 18 public tables (column types per the conventions in Approach step 4) | AC10 |
| `packages/db/src/pg/upsert.ts` | New. `upsertInto(db, table, rows, conflictCols, {ignoreDuplicates?})` returns an `InsertQueryBuilder` (the caller adds `.returning()` and executes it); `chunkForParams(rows, maxParams)`; `jsonb(value)` | AC7, AC8 |
| `packages/db/src/errors.ts` | Add `toDataError(e, ctx): DataError` and `async function run<T>(ctx, fn): Promise<T>`. `unwrap`, `unwrapFound` and `fetchAll` stay unchanged (supabase repos still use them) | AC6 |
| `packages/db/src/pg/types.test.ts` | New unit tests | AC4 |
| `packages/db/src/pg/client.test.ts` | New unit tests | AC2, AC3 |
| `packages/db/src/pg/upsert.test.ts` | New unit tests (compile-only, DummyDriver) | AC7 |
| `packages/db/src/errors.test.ts` | Add `toDataError` / `run` cases | AC6 |
| `packages/db/src/r3-guard.test.ts` | Add two rules: STOKTOK_DATABASE_URL location; `pg`/`kysely`/`pg-*` imports only under `packages/db/` (plus a regex self-test). Existing rules unchanged | AC1, AC12 |
| `packages/db/vitest.db.config.ts` | New. Includes `test-db/**/*.test.ts`, `globalSetup: './test-db/global-setup.ts'`, `fileParallelism: false`, `testTimeout` 30 s | AC11 |
| `packages/db/test-db/global-setup.ts` | New. Requires `DB_TEST_URL` (else throws); refuses a host other than localhost/127.0.0.1 (same rule as `db-check.sh:19-24`); creates template DB `stoktok_test_tpl_<pid>`; applies `scripts/db-check/bootstrap-roles.sql`, then `supabase/migrations/*.sql` in name order, each inside BEGIN/COMMIT; teardown drops all `stoktok_test_*_<pid>` DBs | AC11 |
| `packages/db/test-db/harness.ts` | New. `freshDb(profile='worker')`: `create database stoktok_test_<n>_<pid> template <tpl>` and returns `{ pgDb, url, drop() }` built through `createPgDb({ STOKTOK_DATABASE_URL: url }, …)` | AC11 |
| `packages/db/test-db/types.test.ts` | New | AC4, AC5 |
| `packages/db/test-db/session.test.ts` | New | AC3, AC9 |
| `packages/db/test-db/errors.test.ts` | New | AC6 |
| `packages/db/test-db/upsert.test.ts` | New | AC7, AC8, AC10 |
| `packages/db/tsconfig.json` | `include` adds `test-db` and `vitest.db.config.ts` | typecheck covers the harness |
| `package.json` (root) | Script `"test:db": "pnpm --filter @stoktok/db test:db"` | AC11 |
| `.github/workflows/ci.yml` | Step `pnpm test:db` with `DB_TEST_URL: postgresql://postgres:postgres@localhost:5432/postgres`, after `pnpm test` and before `pnpm db:check` | AC11, R8 |
| `scripts/check-no-service-key-in-client.sh` | Build env adds `STOKTOK_DATABASE_URL="postgres://stoktok_app:pw-SENTINEL-$RANDOM$RANDOM@db.invalid:5432/stoktok"`. Needles add the sentinel password, `STOKTOK_DATABASE_URL`, `postgres://`, `postgresql://`, `pg-protocol`. The Supabase needles stay. | AC12 |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | New ADR | AC13 |

Not touched in this slice: every repo, `client.ts` (supabase), `apps/**`, `next.config.ts`, the worker tsup config, `check-image.sh`, `.env.example`, `CLAUDE.md`, `docs/spec-v1.md`, migrations and `db:check` itself (see Split proposal).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `src/pg/types.test.ts › normalizes '2026-11-10 08:00:00+00' to '2026-11-10T08:00:00+00:00'` | timestamptz format, no fraction |
| `src/pg/types.test.ts › keeps microseconds '…08:00:00.123456+00' → '…T08:00:00.123456+00:00'` | no precision loss (unlike `toISOString`) |
| `src/pg/types.test.ts › pads '+07', keeps '+05:30', handles '-03'` | offset forms |
| `src/pg/types.test.ts › 'infinity' / '-infinity' / malformed are returned unchanged` | the mapper decides; the parser never throws |
| `src/pg/types.test.ts › DATE and DATE[] parsers return raw strings; int8 parser is not overridden` | 1082/1182/20 |
| `src/pg/client.test.ts › throws naming the variable without echoing the value` | missing or empty `STOKTOK_DATABASE_URL` |
| `src/pg/client.test.ts › rejects non-postgres schemes (http://, mysql://) without echoing the value` | URL validation |
| `src/pg/client.test.ts › constructing does not connect` | Pool `totalCount === 0` right after `createPgDb` on an unreachable URL |
| `src/pg/client.test.ts › profile values reach the pool config; overrides win` | web/worker max and timeouts |
| `src/pg/upsert.test.ts › do update set lists provided non-conflict columns from excluded` | PostgREST semantics |
| `src/pg/upsert.test.ts › ignoreDuplicates compiles to on conflict do nothing` | news path |
| `src/pg/upsert.test.ts › only conflict columns provided → do nothing` | edge case |
| `src/pg/upsert.test.ts › rows with different key sets throw; undefined values count as absent` | uniform-payload rule |
| `src/pg/upsert.test.ts › conflict column not in the row keys throws` | misuse guard |
| `src/pg/upsert.test.ts › chunkForParams splits at floor(maxParams / ncols) rows` | bind limit |
| `src/errors.test.ts › toDataError maps 23505 → CONFLICT; 23502, 23514, 22P02 → VALIDATION; 40001 → DB_ERROR` | SQLSTATE parity with `unwrap` |
| `src/errors.test.ts › toDataError: non-SQLSTATE code (ECONNREFUSED) → DB_ERROR without pgCode` | connection errors |
| `src/errors.test.ts › toDataError: message never contains err.message, err.detail, host or password; no cause` | leak guard |
| `src/errors.test.ts › toDataError passes DataError through unchanged; RowMappingError → MAPPING` | composition with `mapRow` |
| `src/errors.test.ts › run() resolves the value and rethrows mapped` | wrapper |
| `src/r3-guard.test.ts › STOKTOK_DATABASE_URL is referenced only in packages/db/src/pg/client.ts (and its test)` | R3 |
| `src/r3-guard.test.ts › pg and kysely are imported only under packages/db/` + regex self-test | driver boundary |
| `test-db/types.test.ts › round-trips every column type used in public` | One row per type through real PG: date → string, date[] → string[], timestamptz → `+00:00` ISO, int8 → digit string accepted by `toSafeInt`, jsonb → object/array, text[] → array, smallint[] → number[], uuid → string, boolean → boolean |
| `test-db/types.test.ts › every public column type is in the handled set` | Query `information_schema.columns` (udt_name) for `public`; assert ⊆ the handled set. This guards against `timestamp`, `numeric`, `float*` and `money` |
| `test-db/types.test.ts › global pg.types is untouched` | `pg.types.getTypeParser(1082)` still returns the library default after a pool is created |
| `test-db/session.test.ts › each connection has UTC, ISO datestyle, statement_timeout and application_name` | `show timezone`, `show datestyle`, `show statement_timeout`, `current_setting('application_name')` on 2 concurrent connections |
| `test-db/session.test.ts › end() closes all clients (totalCount 0) and later queries reject` | one-shot worker exit |
| `test-db/errors.test.ts › unique violation on a real table maps to CONFLICT without the key value` | e.g. a duplicate `news.url` via plain insert; the message does not contain the URL |
| `test-db/errors.test.ts › check violation maps to VALIDATION` | a real check constraint |
| `test-db/errors.test.ts › unreachable server maps to DB_ERROR without host or password` | `postgres://u:pw-x@127.0.0.1:1/x` |
| `test-db/upsert.test.ts › partial-column upsert leaves other columns unchanged` | `prices_daily` on `(symbol, trade_date)` |
| `test-db/upsert.test.ts › full-row upsert replaces every provided column` | same table |
| `test-db/upsert.test.ts › ignoreDuplicates returns only inserted ids` | `news` on `url`, with `.returning('id')` |
| `test-db/upsert.test.ts › duplicate conflict key in one batch fails with 21000 → DB_ERROR` | documents why repos keep the JS dedup |
| `test-db/upsert.test.ts › jsonb helper round-trips an array and an object` | a jsonb column (`signals.inputs_snapshot` or `ai_summaries.body`) |
| `test-db/upsert.test.ts › chunked upsert of more than one chunk writes every row` | chunk loop with a small `maxParams` |

## Approach
1. **Subpath, not index.** Export the new API only from `@stoktok/db/pg` (`package.json` `exports["./pg"]`). `apps/web/server/db.ts` does `export * from '@stoktok/db'`. Adding `pg` to the index would pull `pg` into the Next server graph, and that needs `serverExternalPackages` plus pnpm resolution work in the standalone image. That wiring belongs to STK-081, together with the worker tsup externals and the `check-image.sh` probe. In this slice no app imports the subpath, so the images and runtime do not change.
2. **`config.ts`**: the profiles as in the Files table. They are typed constants, the single source of these values (R5 spirit). Each value is commented with its reason: web max 5 and worker max 2, because jobs are sequential (ADR 0003), giving well under `max_connections` 100 on one host; worker statement timeout 120 s for bulk upserts; web 15 s.
3. **`types.ts`**:
   - `buildTypeParsers()` returns `{ getTypeParser(oid, format) }`. For 1082 (date) it returns identity. For 1182 (date[]) it uses `pg-types`' array parser with an identity element (or a small parser for `{a,b}` with tests). For 1184 (timestamptz) it uses `normalizeTimestamptz`. For 1185 (timestamptz[]) it uses the array form of the same. Everything else falls through to `pg.types.getTypeParser`.
   - Do not call `pg.types.setTypeParser` (it is global). int8 (20) stays the default string, so `toSafeInt` keeps doing the R2 safe-range check. Do not parse it to `Number` or `BigInt`.
   - `normalizeTimestamptz`: replace the first space with `T`. Rewrite a trailing offset `±HH` as `±HH:00`. Keep `±HH:MM`. Return anything that does not match `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$` unchanged. This matches PostgREST's `to_json(timestamptz)` output under `TimeZone=UTC`, so existing mappers, fixtures and UI strings see the same shape after STK-081.
4. **`schema.ts`**: one interface per table in `supabase/migrations/*.sql` (18 tables, including `ai_keys` in its current Vault shape). Conventions:
   - `bigint` columns → `ColumnType<string, number | string, number | string>`.
   - Identity columns → `Generated<string>`.
   - `date` → `string`; `date[]` → `string[]`.
   - `timestamptz` → `ColumnType<string, string | undefined, string>` when it has a default, else `string`.
   - `jsonb` → `ColumnType<unknown, string, string>`, because writes go through `jsonb()`.
   - `text[]` → `string[]`; `smallint[]` → `number[]`.
   - Nullable → `T | null`.
   - Columns with defaults → `Generated<T>` or `ColumnType<T, T | undefined, T>`.

   Header comment: "Mirrors supabase/migrations; update in the same PR as any migration (until STK-083 makes db/migrations the source)."
5. **`client.ts`**:
   - `createPgDb(env: Record<string, string | undefined>, profile: PgProfile, overrides?: Partial<PoolProfile>)`.
   - Read `env.STOKTOK_DATABASE_URL`. If it is missing or empty, throw `Error('Missing env STOKTOK_DATABASE_URL')`. If it does not start with `postgres://` or `postgresql://`, throw `Error('Invalid env STOKTOK_DATABASE_URL')`. Never interpolate the value.
   - `new pg.Pool({ connectionString, max, idleTimeoutMillis, connectionTimeoutMillis, types: buildTypeParsers() })`.
   - `pool.on('connect', c => c.query("select set_config('TimeZone','UTC',false), set_config('DateStyle','ISO, YMD',false), set_config('statement_timeout',$1,false), set_config('application_name',$2,false)", [String(ms), name]))`. This is used instead of startup `options` so it also works through the Supabase session pooler during STK-081 to STK-083.
   - `pool.on('error', e => console.error(JSON.stringify({ event: 'db_pool_error', code: sqlstateOrNull(e) })))`. Never log the message or the config.
   - Return `{ kysely: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), end: () => kysely.destroy() }`.
   - TLS: whatever `sslmode` the URL carries (pg parses it). No TLS on the Docker network (Ming: port not published).
   - Header: "Server-only (R3)."
6. **`upsert.ts`**:
   - `upsertInto(db, table, rows, conflict, opts)`:
     - Compute each row's key set, ignoring `undefined` values. All rows must have the same key set and include every conflict column; otherwise throw a programming `Error`. This is not a `DataError`: it is a bug in the caller.
     - Build `db.insertInto(table).values(rows).onConflict(oc => oc.columns(conflict) …)`. Use `.doNothing()` when `ignoreDuplicates` is set or the set list is empty. Otherwise use `.doUpdateSet(eb => Object.fromEntries(setCols.map(c => [c, eb.ref(\`excluded.${c}\`)])))`.
     - Column names come only from the row object keys, which are typed by `Insertable<Database[T]>`. Kysely quotes identifiers, so there is no string-built SQL.
   - `chunkForParams(rows, maxParams = PG_MAX_BIND_PARAMS)` returns `T[][]` of at most `floor(maxParams / ncols)` rows. Callers in STK-081 combine it with their existing `chunkSize` option (min of the two).
   - `jsonb(v) = sql\`${JSON.stringify(v)}::jsonb\``.
   - No transaction wrapping in this slice. Whether multi-chunk upserts become one transaction is decided in STK-081.
7. **`errors.ts`**:
   - `toDataError(e, ctx)`:
     - If `e` is already a `DataError`, return it.
     - If it is a `RowMappingError`, return MAPPING (as `mapRow` does).
     - Otherwise read `code` only if it is a string matching `/^[0-9A-Z]{5}$/`. Map 23505 → CONFLICT and 23502/23514/22P02 → VALIDATION; everything else → DB_ERROR. Use the fixed texts `conflict`, `validation failed` and `database error`.
     - Pass **no `cause`**. The `pg` `detail` field echoes key values ("Key (url)=(…)"), and Node net errors carry host and port. This is the same rule `ai-keys.ts` already follows.
   - `run(ctx, fn)` = try/await/catch → throw `toDataError`.
   - The doc comment on `DataError` stays true.
8. **Test harness**:
   - `vitest.db.config.ts` with globalSetup. The setup uses `pg.Client` on `DB_TEST_URL` (an admin URL to a local server).
   - It throws `'pnpm test:db needs DB_TEST_URL (localhost only), e.g. postgresql://postgres:postgres@localhost:5432/postgres'` when the variable is unset. It never skips.
   - It creates the template DB and applies `bootstrap-roles.sql` plus the migrations in name order, each file inside BEGIN/COMMIT. A multi-statement simple query with no params is supported by `pg`. This is the same chain `db:check` applies.
   - Roles are cluster-wide. `bootstrap-roles.sql` is idempotent (`if not exists`), so `test:db` and `db:check` can share the CI server.
   - Each test file calls `freshDb()`, which clones the template.
   - Teardown terminates connections to and drops every DB with this run's suffix.
   - `fileParallelism: false` avoids clone contention on the template.
   - `pnpm test` is unchanged: `vitest.config.ts` includes only `src/**/*.test.ts`, so `test-db/` is not picked up.
9. **ADR 0010** (Status: accepted 2026-11-11, implemented across STK-080…STK-084). Sections:
   - Context: Ming's decision; Auth stays on Supabase.
   - Decision 1: driver `pg` + Kysely. Rejected: raw `pg` helpers (string-built SQL across 17 repos), Drizzle (a second schema source and its own migration tool), postgres.js (different type conventions).
   - Decision 2: network. Postgres container on a shared external Docker network as `postgres:5432`, port not published, never through Cloudflare Tunnel; pgAdmin LAN-only or behind Access; no TLS on that hop.
   - Decision 3: pool profiles and per-connection session settings.
   - Decision 4: type parsing contract (the strings above), plus the int8-as-string rule tied to R2.
   - Decision 5: error mapping and the no-cause rule.
   - Decision 6: env names `STOKTOK_DATABASE_URL` and (STK-082) `STOKTOK_AI_KEYS_MASTER_KEY`, server-only, read from a passed env object.
   - Decision 7: roles `stoktok_owner` (NOLOGIN, owns objects) and `stoktok_app` (LOGIN, DML and EXECUTE only, NOBYPASSRLS). **RLS disabled**, with the reason in Specialist input.
   - Decision 8: AI keys move to app-side AES-256-GCM in STK-082, recorded in its own ADR 0011, which supersedes ADR 0009. pgcrypto is rejected because the key would appear in SQL text and logs.
   - Decision 9: squashed plain-Postgres baseline in STK-083; old files kept for reference.
   - Decision 10: data-only move, cutover and backups in STK-084.
   - Decision 11: Supabase Free pausing accepted with no keep-alive (Ming). The risk is `/login` unavailable after inactivity.
   - Decision 12: test strategy. Real-PG `test:db` required in CI; pure unit tests stay in `pnpm test`.
   - Consequences: the slice order and the STK-077 ordering.
10. **r3-guard**:
    - `STOKTOK_DATABASE_URL` allowed only in `packages/db/src/pg/client.ts` and `client.test.ts`. `client.ts` exports `DATABASE_URL_ENV = 'STOKTOK_DATABASE_URL'`. The test harness builds its env as `{ [DATABASE_URL_ENV]: url }`, so the literal appears only in client.ts and client.test.ts.
    - Driver imports regex: `/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:pg|pg-[\w-]+|kysely)(?:\/[\w/-]+)?['"]/`, with hits allowed only for paths starting `packages/db/`, plus a self-test that covers `'pg'`, `"kysely"`, `import('pg')`, `require('pg-protocol')`, and the non-match `'@stoktok/db/pg'`.
11. **Bundle check**: sentinel URL in the build env, plus the needles listed. Nothing reads the URL during the web build in this slice, so this is pre-positioning. The script is then already correct when STK-081 wires the pool.
12. Rules: R1 (no calculation added), R2 (int8 never becomes a float; parsers tested), R3 (server-only env via passed object, guard, bundle check, no secrets in errors or logs), R5 (pool values in one config object), R7 (no repo or app change), R8 (unit tests plus required CI `test:db`). R6, R9 and R10 are not affected.

## Specialist input used
- Architect R-1 (`pg` + Kysely, opaque handle, upsert helper over provided keys, `try/catch` SQLSTATE mapping, per-pool parsers, jsonb stringify, real-PG tests that fail rather than skip): **adopted**. Ming confirmed the driver. The `Db` rename and the removal of `fetchAll` are deferred to STK-081, where repos move.
- Architect R-2 (pool sizes, `application_name`, statement timeout, HMR `globalThis`, worker `pool.end()`): sizes and settings **adopted** in `config.ts`. HMR caching and `pool.end()` in `cli.ts` are deferred to STK-081, because no app uses the pool yet. `end()` is provided and tested now.
- Architect R-3 (env names `STOKTOK_DATABASE_URL`/`STOKTOK_AI_KEYS_MASTER_KEY`, guards, bundle needles): **adopted** for the DB URL and the driver-import guard. The `@supabase/` guard waits for STK-081, since packages/db still imports supabase-js.
- Architect R-7 slices 080a–e: **adopted** as STK-080 plus STK-081…STK-084. ADR 0010 is moved into this slice as recommended. CLAUDE.md edits are moved to the slices where the text becomes true (R3 → STK-081, Stack/Conventions/WSL2 fix → STK-084), so CLAUDE.md never describes a state that does not exist yet.
- Database-optimizer §6 (upsert = columns present in the payload minus conflict keys; uniform key sets; 21000 on in-batch duplicates; 65 535 bind-param chunking): **adopted** in `upsertInto`/`chunkForParams` and its tests.
- Database-optimizer Rec. 5 (raw `pg` with a `{data,error}` adapter) and data-engineer Rec. 1 (raw `pg`, no builder): **rejected**, because Ming chose `pg` + Kysely. The `{data,error}` adapter is also rejected because it keeps a PostgREST-shaped interface alive (the data engineer's own warning).
- Data-engineer Rec. 2 (date[] OID 1182, session TimeZone UTC, no global parser): **adopted**. Data-engineer open question 2 (`+00:00` vs `Z`): **`+00:00` chosen**, matching PostgREST so existing strings stay identical and microseconds are kept.
- Data-engineer Rec. 5 (`pool.on('error')`, small worker max, fast connect timeout): **adopted**.
- Data-engineer Rec. 7 (real-PG tests in CI, `pnpm test` stays offline): **adopted**. `test:db` is a separate required CI step. `pnpm test` needs no database.
- **RLS (open between consults): drop RLS** (database-optimizer Rec. 2 over architect R-5(a)), recorded in ADR 0010 and implemented in STK-083. Reasons:
  - Today there are no policies, and the only client bypasses RLS, so RLS currently protects nothing beyond the anon/authenticated lockout. Those roles disappear.
  - With one DB role, a `using (true)` policy grants nothing that the table grant does not. Its only effect is "a new table is unreadable by the app until a policy is added", which is a footgun, not a security boundary.
  - "Closed by default to everyone else" is kept by grants: default privileges grant only to `stoktok_app`, PUBLIC is revoked, and db:check asserts a `stoktok_nobody` role is denied everywhere.
- Orchestrator note (AES-256-GCM app-side over pgcrypto; real-PG integration tests in CI): **adopted** (ADR 0010 direction; implementation in STK-082).
- Architect/DB risk "squashed baseline can drop an object → schema diff evidence": carried into STK-083's acceptance criteria.

## Assumptions
- A1. The CI `postgres:16` service is shared by `test:db` and `db:check`. They use different databases, and the bootstrap roles are idempotent. If running them on one server causes a conflict, the implementer moves `test:db` after `db:check` and records why.
- A2. `pg-types` (a transitive dependency of `pg`) exposes an array parser usable for 1182/1185. If importing it directly needs it as a declared dependency, add it to `packages/db` dependencies (record in impl-log). Otherwise use a small local `{…}` array parser with tests.
- A3. The `Database` interface covers the current Supabase-shaped schema, including `ai_keys` with `secret_id`. STK-082 updates it with the new `ai_keys` columns.
- A4. Ming's Postgres major version is unknown. Everything in this slice works on PG 13 or later (`gen_random_uuid` in core, `set_config`). STK-083 needs the real version (see its ticket draft).
- A5. Running a database is not required for `pnpm test` locally. `pnpm test:db` locally needs a Postgres reachable on localhost (for example `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`). This is documented in the ADR's test section.

## Blocking questions
None.

## Split proposal
Order (strangler path): build the foundation, port onto Supabase's own Postgres, then remove Vault, then switch to the plain-Postgres baseline, then move the data and cut over. Each slice deploys on its own and leaves production working.

| Slice | Ticket | Scope | Ticket ACs | Depends on |
|---|---|---|---|---|
| **a (this plan)** — driver foundation | **STK-080** | As above. No app wiring | AC1 (foundation), AC2 (pool, guard, bundle), AC7 (test infra) | — |
| **b** — port repos and callers | **STK-081** (new) | Port all 17 repos to Kysely through `@stoktok/db` (index), with the same exported functions and signatures. Replace `Db` with the `PgDb` handle. Change `apps/web/server/db.ts` (lazy, `globalThis` in dev), `apps/worker/src/cli.ts` (`await end()` in `finally`, including the `.catch` path) and `apps/worker/src/ai.ts` (reuse the CLI pool). `ai_reserve`/`ai_month_spend` via `select * from public.ai_reserve(…)` with explicit casts. Vault RPCs kept as `select * from public.ai_key_*(…)`. Delete `fetchAll` and `fake-client.ts`. Repo behaviour tests move to `test-db/` (every upsert conflict key, news insert count, `count(*) over()`, guarded gap updates, an `ai_reserve` concurrency test); pure tests stay. Remove `@supabase/supabase-js` from `packages/db` and `apps/worker`. `next.config.ts` `serverExternalPackages` adds `pg` (plus web dependency if standalone tracing needs it). Worker tsup external and `pg`/`kysely` worker runtime deps. `check-image.sh` uses a dummy `STOKTOK_DATABASE_URL` and adds a worker `pg` resolve probe. `check-deploy-env.sh` and `deploy/deployment-repo` compose/workflow get validation and env-file writing for `STOKTOK_DATABASE_URL` (special characters). r3-guard: `@supabase/` only under `apps/web/server/auth/**`; drop the `SUPABASE_SERVICE_ROLE_KEY` rule. `.env.example`. CLAUDE.md R3 text. Production points `STOKTOK_DATABASE_URL` at Supabase's Postgres (session pooler, a role that bypasses RLS, e.g. `postgres`) | AC1 (port), AC2 (wired), AC5 (no auth change; guard), AC7 | STK-080 |
| **c** — AI keys app-side crypto | **STK-082** (new) | New forward migration (runs on Supabase and db:check): `ai_keys(provider pk, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4, updated_at)` with the format/last4 checks. Drop `ai_key_set/delete/secrets` and the stored Vault secrets. AES-256-GCM in `packages/db` (`keyring.ts`, AAD = provider) with master key `STOKTOK_AI_KEYS_MASTER_KEY` (32 bytes base64, server-only). Public functions unchanged via `keyring` on the handle. Fail-closed rules from ADR 0009 §3–6 kept: no stored rows and no key → env fallback; rows but a missing or wrong key → `provider_unavailable`. ADR 0011 supersedes 0009. checks.sql ai_key sections rewritten (definer allowlist empty). r3-guard rewritten (decrypt only in keyring/repo; Vault rule kept). Deploy env plumbing for the master key. Ming re-enters keys | AC4 | STK-081 |
| **d** — plain-Postgres baseline, roles, db:check | **STK-083** (new) | One squashed baseline plus rollback under a new `db/migrations` and `db/rollback` (old `supabase/` files kept read-only for reference and excluded from runners). No Supabase roles or Vault; RLS disabled. One-time role bootstrap `stoktok_owner`/`stoktok_app` outside the chain. Default privileges from `stoktok_owner`; PUBLIC revoked on schema, database and functions. `alter role stoktok_app set idle_in_transaction_session_timeout`. `scripts/db-migrate.sh` (psql plus `schema_migrations`). db:check rewritten: app-role privilege matrix (DML yes; DDL/TRUNCATE no), a `stoktok_nobody` role denied, `aclexplode` PUBLIC checks, rollback leaves no tables/functions/sequences/types. `test:db` template switched to the baseline. A recorded normalised `pg_dump --schema-only` diff vs Supabase (grants and Vault excluded) proves the squash is faithful. CI also runs db:check on Ming's PG major if it is not 16 | AC3 | STK-082 |
| **e** — data move, cutover, backups, docs | **STK-084** (new) | `scripts/db-migrate-from-supabase.sh`: refuses a non-empty target unless forced; schema from the baseline; `pg_dump --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys -Fc` over the Supabase direct or session-pooler port 5432 (no `--inserts`); `pg_restore --single-transaction`; `setval` for the 6 identity sequences; per-table count plus ordered md5 verification. Runbook: dry run on a scratch DB, then stop worker → dump → restore → verify → switch `STOKTOK_DATABASE_URL` → start, with Supabase tables kept untouched for a rollback window. Backup note: nightly `pg_dump -Fc` via LaunchAgent, retention, monthly restore test, master key stored apart from dumps. Remove Supabase DB secrets from the deploy tooling and `.env.example` (AUTHEN_* stay). CLAUDE.md Stack (DB row, OrbStack on Intel Mac instead of WSL2), Conventions (secrets); spec §7 diagram, secrets line and risks row (Free pausing accepted, no keep-alive) | AC6, AC7 (docs) | STK-083 |

**Proposed ticket rows (for the orchestrator to create; this planner writes plan.md only):**
- STK-081 | Data layer on pg + Kysely: port repos and callers (STK-080 slice b) | P1 | architecture, db, data, security
- STK-082 | AI provider keys encrypted app-side, replacing Vault (STK-080 slice c) | P1 | security, db, architecture
- STK-083 | Plain-Postgres baseline migration, app roles and db:check rewrite (STK-080 slice d) | P1 | db, security
- STK-084 | Move data from Supabase to self-hosted Postgres, cutover, backups and docs (STK-080 slice e) | P1 | db, data, architecture, security

Each ticket should quote its row above as its goal and ACs and point to `work/tickets/STK-080/` (plan and consults), as STK-077…079 did.

**Open items for Ming in later slices (not blocking STK-080):**
- STK-083: the PG major version of the container (PG15+ already revokes CREATE on `public` from PUBLIC), and whether pgAdmin connects as superuser or `stoktok_owner`.
- STK-084: backup target and retention (default proposal 14 daily plus 8 weekly, copied off-host), and how long to keep the Supabase tables after cutover (default proposal 14 days).
- STK-082: confirm the master key lives in the deploy repo secrets next to the DSN (default), with rotation as a follow-up.

**STK-077 ordering:** run STK-077 after STK-081. Before that point, any new repo queries it adds would be written in supabase-js and ported again. After STK-081, it can run in parallel with STK-082…084: it uses `readAiKeySecrets` only through the public function, and its tests use the fake provider. Both the architect (R-7) and the data engineer (Rec. 8) recommend this.

**Ming's manual steps:**
- STK-081: set `STOKTOK_DATABASE_URL` (Supabase session pooler) in the deploy repo secrets.
- STK-082: set `STOKTOK_AI_KEYS_MASTER_KEY`, then re-enter the AI keys on Settings.
- STK-083: one-time role bootstrap in the container (documented).
- STK-084: run the cutover runbook and set up the backup LaunchAgent.

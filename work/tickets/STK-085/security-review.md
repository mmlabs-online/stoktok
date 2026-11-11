# STK-085 security review

## Security review: STK-085, attempt 1

**Verdict: no 🔴 and no 🟡. No rework is needed for security.** I only read the code and ran nothing: no tests, no build, no image smoke. Check results and the mutation proof come from the impl-log. The Docker image probes have never run (no Docker locally). The CI image job will be their first real run.

### 🟢 R3: the connection URL and handle stay server-only
- **`apps/web/server/db.ts`:**
  - `import 'server-only'` is the first line (:1).
  - The handle is created lazily and cached on `globalThis[Symbol.for('stoktok.db')]` (:12-15).
  - The file never names the env variable. `createPgDb` comes from `@stoktok/db/pg` (:2).
  - A failed `createPgDb` (missing or invalid env) caches nothing, and its message has no value in it (`client.ts:33-34`).
- **The cached handle is safe to reach.** `Symbol.for` puts it on a process-global key, but the handle is the opaque frozen object from STK-081. Reaching Kysely needs the second symbol, which the `ACCESSOR` guard covers (`r3-guard.test.ts:192`). Acceptable.
- **Import paths:**
  - The index (`packages/db/src/index.ts`) exports `type Db = PgDb` and does not export `createPgDb`, `kyselyOf`, `upsertInto` or `jsonb`. So `export *` in `db.ts:17` hands no factory or Kysely to web files.
  - In web, only `apps/web/server/db.ts` imports `@stoktok/db` or `@stoktok/db/pg` (I grepped; `r3-guard.test.ts:54-55` enforces it).
  - `createPgDb(` is allowed only under pg/, test-db/, `db.ts` and `cli.ts` (`:234-238`).
  - `STOKTOK_DATABASE_URL` is referenced only in `pg/client.ts` and its test (`:173-179`).
- **Bundle check:** `scripts/check-no-service-key-in-client.sh:14-19` builds with a sentinel DB password and the host `db.invalid`, and the needles include `postgres://`, `kysely`, `pg-pool` and `pg-protocol`. Dropping the `SUPABASE_*` build vars is correct. The fixed `SUPABASE_SERVICE_ROLE_KEY` and `service_role` needles stay.
- **Bundling:** `next.config.ts:8` keeps `pg` external. The worker tsup config marks `pg`, `pg-native` and `kysely` external (`tsup.config.ts:9`).

### 🟢 Data-access guards: every repo goes through `q()`
- **No escape:** grepping non-test `packages/db/src` for `as any`, `as unknown`, `: any`, an assignment `= k`/`= trx`, `sql.raw`/`lit`/`ref`/`id` and `console.` finds:
  - only the pre-existing cast in `kyselyOf` (`access.ts:18`) and the log lines in `client.ts`;
  - a few `let b = k.selectFrom…` builders, which stay local to their callback and are always `.execute()`d (`transactions.ts:27`, `data-gaps.ts:39`, `lottery.ts:45`, `corporate-actions.ts:19`).
- **Return values:** the callbacks I read return rows, `executeTakeFirst()` results or `void`. Mapping (`mapRow`, `found`) runs outside the callback.
- **Transactions:** `upsertChunked` (`pg/upsert.ts:100-104`) and `insertGaps` (`data-gaps.ts:57-61`) use only `trx` inside.
- **G0 type hardening is in:** `access.ts:27-36` has the widened `Escaping` (`QueryCreator`, `TransactionBuilder`, `ConnectionBuilder`, `DatabaseIntrospector`) and `0 extends 1 & T` rejects `any`.
- **Guards:**
  - The `log` rule now covers the shorthand and quoted forms, with self-tests (`r3-guard.test.ts:189, 275-278`).
  - The `@supabase/` import rule covers six import forms, with self-tests (`:240-243, 288-291`).
  - The package.json rule covers all four dependency fields (`:245-252`).
  - The range-equality rule is at `:254-262`.
  - The Vault allow-lists only gained the moved test path (`:122, :137`).

### 🟢 SQL injection: none found
- **Raw `sql` templates** appear only in:
  - `ai-keys.ts:36,52,72` and `ai-usage.ts:32,76`: every value is a `${}` bound parameter with an explicit cast;
  - `transactions.ts:63,76`: constant `count(*)`;
  - `data-gaps.ts:69,77`: `id = any(${ids}::bigint[])`, bound;
  - `upsert.ts:110`: `jsonb()`, bound.
- **Dynamic identifiers:**
  - Table and column names are literals everywhere.
  - In `upsertInto`, column names come from row keys checked against `/^[a-z_][a-z0-9_]*$/` (`upsert.ts:13-21`), and Kysely quotes identifiers anyway. `pickRows` passes only the fixed `*_COLS` constants.
  - `limit`/`offset` (`transactions.ts:66-67`, `prices-daily.ts:79`) are bound parameters.

### 🟢 Error mapping: no pg text, cause or values reach callers or logs
- **`toDataError` drops the driver error:** it attaches no cause, and messages are fixed text plus the SQLSTATE (`errors.ts:61-74`).
- **Programming errors** thrown inside `q()` (for example from `upsertInto`) become `DB_ERROR 'database error'`.
- **Worker CLI stderr:**
  - `cli.ts:167` prints `e.message`, which is either a DataError message or `Missing/Invalid env STOKTOK_DATABASE_URL`. Neither carries a value.
  - Pool and session logs carry the SQLSTATE only (`client.ts:45,71,87`).
  - The impl-log's local smoke shows stderr is exactly `settings.get: database error`.
- **Web logs:** `ai-keys.ts:16,54` log `{event, provider, code}` only.
- **Pre-existing, outside this ticket's scope:**
  - `mapRow` and lottery `input()` attach a `RowMappingError` cause whose text holds the row or input value (`errors.ts:36`, `lottery.ts:21`, for example `invalid draw id: <drawId>`).
  - These are domain values, not credentials, and are not used on any ai-keys path. Listed for completeness.

### 🟢 AI keys
- **The key is bound only:** `${key}::text` at `ai-keys.ts:36`. It is never passed to `sql.lit` or `sql.raw`.
- **22023 mapping:** `AI_KEY_MAP` maps 22023 to `VALIDATION` with the fixed text `validation failed [22023]` (`:23`).
- **Test:** `test-db/ai-keys.test.ts:36-48` forces a 22023 and checks that the message, `JSON.stringify` and `String` contain neither the key nor its last4, and that `cause` is undefined.
- **`ai_reserve`:** it is raw `sql` with casts and named columns, `toSafeInt` runs on both bigints, and it is never inside a transaction (`ai-usage.ts:28-46`). The mutation proof is recorded in the impl-log: 5 of 12 granted without the lock, exactly 3 with it.
- **Callers:**
  - `apps/worker/src/ai.ts:9-11` requires `db` and has no fallback client.
  - `apps/web/server/ai.ts:13-21` builds the client lazily through `getDb()`.

### 🟢 Worker: pool lifecycle and no-hang
- **Lifecycle:** `cli.ts:66-162` parses the arguments first, so a usage error returns before `openDb` is called. The handle opens inside `try`, and `finally { await db?.end().catch(() => undefined) }` always runs.
- **Timeouts:** the worker profile sets `connectionTimeoutMillis` to 5000 and `statement_timeout` to 120 s (`pg/config.ts:16`), so every wait is bounded.
- **Smoke-test gaps (suggestions only):**
  - The no-hang smoke (`check-image.sh:36-49`) only tests a **refused** port (`127.0.0.1:9`). A blackholed host, which is closer to what production would see if `postgres` is unreachable on the `db` network, takes about 5 s per connection attempt. It still ends, but this smoke does not prove that.
  - The leak grep reads stderr only (`:42,45`). The job summary goes to stdout and is not checked. Low risk because DataError messages are fixed text. Suggestion: `2>&1` into `$err`.
- **Ended-handle quirk:** impl-log deviation 3 says `end()` is a no-op before the first query. On that path no sockets are open, so it cannot hang.

### 🟢 Supabase removal
- **Imports and dependencies:**
  - No `@supabase/` import exists outside `apps/web/server/auth/**`, and the guard is green per the impl-log.
  - `packages/db/package.json` and `apps/worker/package.json` declare no `@supabase/*` package.
  - Grepping `apps` and `packages` for `SUPABASE_SERVICE_ROLE_KEY` gives no hits in source.
- **Leftovers (docs and tests only, no code path):**
  - `apps/worker/README.md:14` still tells developers to put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `apps/worker/.env.local`. The worker now needs `STOKTOK_DATABASE_URL`. This is stale, and it encourages keeping a service-role key on dev machines for no reason. Fix it in this ticket or log it as a follow-up (R7).
  - `apps/web/test/healthz.test.ts:28-31` still stubs `SUPABASE_URL`. Harmless, but stale.
  - The guard scans only `.ts/.tsx/.js/.jsx/.mjs` files under `apps/` and `packages/` (`r3-guard.test.ts:6-16`), so Markdown, `scripts/` and `.cjs` files are not covered. The ticket asks for "source files" only, so this is acceptable.

### 🟢 `.env.example` and `docs/deploy.md`
- **`.env.example:9-15`:** `STOKTOK_DATABASE_URL=` has no value, and the `SUPABASE_*` lines sit under a "Legacy" comment (plan A3), with no `NEXT_PUBLIC_` name.
  - Nit: the example comment `postgres://postgres:postgres@localhost:5432/stoktok` uses the superuser. Something like `postgres://stoktok:<password>@localhost:5432/stoktok` would match the shared-Postgres one-role-per-app standard.
- **`docs/deploy.md:138`:** the new row `STOKTOK_DATABASE_URL | web, worker | reserved | y` is correctly marked secret. Nothing else changed. `SUPABASE_SERVICE_ROLE_KEY` stays "required now" until STK-084, which matches the release rule.
- **Suggestion for STK-084:** the image check `check-image.sh:14-15` flags only env names matching `KEY|SECRET|TOKEN|PASSWORD`. A future `ENV STOKTOK_DATABASE_URL=…` baked into a Dockerfile would pass. Add `DATABASE_URL` to that regex.

### Recommendations
1. Update `apps/worker/README.md:14` to `STOKTOK_DATABASE_URL` and drop the service-role instruction (R3 doc hygiene). This is a one-line fix in this ticket, or a follow-up.
2. Optional hardening of `check-image.sh`:
   - capture stdout as well as stderr in the leak check (`:42`);
   - add `DATABASE_URL` to the secret-name regex (`:15`).
   Both relate to AC5 and R3.
3. STK-084 follow-up, already in plan.md: confirm that the shared Postgres's `log_statement` and `log_parameter_max_length*` settings do not log the `ai_key_set` parameters. The key is a bound parameter, so it only leaks if server-side statement logging includes parameters.

### Risks
- The new Docker probes (pg/kysely resolve, the web `pg-<hex>` alias, the no-hang smoke) are untested until CI runs them.
- The deliberate `leak = k` escape is still enforced only by review. I found no instance in the 17 repos.

### Open questions
- None blocking.

Files reviewed:
- /home/user/stoktok/apps/web/server/db.ts
- /home/user/stoktok/apps/web/server/ai.ts
- /home/user/stoktok/apps/web/server/ai-keys.ts
- /home/user/stoktok/apps/web/next.config.ts
- /home/user/stoktok/apps/web/test/healthz.test.ts
- /home/user/stoktok/apps/worker/src/cli.ts
- /home/user/stoktok/apps/worker/src/ai.ts
- /home/user/stoktok/apps/worker/tsup.config.ts
- /home/user/stoktok/apps/worker/package.json
- /home/user/stoktok/packages/db/src/pg/access.ts
- /home/user/stoktok/packages/db/src/pg/client.ts
- /home/user/stoktok/packages/db/src/pg/config.ts
- /home/user/stoktok/packages/db/src/pg/upsert.ts
- /home/user/stoktok/packages/db/src/pg/index.ts
- /home/user/stoktok/packages/db/src/errors.ts
- /home/user/stoktok/packages/db/src/index.ts
- /home/user/stoktok/packages/db/package.json
- /home/user/stoktok/packages/db/src/repos/{ai-keys,ai-usage,transactions,data-gaps,news,lottery,prices-daily}.ts
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/packages/db/test-db/ai-keys.test.ts
- /home/user/stoktok/scripts/check-image.sh
- /home/user/stoktok/scripts/check-no-service-key-in-client.sh
- /home/user/stoktok/.env.example
- /home/user/stoktok/docs/deploy.md (env table)

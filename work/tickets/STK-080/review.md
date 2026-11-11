## Attempt 1 — 2026-11-11
Verdict: PASS

Reviewed commit 0e0f0b3 against `plan.md` (slice a only), diff `3695033..0e0f0b3`.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (all packages, apps/web route types generated).
- lint: `pnpm lint` exit 0, no warnings.
- test: `pnpm test` exit 0: core 834, sources 35, ai 184, db 219 + 1 todo, worker 295, web 349. Matches impl-log.
- test:db: local PG 16.15 started with `initdb`/`pg_ctl` in a `mktemp -d` dir (as `db-check.sh` does), TCP 127.0.0.1:54331.
  - `DB_TEST_URL=postgresql://postgres@127.0.0.1:54331/postgres pnpm test:db`: 4 files, 14 tests passed. Afterwards `pg_database` holds only `postgres`, `template0`, `template1`, so no test DBs are left over.
  - The same with host `localhost` (the CI form) also passes.
  - With no `DB_TEST_URL`: it prints the "needs DB_TEST_URL (localhost only)" message and exits 1.
  - With host `example.com`: it prints "refuses non-local DB_TEST_URL host 'example.com'" and exits 1.
- db:check: `pnpm db:check` (throwaway cluster) printed `db:check OK`. I also tested the shared-server case (plan A1): `DB_CHECK_URL` was set to the same server right after `test:db` and printed `db:check OK`, and then `test:db` was run again on that server and passed (14/14). No role or DB conflict.
- check:service-key: exit 0. The sentinel DB password and the needles `STOKTOK_DATABASE_URL`, `postgres://`, `postgresql://` and `pg-protocol` each show 0 hits. `OK: no secret or AI SDK material in client bundle`.
- build: `pnpm build` exit 0.
- `grep -rn "@stoktok/db/pg" apps`: no matches. The diff touches no file under `apps/`.

### Acceptance criteria
- [x] 1. `pg` and `kysely` are in `packages/db` only, behind `@stoktok/db/pg`. Evidence: `packages/db/package.json` (deps plus `exports["./pg"]`), `r3-guard.test.ts › pg and kysely are imported only under packages/db/` and its regex self-test both pass, and the apps grep is empty.
- [x] 2. URL validation never echoes the value, and construction does not connect. Evidence: `src/pg/client.test.ts` › missing/empty, non-postgres schemes (asserts `pw-secret` is absent), and `constructing does not connect` (`totalCount` 0).
- [x] 3. Pool profiles are config and session settings are applied per connection. Evidence: `src/pg/config.ts:12-17`; `client.test.ts › profile values reach the pool config; overrides win`; `test-db/session.test.ts` checks TZ, DateStyle, `2min` and app name on 2 distinct backend pids.
- [x] 4. Per-pool type parsers. Evidence: `src/pg/types.test.ts`; `test-db/types.test.ts › round-trips…` (date, date[], timestamptz with µs and +07 input, int8 as string through `toSafeInt`, jsonb, text[], smallint[]); `› global pg.types is untouched`.
- [x] 5. Every public column type has a parser decision. Evidence: `test-db/types.test.ts › every public column type is in the handled set` passes on the migrated schema.
- [x] 6. Driver errors map to `DataError`. Evidence: `src/errors.ts:82-103`; unit cases in `src/errors.test.ts` (including the no-cause and no-leak test); `test-db/errors.test.ts` covers a real 23505 (asserts the URL is absent and there is no cause), a real 23514, and an unreachable server (asserts neither `pw-x` nor the host appears).
- [x] 7. `upsertInto` follows PostgREST upsert semantics. Evidence: `src/pg/upsert.test.ts` (compiled SQL); `test-db/upsert.test.ts` covers partial vs full upsert, ignoreDuplicates returning 1 id, in-batch duplicate → `21000`/DB_ERROR, and a chunked write.
- [x] 8. `jsonb()` round-trips an object (`signals.inputs_snapshot`) and nested arrays (`ai_summaries.body`). Evidence: `test-db/upsert.test.ts › jsonb helper…`.
- [x] 9. `end()` works: later queries reject (`session.test.ts`). Documented deviation: it does not assert `totalCount` 0 because the handle does not expose the pool. Acceptable.
- [x] 10. The `Database` interface matches the migrated schema. Evidence: I compared `information_schema.columns` (169 columns, 18 tables) with `schema.ts`. No table or column is missing or extra; nullability and defaults match. The one exception is `ai_summaries.usage_id`: nullable with no default, typed `Int8Gen | null`. That is harmless; see nit.
- [x] 11. The `test:db` harness fails rather than skipping, enforces localhost-only, and runs in CI. Evidence: the runs above; `ci.yml:46-48`; `test-db/global-setup.ts:10-19`.
- [x] 12. The R3 guard and the bundle needles are in place. Evidence: `r3-guard.test.ts › STOKTOK_DATABASE_URL is referenced only in packages/db/src/pg/client.ts (and its test)` passes (the harness uses `DATABASE_URL_ENV`); the `check:service-key` output above.
- [x] 13. ADR 0010 exists with all 12 decisions plus consequences: `docs/adr/0010-self-hosted-postgres-data-layer.md`.
- [x] 14. No behaviour change and all checks green: see above. The existing supabase-js repo tests are unchanged and pass.

Scope: every changed file is in the plan's file list, plus the routine workflow files (`work/backlog.md`, `ticket.md`, `impl-log.md`). There are no out-of-plan code changes.

### Issues
None.

### Rules R1–R10
No violations found.
- R2: int8 stays a string and is checked by `toSafeInt`.
- R3: the env value is read from a passed object; errors and logs carry no message, detail or URL (`client.ts:47`, `errors.ts:82-96`); bundle check and guard are in place.
- R5: pool values live in a single config object.
- R7: no app or repo changes.
- R8: unit tests plus `test:db` in CI.

### Nits (do not block)
- `packages/db/test-db/global-setup.ts:50-61`: if a migration fails, setup throws before it returns the teardown, so `stoktok_test_tpl_<pid>` is left behind. A `try/catch` that drops the template would fix it.
- `packages/db/test-db/harness.ts:6`: the counter `n` restarts in every worker process. Unique names across files therefore depend on each file's `afterAll` drop succeeding. Adding `process.pid` (or a random part) to the name would make it robust.
- `packages/db/src/pg/schema.ts:233`: `usage_id: Int8Gen | null` could be `Int8 | null` (already noted by the implementer for STK-081).
- `packages/db/src/pg/upsert.ts:57`: `jsonb(undefined)` binds `undefined`, because `JSON.stringify(undefined)` returns `undefined`. Callers should never pass it, but a guard or a type narrower than `unknown` would make that explicit.

### Follow-ups (out of scope)
- STK-081: `client.ts:39-44` swallows a failed session `set_config` (`.catch(() => undefined)`). A connection would then silently run with the server's TimeZone and DateStyle. Consider failing or destroying that client so the contract cannot drift (the implementer also noted this).

## Attempt 2 — 2026-11-11
Verdict: REWORK

Reviewed commit 7f0c2ff (code diff `a534fae..7f0c2ff`) against Ming's 2026-11-11 fix list in ticket.md (S1, S2, S3, S4, S5, S7a/c, S8, S9, the `usage_id` nit and the `jsonb(undefined)` nit).

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0: core 834, sources 35, ai 184, db 227 + 1 todo (was 219, so +8, which matches the impl-log's 3+1+1+2+1), worker 295, web 349.
- test:db: throwaway PG 16 (`initdb`/`pg_ctl`, 127.0.0.1:54333).
  - `DB_TEST_URL=postgresql://postgres@127.0.0.1:54333/postgres pnpm test:db`: 4 files, 14 tests passed. The `localhost` form also passes.
  - With `?host=example.com`: it prints "refuses DB_TEST_URL with a 'host' query parameter" and exits 1.
  - S9 failure path: I created a conflicting `public.transactions` in `template1` to force a migration error. It printed "pnpm test:db setup failed: relation "transactions" already exists" and exited 1, and `pg_database` held only `postgres`, `template0` and `template1`, so the template was dropped. I removed the table afterwards.
- db:check: `db:check OK`.
- build: `pnpm build` exit 0.
- check:service-key: exit 0. All 16 needles plus the 3 sentinels have 0 hits, including the new `kysely`, `pg-pool`, `pg-connection-string` and `db.invalid`.
- `git diff --name-only a534fae..7f0c2ff -- apps` is empty.

### Fix list
- [x] S1: `test-db/global-setup.ts:10-23` `checkAdminUrl` refuses the `host`, `hostaddr` and `port` query params. Unit cases are in `src/test-db-guard.test.ts`, and the live run above confirms it.
- [ ] S2: fail closed. The code logs only the code and ends the client (`client.test.ts › a failed session init…`), but the first query still runs on the session without its settings. **FAILED, see Issue 1.**
- [x] S3: ADR 0010 §2 requires `sslmode=verify-full` for any host off the Docker network and assigns enforcement to STK-081. The STK-081 ticket note was added.
- [x] S4: `upsert.ts:10-19` requires every column to match `IDENT`. Conflict columns must be among the row keys, so they are covered too. Test: `upsert.test.ts › non identifier-shaped column names throw…`.
- [x] S5: `errors.ts:78-82` `sqlstateOf` excludes errno-shaped codes. It is used by both `toDataError` and `client.ts`. Test: `errors.test.ts › only real SQLSTATEs are mapped…`.
- [x] S7a/c: `r3-guard.test.ts:22-23`, with a regex self-test. The importer rule now covers `@stoktok/db/pg`.
- [x] S8: the needles are in `check-no-service-key-in-client.sh:8`, and the run output above shows them.
- [x] S9: the LIKE pattern is escaped (`global-setup.ts:60`), and the template is dropped when setup fails (verified above).
- [x] Nit: `schema.ts:231` `usage_id: Int8 | null`.
- [x] Nit: `upsert.ts:61` `jsonb(undefined)` throws. Test: `upsert.test.ts › jsonb(undefined) throws…`.

Scope: everything stays in slice a. The only changes are in `packages/db`, `scripts/check-no-service-key-in-client.sh`, ADR 0010 and workflow files. The new `src/test-db-guard.test.ts` is justified in the impl-log.

### Issues
#### Issue 1 — 🔴 blocker — S2 is not fail-closed: the caller's first query still runs on the un-initialised session
- **Where**: `packages/db/src/pg/client.ts:34-45` (`pool.on('connect', …)` and its `.catch` that calls `client.end()`).
- **Expected**: Ming's S2 says "session init fails closed … drop the client". The code comment says "a connection without the session settings must not serve queries". No statement from a caller should reach the server on a connection whose `set_config` failed.
- **Actual**: pg-pool emits `connect` and then hands the client to the waiter straight away. The caller's query is therefore queued behind the init query. When the init query fails, pg-protocol parses ErrorResponse and ReadyForQuery in the same chunk. `_handleReadyForQuery` then calls `_pulseQueryQueue()`, which sends the caller's query synchronously. Only after that does the promise `.catch` microtask call `client.end()`. I reproduced this against the local PG 16 with the same pattern: a failing init (`select set_config(...), 1/0`) followed by `pool.query("insert into race_t …")`. In 15 of 15 runs (plus one earlier run that left no row), the caller got `Connection terminated`, but the row **was committed**. A write is reported as failed while it actually succeeded, and it ran without `statement_timeout` or TimeZone. A user who retries a ledger insert would create a duplicate. The unit test uses a fake client and cannot see this; the impl-log already says the case is "not proven".
- **Fix instruction**: Run the session init *inside* connection establishment, so pg-pool never hands out a client whose init failed. Pass a custom `Client` class to `new pg.Pool({ ..., Client: SessionClient })`. Override `connect` in that class (support both the callback and the promise forms, because pg-pool calls `client.connect(cb)`). It should call `super.connect()`, run the `set_config` query, and on failure log `{event:'db_session_init_failed', code}` (code only), `end()` itself, and fail the connect with a plain error that contains no message or host. pg-pool then drops the client and rejects the waiter. Remove the `pool.on('connect')` init. Add a `test:db` test against real PG that forces the init to fail and asserts that (a) the caller's `insert` rejects, (b) no row was written, (c) the pool's `totalCount` returns to 0, and (d) a later query on a healthy init still works. One way to force the failure: an injectable init SQL or `PoolProfile` override that makes `set_config` fail, for example an invalid `statement_timeout` value such as `'x'` through the existing overrides parameter. Keep the existing unit test, or adapt it to the new hook.

### Rules R1–R10
No violations found. R3: logs carry only `{event, code}`, and the bundle needles are widened. R8: every fix has a unit test, and S1/S9 were also verified live. Issue 1 is a correctness defect under R8's "tested" requirement: the existing test cannot observe it.

### Nits (do not block)
- `work/tickets/STK-081/ticket.md:28` lists "cover the @stoktok/db/pg importer rule (S7c)" for STK-081, but this attempt already did S7c (`r3-guard.test.ts:23,58`). Reword it to "keep" rather than "cover".
- `scripts/check-no-service-key-in-client.sh:8`: `db.invalid` is a regex needle if the scan uses plain `grep` (the `.` matches any character). That is harmless because it only over-matches, but `grep -F` would be exact.
- `r3-guard.test.ts:23`: `DB_IMPORT_RE` only matches single-quoted static `from '…'` imports. A double-quoted or `import()` form would slip past. Prettier enforces single quotes, so the risk is low.

### Follow-ups (out of scope)
- These remain STK-081 items, as the impl-log lists: `sslmode` enforcement, `run()` wrapping of kysely calls, optional `lock_timeout`/`idle_in_transaction_session_timeout` (S10), and the `new URL()` check (S6).

# STK-080 security review

## Security review: STK-080 slice a, attempt 1

**Verdict: no 🔴.** The R3 and leak-safety core is sound. I found three 🟡 items: two need small code fixes in this slice, and one is an ADR gap that STK-081 depends on. Everything else is 🟢 hardening. I only read the code; I ran no tests or builds.

### Findings

🟡 **S1. The test-db host check can be bypassed with `?host=`.** `packages/db/test-db/global-setup.ts:14-17`
- The check only looks at `new URL(raw).hostname`.
- But pg-connection-string 2.14.1 (`node_modules/.pnpm/pg-connection-string@2.14.1/.../index.js:40-57`) copies query params into the config, and a `host` param overrides the URL host.
- So `postgresql://postgres:pw@localhost/postgres?host=prod.example` passes the check and then connects to `prod.example`. The `port` param overrides the same way.
- What runs against that server: `create database`, the cluster-wide `bootstrap-roles.sql` (creates `service_role ... bypassrls`), the migrations, and teardown's `pg_terminate_backend` plus `drop database`.
- `harness.ts:8-10` parses the same URL without any check.
- This is a guard against your own mistake, not an attack, but ADR §12's claim that it "refuses a non-local host" is not true as written.
- **Fix:** also reject URLs whose search params include `host`, `hostaddr` or `port`, or run `pg-connection-string`'s `parse()` and check the resulting `host`. Add a unit case for `?host=`.

🟡 **S2. Session settings fail open.** `packages/db/src/pg/client.ts:38-45`
- `.catch(() => undefined)` swallows a failed `set_config`. The connection then serves queries with the server defaults: no `statement_timeout`, and a non-UTC `TimeZone`, which changes the timestamptz output shape the parsers rely on.
- Ordering itself is fine: pg-pool emits `connect` before handing the client out, and the client's query queue is FIFO.
- ADR §3 says "Each new connection runs set_config", which reads as guaranteed.
- **Fix:** on failure, log `{event:'db_session_init_failed', code}` (code only) and destroy that client, for example by calling `client.release(err)` or by calling `client.end()` and letting the pool reconnect. That way a misconfigured session never serves queries. Alternatively, do the SET in a wrapper around the first checkout and fail the checkout on error.

🟡 **S3. The ADR is silent on TLS for the interim Supabase hop.** `docs/adr/0010-self-hosted-postgres-data-layer.md:10`
- Decision 2 says "No TLS on that hop", which is correct for `postgres:5432` on the Docker network.
- But STK-081 to STK-083 point `STOKTOK_DATABASE_URL` at Supabase's session pooler over the public internet as a role that bypasses RLS (`postgres`).
- `client.ts` uses whatever `sslmode` the URL carries. If the URL has none, pg connects in plaintext and sends the password and all data in the clear.
- **Fix:** add a sentence to ADR 0010 that any non-Docker-network host needs `sslmode=verify-full`, with Supabase's CA in `sslrootcert` if needed. Carry this into STK-081 as an acceptance criterion: `createPgDb`, or `check-deploy-env.sh`, rejects a URL whose host is not `postgres` and has no `sslmode`.

🟢 **S4. Upsert SQL injection: none found.** `packages/db/src/pg/upsert.ts:30-42`
- The table name, the insert columns, the `doUpdateSet` keys and the `excluded.<col>` refs all go through Kysely's `sanitizeIdentifier`, which doubles `"` (`kysely@0.29.8 .../postgres-query-compiler.js:5-7`, `default-query-compiler.js:1359`).
- All values are bound parameters, and `jsonb()` binds `JSON.stringify(v)` as a parameter (`:56-58`). There is no string-built SQL.
- Small edge case: `eb.ref(\`excluded.${c}\`)` splits on `.`, so a runtime key containing `.` would become a schema.table.column ref. That gives a quoted-identifier error, not an injection.
- Optional hardening: assert each key matches `/^[a-z_][a-z0-9_]*$/` in `keysOf`, so a caller who spreads an untrusted object into `rows` (types are erased at runtime) gets a programming error early. The thrown Error messages contain only the table and column names, never values.

🟢 **S5. Error mapping is correct.** `packages/db/src/errors.ts:82-103`
- There is no `cause`, and the message is fixed text plus table, op and a code that must match `^[0-9A-Z]{5}$`. `test-db/errors.test.ts:18-40` proves a real 23505 does not leak the key and an unreachable server does not leak the host or password.
- Nit: some Node errno codes are also five uppercase letters (`EPIPE`, `EPERM`, `EBADF`), so a dropped connection can show up as `pgCode: 'EPIPE'`. This is a mislabel, not a leak. Tightening the regex to `/^[0-9A-Z]{2}[0-9A-Z]{3}$/` doesn't help; a better option is to require `e instanceof pg.DatabaseError`, or to reject codes starting with `E` followed by letters only.
- Caveat for STK-081: safety depends on every repo call going through `run()`. Raw pg errors (for example `password authentication failed for user "…"`, or `connect ECONNREFUSED host:port`) reach callers otherwise. Add an r3-guard or reviewer rule there that `kysely` calls in repos are wrapped.
- Pre-existing and out of scope: `unwrap` still attaches `cause: res.error` (`:34-38`), which contradicts the `DataError` doc comment at `:10`. It goes away with supabase-js in STK-081.

🟢 **S6. URL handling is leak-safe.**
- `client.ts:26-28` never interpolates the value.
- pg-connection-string redacts `err.input` on a parse failure (`index.js:33-36`).
- The `pool.on('error')` handler logs only `{event, code}` (`:47`).
- `global-setup.ts:43` prints only `.message`, and the non-local error prints only the hostname.
- `DATABASE_URL_ENV` is not exported from `src/pg/index.ts`, so apps cannot read the variable through that indirection.
- Optional: in `createPgDb`, call `new URL(url)` inside try/catch and rethrow `Invalid env STOKTOK_DATABASE_URL`, so a malformed URL fails at construction rather than at the first query.

🟢 **S7. The R3 guards hold, with small gaps.** `packages/db/src/r3-guard.test.ts:159-177`
- The location rule uses a substring match, so `NEXT_PUBLIC_STOKTOK_DATABASE_URL` is also caught.
- Gaps:
  - (a) `NEXT_PUBLIC_DATABASE_URL` or `NEXT_PUBLIC_DB_PASSWORD` would pass. Widen `:33` to `NEXT_PUBLIC_\w*(SERVICE|KEY|DATABASE|DB_|PASSWORD|SECRET)`.
  - (b) `walk()` skips `.cjs/.mts/.cts` files (`:13`).
  - (c) The "apps/web imports @stoktok/db only from server/db.ts" rule (`:55`) matches `from '@stoktok/db'` with the closing quote, so `@stoktok/db/pg` is not covered. The 'use client' rule at `:47` does cover it. Add the subpath to the server-only importer rule now, or require it in STK-081.
- I confirmed with grep that nothing in `apps/` imports `@stoktok/db/pg`.

🟢 **S8. The bundle check is correct but only pre-positioned.** `scripts/check-no-service-key-in-client.sh:8,17-20`
- The sentinel password, the env name and both scheme needles are present.
- Nothing reads the variable during the web build in this slice, so a green result proves nothing yet. The plan and ADR say this; the script will be meaningful once STK-081 wires the pool.
- Consider adding the needles `kysely`, `pg-pool`, `pg-connection-string` and the sentinel host `db.invalid`. That catches a driver pulled into a client chunk even if no secret is present.

🟢 **S9. Harness cleanup works, with two edge cases.** `global-setup.ts:62-70`, `harness.ts:43-48`
- Teardown terminates connections and drops every `stoktok_test_%_<pid>` database, including the template.
- Edge 1: `_` is a LIKE wildcard. Run 1234's teardown matches `stoktok_test_3_91234`, so concurrent runs on the same server can drop each other's databases. Fix by escaping (`stoktok\_test\_%\_<pid>`) or by checking `datname ~ ('^stoktok_test_.+_' || $1 || '$')`.
- Edge 2: if a migration throws after `create database` (`:50`), no teardown is registered and the template leaks. Fix by wrapping in try/catch and dropping on failure.
- Interpolated identifiers come only from the pid or `pg_database` and are safe.

🟢 **S10.** The CI DB credentials (`postgres:postgres` on an ephemeral service container, `ci.yml:27,48`) are fine. Possible addition: `lock_timeout` and `idle_in_transaction_session_timeout` in the session init. The latter is planned on the role in STK-083.

### ADR claims vs code
| ADR | Claim | Status |
|---|---|---|
| §3 | Each connection runs set_config | Runs, but failure is silent (S2) |
| §5 | No cause; codes as unwrap | True |
| §6 | Referenced only in client.ts; bundle check scans for it | True; the scan is pre-positioning only (S8) |
| §2 | No TLS | True for the Docker hop; interim Supabase hop not covered (S3) |
| §12 | Refuses non-local host; drops all DBs | Bypassable via `?host=` (S1); template leaks on setup failure, cross-run LIKE overlap (S9) |

### Recommendations by rule
- **R3 / AC2:** fix S2 (fail closed on session init). Record S3 in the ADR and as an STK-081 acceptance criterion. Optionally S7(a) and (c).
- **AC11:** fix S1, the host-param bypass, and add a unit case for it. S9 is optional.
- **STK-081 follow-ups (R7, not in this diff):** enforce `run()` wrapping in repos (S5); TLS requirement for the interim URL (S3); `@stoktok/db/pg` importer rule (S7c).

### Open questions
- Does the Supabase session pooler need Supabase's root CA for `verify-full` from Node? This decides the STK-081 URL format.
- Should `createPgDb` enforce an `sslmode` itself, or should `check-deploy-env.sh` own that check?

## Security review: STK-080 slice a, attempt 2

**Verdict: no 🔴.** Eight of the nine requested items are fixed. S2 is only partly fixed: the logging and the discard are correct, but its fail-closed claim does not hold, because the first queued query is usually sent before `client.end()` runs (see 🟡 N1). I only read the code; I ran no tests or builds. S7b and the STK-081 follow-ups are deferred and not raised here.

### Status of the requested items
| Item | Status | Evidence |
|---|---|---|
| S1 `?host=` bypass | ✅ Fixed | `packages/db/test-db/global-setup.ts:10-23` rejects `host`, `hostaddr` and `port` before the hostname check. I checked this against `pg-connection-string@2.14.1/index.js:40-64`: only those query keys override the URL host and port, and both sides decode param names the same way. Unit cases are in `packages/db/src/test-db-guard.test.ts:15-19`. |
| S2 session init fails open | ⚠️ Partly fixed | `packages/db/src/pg/client.ts:40-44` logs the code only (tested in `client.test.ts:67-81`) and ends the client. It is still not fail-closed (N1). |
| S3 TLS for the interim hop | ✅ Fixed | `docs/adr/0010-self-hosted-postgres-data-layer.md:10` now requires `verify-full` off the Docker network and makes enforcement an STK-081 obligation. |
| S4 identifier hardening (optional) | ✅ Done | `packages/db/src/pg/upsert.ts:10-18`. The error message shows only the key, never a value. `jsonb(undefined)` now throws (`:61`). |
| S5 nit (errno mislabelled as pgCode) | ✅ Fixed | `packages/db/src/errors.ts:79-82`. `sqlstateOf` rejects all-letter `E…` codes; no SQLSTATE class starts with E. The pool error log and the session-init log also use it. |
| S7a `NEXT_PUBLIC_` regex | ✅ Fixed | `packages/db/src/r3-guard.test.ts:22`, with a self-test at `:63-66`. |
| S7c `@stoktok/db/pg` importer rule | ✅ Fixed | `r3-guard.test.ts:23,58-59,67-69`. |
| S8 bundle needles | ✅ Fixed | `scripts/check-no-service-key-in-client.sh:8` adds `kysely`, `pg-pool`, `pg-connection-string` and `db.invalid`. |
| S9 LIKE overlap / template leak | ✅ Fixed | `global-setup.ts:60` escapes the pattern (`stoktok\_test\_%\_<pid>`), so `…_91234` no longer matches run 1234. `:67-73` drops the template and exits 1 when the migration fails. |

### New findings

🟡 **N1. The S2 fail-closed path loses the race it depends on.** `packages/db/src/pg/client.ts:34-44`
- The impl-log assumes the `.catch` handler runs before pg sends the next queued query. pg@8.23.1 works the other way round:
  - On an ErrorResponse, `Query.handleError` calls `reject()` synchronously (`query.js:130-131`). Your `.catch` therefore runs later, as a microtask.
  - Postgres sends ReadyForQuery right after the ErrorResponse, normally in the same TCP read. The parser handles it in the same synchronous pass. `_handleReadyForQuery`, then `_pulseQueryQueue` (`client.js:373-395, 616-628`), then writes Kysely's queued first query to the socket.
  - Only after that does `client.end()` run. A query is active by then, so it calls `stream.destroy()` (`client.js:822-824`).
- **Effect:**
  - Reads fail, with a connection-terminated error mapped to `DB_ERROR`. No mis-shaped data is served, and nothing leaks.
  - A write that was already sent can still be executed and committed by the server, without `statement_timeout` and without `TimeZone=UTC`, while the caller sees an error.
  - The trigger is realistically a config error, such as a bad timeout value or a pooler that rejects `set_config`. That makes this a correctness and claim gap, not an exploit.
- The unit test uses a fake client with no queue, so it cannot catch this.
- **Fix (small):** run the session SET before the client is handed out, rather than in a fire-and-forget `connect` listener. Pass Kysely a pool wrapper whose `connect()` does `const c = await pool.connect(); if (!inited.has(c)) { try { await c.query(INIT, …); inited.add(c) } catch (e) { log code; c.release(e as Error); throw e } } return c;`. A `WeakSet` works for `inited`. `release(err)` makes pg-pool destroy the client.
- Do not use Kysely's `onCreateConnection` for this. If it throws, the pg client is never released (`kysely/dist/dialect/postgres/postgres-driver.js:22-43`), so the pool slot leaks.
- **Options:** fix this in this slice so ADR §3 and the S2 claim become true, or carry it as an STK-081 acceptance criterion and correct the "handler normally runs first" note in impl-log.md now. Ming's call.

🟢 **N2. The importer regex only matches the `from '…'` form with single quotes.** `packages/db/src/r3-guard.test.ts:23`
- `import('@stoktok/db/pg')`, `require(...)` and double quotes are not caught. The `'use client'` rule (`:50`) and the driver-import rule still cover the dangerous cases.
- Optional: reuse the `(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]` prefix from `:99`.

🟢 **N3.** `packages/db/src/test-db-guard.test.ts:2` imports `test-db/global-setup.ts`, which imports `pg`, into the default `pnpm test` run. It is inside `packages/db/`, so the driver rule (`r3-guard.test.ts:180-183`) still holds, and the module has no import-time side effects. No action needed.

### Recommendations
- **AC2 / R3:** resolve N1, either now or as an explicit STK-081 acceptance criterion. Either way, correct the S2 claim in impl-log.md.
- **AC11:** satisfied (S1, S9).
- Optional: N2.

### Risks
- Until N1 is fixed, ADR §3 ("Each new connection runs set_config") still overstates the guarantee if init fails.

### Open questions
- Should N1 block slice a, or move to STK-081? Nothing in `apps/` uses the pool yet (I confirmed in attempt 1 that `@stoktok/db/pg` has no importers), so there is no live exposure in this slice.

## Security review: STK-080 slice a, attempt 3

Commit 90a0875. Read-only static review against pg 8.23.1 and pg-pool 3.14.0 in node_modules. I did not run anything.

**Verdict:** N1 and N2 are fixed. Nothing leaks credentials. There is one new crash risk (🟡 1, below) that should be fixed in this attempt; it is about a 3-line change. 🟡 2 can go to STK-081.

### 🟢 N1 is fixed: session setup now fails closed
- **How it works (`/home/user/stoktok/packages/db/src/pg/client.ts:30-67`):** setup now runs inside `connect()`, before pg-pool's `client.connect(cb)` callback fires (`pg-pool/index.js:266`). Until that callback succeeds, the client is never handed out and no caller query can be queued on it. That closes the race from attempt 2.
- **No pool-slot leak on a setup failure:**
  - pg-pool removes the failed client from `_clients` and moves the queue on (`pg-pool/index.js:274,280`).
  - `this.end()` (client.ts:54) closes the socket gracefully, because the client is still queryable and has no active query (`pg/lib/client.js:799-824`).
  - If `end()` stalls, pg-pool's connect timer is still running (it is only cleared inside the callback), so the socket is destroyed after 5 s at most. Close is bounded.
  - `session.test.ts:39-59` proves this against real PG: the caller rejects, no row is written, `totalCount === 0`, and the healthy pool keeps working.
- **No leak in the error or the log:**
  - The rethrown `Error('db session init failed')` has no cause and no message from the original error. The lint disable at client.ts:55 is justified.
  - The log line (client.ts:53) carries only the SQLSTATE, filtered through `sqlstateOf` (`errors.ts:79-82`).
  - The `set_config` values are passed as parameters, and both come from config.
  - pg-pool's `this.log(...)` does nothing because no `log` option is set.
- **Connect failures still pass the raw pg error through:** `super.connect()` at client.ts:45 is outside the try, so an error like `connect ECONNREFUSED host:port` or `password authentication failed for user "x"` reaches the caller unchanged. This behaved the same before this attempt. `run()` turns it into a clean error (`test-db/errors.test.ts:33-40`). Wrapping every call site in `run()` is already a STK-081 follow-up.

### 🟢 N2 is fixed
- `DB_IMPORT_RE` (`/home/user/stoktok/packages/db/src/r3-guard.test.ts:23`) now matches `from`, `import()`, `require()` and side-effect imports, with single or double quotes, for `@stoktok/db` and `@stoktok/db/pg`.
- Those are the only two exports in `packages/db/package.json:7-10`, so no other subpath can slip past.
- Self-tests at r3-guard.test.ts:67-72, including a negative case for `@stoktok/dbx`.

### 🟡 1. New regression: a dropped socket during session setup can crash the process
**Where:** client.ts:44-50.

**Why it happens:**
- Once `super.connect()` has resolved, pg no longer treats the client as connecting.
- pg-pool only attaches its `'error'` listener inside the connect callback (`pg-pool/index.js:270`), which runs after `initSession` settles.
- If the socket dies during the `set_config` query, pg rejects the query and then emits `'error'` on the client in the same tick (`pg/lib/client.js:203-222` → `_handleErrorEvent` at :416-423). At that moment the client has no listener. An `'error'` event with no listener becomes an uncaught exception, and the web or worker process crashes.
- Two things can trigger it:
  - a network blip or Postgres restart in that window;
  - pg-pool's own connect timeout: if setup takes past `connectionTimeoutMillis` (5 s), pg-pool calls `stream.destroy()` (`pg-pool/index.js:252-255`). That is an unexpected end, so the same `'error'` event fires.
- The old `pool.on('connect')` approach did not have this problem, because pg-pool's listener was already attached by then.
- It fails closed (no wrong-session write) and no credentials leak. It is an availability/DoS problem.
- Confidence is medium-high from reading the code; it is not reproduced, and `session.test.ts` does not cover it.

**Fix (one of):**
- **(a) Smallest change:** in `initSession`, after `await super.connect()`, add `const swallow = () => {}; this.on('error', swallow);` and remove it in a `finally`. The query still rejects, so fail-closed behaviour is unchanged.
- **(b) Use pg-pool 3.14's own `onConnect` option** (`pg-pool/index.js:288-302`). It runs after the listener is attached, ends the client and frees the slot itself. Throw the sanitized `Error('db session init failed')` from the hook, because pg-pool passes the hook's error straight to the caller. Check that `@types/pg` declares the option.

**Test:** add a real-PG case that kills the backend during setup, e.g. `pg_terminate_backend` from the good pool on the `application_name`, or a long setup with a short `connectionTimeoutMillis`. Assert that the process survives and `totalCount` is 0.

### 🟡 2. Exposing `PgDb.pool` adds an easy way to log the database password
**Where:** client.ts:15-16, 71; exported as a type via `/home/user/stoktok/packages/db/src/pg/index.ts:3`.
- pg-pool hides `options.password` from logging, but not `options.connectionString` (`pg-pool/index.js:69-80`). Our URL, password included, goes in as `connectionString`.
- With the pool now a plain property, `console.log(db)` or `util.inspect(db)` shows `pool.options.connectionString`: it sits at depth 2, and Node prints that deep by default.
- Before this attempt, the pool was only reachable inside Kysely's internals.
- For R3, this does not give importers more database power than `kysely` (raw `sql` is already possible). The guard still limits importers in `apps/web` to `server/db.ts`. Today nothing outside `packages/db` calls `createPgDb`, so the risk is latent.

**Fix:** replace `pool` with a narrow `stats(): { total: number; idle: number; waiting: number }`, or make `pool` non-enumerable (`Object.defineProperty`). Update `session.test.ts:46` to match. This can go to STK-081 if the orchestrator prefers, since no production code uses it yet.

### 🟢 Minor, no action needed
- **Pool callback throwing (client.ts:38-41):** if pg-pool's callback threw on the success path, it would become an unhandled rejection. pg-pool's callback does not throw in practice.
- **Test coverage gap:** `session.test.ts` checks that the log holds no `statement_timeout` text, but not the host or the password. The URL is local, so this is a coverage gap, not a leak.

### Risks
- 🟡 1 is the only new runtime risk, and it shows up when the database is under load or restarting, which is exactly when the connect timeout fires.

### Open questions
- Should we switch to pg-pool's built-in `onConnect` (option b) instead of the subclass? It is less code and matches pg-pool's own timeout and cleanup handling. It depends on the pg-pool ≥3.14 pin and on the typings.

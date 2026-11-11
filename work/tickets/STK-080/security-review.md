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

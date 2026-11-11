Status: READY

# Plan — STK-081: Data layer on pg + Kysely — slice b1: handle hardening (opaque `PgDb`, `q()`, session-init crash fix, idempotent `end()`)

This ticket is too big for one implement/review cycle with a 2-rework cap (see `## Split proposal`). **This plan covers only
the first sub-slice ("081a" in the architect consult):** hardening the `PgDb` handle inside `packages/db/src/pg/**`, the
`test-db/` harness and the guards. Repos, `apps/**`, bundling, `.env.example` and CLAUDE.md are **not touched**. They move
to the proposed **STK-085**.

After this slice:
- the handle is opaque (`end()` and `stats()` only);
- Kysely can be reached only through `q(db, ctx, fn)`, which always runs inside `run()`;
- the session-setup crash window is closed, and a deterministic real-PG test proves it;
- `end()` is idempotent.

This closes ticket AC3 and AC4, and the mechanism and guard half of AC5. Applying the mechanism to the 17 repos is STK-085.

Estimated size: about 120 production lines, about 300 test lines (the TCP proxy helper is most of it), and an ADR bullet.

## Spec summary
- Ticket AC3: "A socket drop or pool connect timeout during session setup cannot crash the process: an `'error'` listener is held during `initSession` in `packages/db/src/pg/client.ts` (or pg-pool's `onConnect` is used), with a real-PG test that terminates the backend during setup and asserts the process survives and `totalCount` returns to 0."
- Ticket AC4: "`PgDb.pool` is no longer a plain enumerable property: replace it with a narrow `stats()` or make it non-enumerable, so logging the handle cannot print `connectionString`; repos may not use it to bypass Kysely/`run()`."
- Ticket AC5: "every repo `kysely` call goes through `run()`, enforced by an r3-guard rule or test."
- Ticket AC6: "`typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests."
- Ticket AC2: "Production keeps working: until STK-084's cutover no stoktok release is cut, and nothing in this slice changes the running release."
- Ticket scope (worker): "`apps/worker/src/cli.ts` (`await end()` in `finally`, including the `.catch` path)". This slice makes `end()` safe to call twice so that STK-085 can do this.
- CLAUDE.md R3: "Service role key is server-only. … never in client bundles." R8: "No PASS without green checks … New or changed … logic must have unit tests."
- ADR 0010 §3: "Each new connection runs `set_config` … Construction never connects." ADR 0010 §5: "No `cause` is attached."

## Acceptance criteria → verification
Ticket ACs, and which slice closes each one:

| # | Criterion | Slice | How the reviewer verifies it |
|---|---|---|---|
| 1 | Scope items (17-repo port, callers, bundling, guards, docs) | **STK-085** | Not verified here. In this slice, `git diff --stat` shows no file under `apps/`, `packages/db/src/repos/`, `scripts/`, `.env.example` or `CLAUDE.md`. |
| 2 | Production keeps working; no release changes | this slice | Same diff check: nothing outside `packages/db/**` and `docs/adr/0010-…` changes. `grep -rn "@stoktok/db/pg" apps` is still empty. |
| 3 | A socket drop, a backend termination or a connect timeout during session setup cannot crash the process. The caller rejects, `stats().total` returns to 0, and the handle still works afterwards. | this slice | `test-db/session.test.ts › setup survives pg_terminate_backend during set_config`, `› setup survives a socket drop during set_config`, `› setup survives a stalled set_config until connectionTimeoutMillis`. Each test asserts that the `uncaughtException` spy was not called and that vitest reports no unhandled error. The impl-log records a mutation run (listener removed) in which the tests fail. |
| 4 | The handle exposes no pool. Logging it cannot print the URL or password. | this slice | `src/pg/client.test.ts › handle is opaque: only end and stats; inspect(showHidden) and JSON contain no sentinel password`. `test-db/session.test.ts › stats() reports total/idle/waiting`. |
| 5 | Kysely is reachable only through `q()`, so every call runs inside `run()`. Guard rules enforce this. | this slice: mechanism and guards. STK-085: the repos use them. | `test-db/access.test.ts` cases. `r3-guard.test.ts › S5: …` rules and their regex self-tests (see Tests). |
| 6 | Checks green | this slice | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm db:check` and `pnpm check:service-key` all pass. |
| — | (ticket scope prerequisite) `end()` is idempotent | this slice | `src/pg/client.test.ts › end() twice resolves (never connected)`. `test-db/session.test.ts › end() twice resolves, stats().total is 0, later q() rejects with DataError`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/db/src/pg/client.ts` | **Opaque handle.**<br>- `PgDb = Readonly<{ end(): Promise<void>; stats(): PgPoolStats }>`, with `PgPoolStats = { total: number; idle: number; waiting: number }`.<br>- The pool and Kysely live in the closure. The handle gets one non-enumerable property keyed by `Symbol.for('stoktok.pgdb.internals')`. Its value is a function returning `{ kysely }`, never the pool. The handle is then `Object.freeze`d.<br>- `end()` is memoized: the first call stores `kysely.destroy()`'s promise and later calls return it.<br>- **Crash fix:** in `SessionClient.connect`, attach a code-only `'error'` listener before `initSession()` starts. Remove it synchronously in the same settle handler, immediately before calling `cb` (success and failure), or when the promise settles in the promise form.<br>- The `pool` field and its doc comment are removed. | AC3, AC4, end() idempotency |
| `packages/db/src/pg/access.ts` | **New.**<br>- `kyselyOf(db: PgDb): Kysely<Database>` reads the symbol function and throws `Error('not a PgDb handle')` if it is missing.<br>- `q<T>(db, ctx, fn: (k: Kysely<Database>) => Promise<T>, opts?: { map?: SqlstateMap }): Promise<T>`, which is `run(ctx, () => fn(kyselyOf(db)), opts)`.<br>- Header: "The only way to reach Kysely outside `pg/`. Do transactions inside `fn` and use only `trx` there. Do not let `k` escape the callback." | AC5 |
| `packages/db/src/pg/index.ts` | Also export `type PgPoolStats`. Do **not** export `kyselyOf` or `q`: repos import `../pg/access` directly, and apps never get them. | AC4, AC5 |
| `packages/db/src/pg/schema.ts` | `Json = ColumnType<unknown, RawBuilder<unknown>, RawBuilder<unknown>>` and `JsonDef = ColumnType<unknown, RawBuilder<unknown> \| undefined, RawBuilder<unknown>>`. A raw JS object or array on a jsonb column becomes a compile error. | Required by DB-optimizer B1 before any repo port. Kept here because it is foundation and makes STK-085 smaller. |
| `packages/db/src/errors.ts` | `toDataError(e, ctx, map?)` and `run(ctx, fn, opts?)` take an optional `map: (sqlstate: string) => DataErrorCode \| undefined`. It is consulted first. The fixed text comes from the code (`VALIDATION` → `validation failed`, `CONFLICT` → `conflict`, `NOT_FOUND` → `not found`, else `database error`), and `pgCode` is kept. Still no `cause`. | AC5 (`q` API stable for STK-085's ai-keys 22023 → VALIDATION mapping without bypassing `run()`) |
| `packages/db/src/errors.test.ts` | Add `map` cases | R8 |
| `packages/db/src/pg/client.test.ts` | Add the opaque-handle, `stats()` and `end()`-twice unit tests. Existing tests unchanged (the constructor spy does not use the removed field). | AC4, R8 |
| `packages/db/src/pg/upsert.test.ts` | Add a compile-time check: a `// @ts-expect-error` raw object on `signals.inputs_snapshot` in `insertInto(...).values`, and a `jsonb()` value accepted | schema typing |
| `packages/db/src/r3-guard.test.ts` | New `describe('S5 data access')` rules plus regex self-tests (see Tests). Tighten the existing driver-import rule: `pg`/`pg-*` imports allowed only under `packages/db/src/pg/` and `packages/db/test-db/`; `kysely` imports outside those two directories may only be `sql` or `type …` specifiers. | AC5 |
| `packages/db/test-db/pg-proxy.ts` | **New.** In-test TCP proxy (`node:net`) between the pool and the real test Postgres. It parses the server→client message stream (1-byte type plus int32 length), records the backend pid from `BackendKeyData` (`'K'`), and arms after the first `ReadyForQuery` (`'Z'`). When armed, the next client→server bytes (the session `set_config`, sent as extended protocol `P/B/D/E/S`) trigger the mode:<br>- `terminate`: an admin `pg_terminate_backend(pid)`, then forward;<br>- `drop`: destroy both sockets;<br>- `stall`: discard and never forward.<br>Mode `pass` forwards everything. `setMode()` switches modes, and `close()` closes the proxy. It listens on 127.0.0.1:0 and returns a URL with the same credentials and database. | AC3 (deterministic, no races) |
| `packages/db/test-db/session.test.ts` | Replace `.pool.totalCount` with `stats().total` and `.kysely` with `kyselyOf(...)`. Add the three crash tests, an `end()`-twice test and a `stats()` test. | AC3, AC4 |
| `packages/db/test-db/access.test.ts` | **New.** `q()` tests | AC5 |
| `packages/db/test-db/types.test.ts`, `errors.test.ts`, `upsert.test.ts` | Mechanical: `t.pgDb.kysely` / `db.kysely` become `kyselyOf(t.pgDb)` / `kyselyOf(db)`. In `upsert.test.ts:67,74`, drop the two `as never` casts (now type-correct). | follows from the AC4 field removal |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | Under Decisions, add one bullet: "13. Handle. `PgDb` is opaque (`end()`, `stats()`). Kysely is reached only through `q()` in `pg/access.ts`, which wraps `run()`. Guards in `r3-guard.test.ts`. `end()` is idempotent. An `'error'` listener is held during session setup." | records the decision |

Not touched: `packages/db/src/repos/**`, `client.ts` (supabase), `index.ts` (package), `ledger.ts`, `holdings.ts`, `fake-client.ts`, `apps/**`, `scripts/**`, `next.config.ts`, `.env.example`, `CLAUDE.md`, migrations, and `test-db/harness.ts` (its `drop()` already calls `end().catch(...)` and keeps working).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `src/pg/client.test.ts › handle is opaque: only end and stats; inspect(showHidden) and JSON contain no sentinel password` | Build with `postgres://u:pw-SENTINEL-123@127.0.0.1:1/x`. Assert `Object.keys(db)` is `['end','stats']`, `JSON.stringify(db) === '{}'`, `util.inspect(db, { showHidden: true, depth: Infinity, getters: false })` does not contain `pw-SENTINEL` or `127.0.0.1`, `Object.isFrozen(db)`, and `'pool' in db === false`. AC4. |
| `src/pg/client.test.ts › stats() is zero before any query` | `{ total: 0, idle: 0, waiting: 0 }`; construction still does not connect |
| `src/pg/client.test.ts › end() twice resolves (never connected)` | Memoized end. Without the memo, pg-pool rejects the second call. |
| `src/pg/upsert.test.ts › jsonb columns reject raw objects at compile time` | `// @ts-expect-error` on a raw object. A `jsonb(...)` value compiles. Typecheck is the assertion. |
| `src/errors.test.ts › run() map overrides the code and keeps pgCode, text from the code, no cause` | `22023` mapped to VALIDATION gives `validation failed [22023]` |
| `src/errors.test.ts › map returning undefined falls back to the default mapping` | 23505 still gives CONFLICT |
| `test-db/session.test.ts › setup survives pg_terminate_backend during set_config` | Proxy mode `terminate`, worker profile. `q(db, ctx, k => sql\`select 1\`.execute(k))` rejects with a `DataError` (`DB_ERROR`). Wait 100 ms for late events. The `process.on('uncaughtException')` spy was not called. `stats().total === 0`. Then `setMode('pass')`: the same handle's next `q()` returns 1. Literal AC3 ("terminates the backend"). |
| `test-db/session.test.ts › setup survives a socket drop during set_config` | Proxy mode `drop`; same assertions |
| `test-db/session.test.ts › setup survives a stalled set_config until connectionTimeoutMillis` | Proxy mode `stall`, `createPgDb(..., 'worker', { connectionTimeoutMillis: 300 })`. Rejects within 3 s, same assertions. Proves the connect timer still covers setup (why option (a) over `onConnect`). |
| `test-db/session.test.ts › end() twice resolves, stats().total is 0, later q() rejects with DataError` | Replaces the existing end() test |
| `test-db/session.test.ts › stats() reports total/idle/waiting` | After two concurrent `pg_sleep(0.2)` queries finish: total 2, idle 2, waiting 0 |
| `test-db/session.test.ts` existing two tests | Ported to `kyselyOf` and `stats().total` with no change in meaning |
| `test-db/access.test.ts › q() resolves the callback value` | Basic case |
| `test-db/access.test.ts › q() maps a driver error to DataError with ctx and no cause` | Duplicate `news.url` gives CONFLICT, and the message has no url |
| `test-db/access.test.ts › q() map hook turns a raised 22023 into VALIDATION` | `select public.ai_reserve(...)` with `p_from >= p_to` (harden.sql raises 22023) |
| `test-db/access.test.ts › a transaction inside q() rolls back on error` | Two inserts in `k.transaction().execute(trx => …)`, the second violates a check. 0 rows persisted. The error is a `DataError`. |
| `test-db/access.test.ts › kyselyOf rejects a non-handle` | `q({} as PgDb, …)` rejects with DB_ERROR (the error is thrown inside `run`). Documents that `{} as Db` fakes cannot reach the DB. |
| `r3-guard.test.ts › S5: kyselyOf and the internals symbol appear only under packages/db/src/pg/ and packages/db/test-db/` | Text match on `kyselyOf` and `stoktok.pgdb.internals` |
| `r3-guard.test.ts › S5: new Kysely( appears only in packages/db/src/pg/client.ts and packages/db/src/pg/*.test.ts, never with a log option` | Prevents a second, unwrapped Kysely and Kysely's parameter logging (DB-optimizer B6 rule 4) |
| `r3-guard.test.ts › S5: createPgDb( is called only under packages/db/src/pg/ and packages/db/test-db/` | STK-085 adds `apps/web/server/db.ts` and `apps/worker/src/cli.ts` to this allowlist |
| `r3-guard.test.ts › S5: pg/pg-* imported only under packages/db/src/pg/ and test-db/; kysely outside them only as sql or type` | Tightened driver rule |
| `r3-guard.test.ts › S5 regexes catch their fixtures` | Fixtures that must match: `import { Kysely } from 'kysely'`, `import * as k from 'kysely'`, `import('kysely')`, `new Kysely<Database>({ log: …`, `createPgDb(process.env`. Fixtures that must not match: `import { sql } from 'kysely'`, `import type { Kysely } from 'kysely'`, `import { sql, type RawBuilder } from 'kysely'`. |

## Approach
1. **`errors.ts` map hook.** Add `type SqlstateMap = (sqlstate: string) => DataErrorCode | undefined`. In `toDataError`, after the DataError and RowMappingError branches, compute `pg = sqlstateOf(e)`. If `pg && map?.(pg)` returns a code, return `new DataError(code, …, TEXT[code], pg)`. Otherwise use the existing mapping. `run(ctx, fn, opts?)` passes `opts?.map`. Existing callers are unchanged.
2. **`client.ts` crash fix (option (a)).** In `connect(cb?)`:
   - `const onErr = (e: unknown) => console.error(JSON.stringify({ event: 'db_session_setup_error', code: sqlstateOf(e) ?? null }))`, then `this.on('error', onErr)`.
   - `const done = this.initSession().then(...)`.
   - Callback form: `done.then(c => { this.off('error', onErr); call(null, c) }, e => { this.off('error', onErr); call(e) })`.
   - Promise form: `return done.finally(() => this.off('error', onErr))`.
   - pg-pool attaches its `idleListener` synchronously inside `cb` (`pg-pool/index.js:266-270`), so there is no tick without a listener. The pool's connect timer stays armed through setup (`index.js:250-268`), which is why `onConnect` (option (b)) is rejected: it clears the timer first, so a stalled setup would hang forever.
   - Log the code only, never the message (R3, ADR 0010 §5).
3. **`client.ts` opaque handle.**
   - `let ending: Promise<void> | undefined`.
   - `const handle = { end: () => (ending ??= kysely.destroy()), stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }) }`.
   - `Object.defineProperty(handle, INTERNALS, { value: () => ({ kysely }), enumerable: false })`, then `return Object.freeze(handle)`.
   - `INTERNALS = Symbol.for('stoktok.pgdb.internals')`, exported from `client.ts` for `access.ts` only.
   - **Why `Symbol.for` and not a module `WeakMap`:** STK-085 caches the handle on `globalThis`. Next can load `@stoktok/db` more than once (RSC, SSR and action layers). A `WeakMap` in a second module instance would not know a handle created by the first. The global symbol registry works across instances. `util.inspect` prints a function value as `[Function]` and never calls it, so the closure (and the pool's `connectionString`) cannot be printed.
4. **`access.ts`:** `kyselyOf` and `q` as in the Files table. `q` calls `kyselyOf` inside the `run` callback, so a bad handle is a `DataError`, not a raw throw. Build query objects such as `upsertInto(...)` outside or inside `fn`. Either way, a programming `Error` thrown by `upsertInto` becomes DB_ERROR, because it passes through `run()`. STK-085 builds inside `fn` and accepts this (see Specialist input, DB-optimizer B8).
5. **`schema.ts`:** the jsonb column type change. Run `pnpm typecheck`. Nothing outside test-db writes jsonb through Kysely yet.
6. **Proxy helper and tests.**
   - The proxy needs no TLS: the local test server is plaintext and pg sends no SSLRequest unless asked. It is transparent to authentication, so SCRAM works.
   - It only arms after the first `'Z'`. The startup and auth packets are never affected, so the trigger hits exactly the setup statement.
   - In `terminate` mode it uses a separate `pg.Client` on `DB_TEST_URL`. The 57P01 FATAL then arrives while `set_config` is active, so the client emits `'error'`. This is the exact crash path from the security review.
   - Every crash test registers `process.on('uncaughtException', spy)` and `process.on('unhandledRejection', spy2)` in a `try/finally` and removes both handlers.
   - **Mutation proof (impl-log):** temporarily delete the `this.on('error', onErr)` line and run `pnpm test:db -t "setup survives"`. Record that at least the `terminate` and `drop` cases fail (vitest reports an unhandled error, or the spy fires). Restore the line.
7. **Port the existing test-db files** to `kyselyOf` (mechanical) and drop the `as never` casts.
8. **Guards** (`r3-guard.test.ts`). Reuse `files` and allow-list by path prefix.
   - The kysely-specifier check parses each `import … from 'kysely'` statement outside `packages/db/src/pg/` and `packages/db/test-db/`. Allowed: `import type {…}`, or a named list where each specifier is `sql` or starts with `type `. Denied: default and namespace imports, `import('kysely')` and `require('kysely')`.
   - The other rules are text matches.
   - A text match cannot prove that every `.execute()` sits inside `run(`. These rules instead make every other path impossible: no Kysely constructor, no accessor and no pool outside `pg/`. This is the architect's R-9 "by construction" approach.
9. **ADR 0010** bullet.
10. **Rules.**
    - R2: unaffected; no money path changes.
    - R3: the handle can no longer leak the URL; logging is code-only; no `cause`; the new guard blocks Kysely `log`.
    - R5: pool values stay in `config.ts`; the 300 ms in the test is a test override.
    - R7: no repo or app change; anything else goes to follow-ups.
    - R8: unit and test:db tests listed.
    - R1, R6, R9 and R10 are not affected.

## Specialist input used
**Adopted for this slice**
- Architect R-8 (opaque handle, `stats()`, `end()` memo, inspect sentinel test): **adopted**, with one change. The architect suggested a closure or module `WeakMap`. This plan uses a closure plus a `Symbol.for` accessor that returns only Kysely, because a `WeakMap` breaks across duplicated module instances once STK-085 caches the handle on `globalThis` (Approach 3).
- Architect R-9 (`q()` via `run()`, accessor guard, import-specifier guard): **adopted**. The optional "call each repo against an ended handle" check is moved to STK-085, where the repos exist.
- Architect R-10 option (a) plus a deterministic in-test TCP proxy: **adopted**. A third mode, `terminate`, was added (`pg_terminate_backend` on the pid read from `BackendKeyData`), so the test also meets the AC's literal wording without a race.
- DB-optimizer F (the `pg_terminate_backend` test via `pg_sleep` or a loop): **rejected** in favour of the proxy, because a race-based test is flaky.
- Data-engineer 1 and DB-optimizer F (idempotent `end()` with a test): **adopted**.
- DB-optimizer B1 (jsonb insert type `RawBuilder<unknown>`, drop the `as never` casts): **adopted here** as the first foundation commit, as recommended.
- DB-optimizer B5 (a `run()` code-mapping hook instead of a try/catch in ai-keys): **adopted here**, so that `q()`'s signature is final before STK-085.
- DB-optimizer B6 rules 2–4 (no pool in repos, kysely `sql`/types only, no `log:`): **adopted** as guards. Rule 1, a regex for "`.execute(` inside `run(`", is **rejected**, because text matching cannot prove it. Construction makes it unnecessary (the architect's argument).
- DB-optimizer open question 6 (guards in a new file): **rejected**. The guards go into `r3-guard.test.ts` so the file walker is not duplicated, under their own `describe('S5 data access')`.

**Open questions — decided here and binding on STK-085**
1. **`listAllOpenGaps`: single select, not keyset.**
   - The set is only *open* gaps, which the worker keeps resolving. It is small for one user.
   - One statement is snapshot-consistent, unlike both `fetchAll` and keyset loops.
   - The worker statement timeout (120 s) bounds it.
   - The `pageSize` options on `listAllOpenGaps`, `listPriceDates` and `listCloseHistory` are removed, together with the worker config that only fed them (`gapsPageSize`, `HOLIDAY_GAPS_CONFIG.pageSize`). All callers are in the repo, so typecheck catches any miss.
   - This takes the data engineer's position (finding 4) over the DB optimizer's (keyset).
   - The ticket's "same exported functions and signatures" is read as "callers keep compiling and behaving the same", which still holds once the dead option is gone.
2. **Per-symbol fan-outs: not collapsed.**
   - Port 1:1: one query per symbol on the PK index. Never use `DISTINCT ON`; the DB optimizer showed it scans every row because PG17 has no skip scan. This rejects the data engineer's `DISTINCT ON` shape.
   - Run the per-symbol queries through a small bounded-concurrency helper whose limit is `PG_FANOUT_CONCURRENCY = 2` in `pg/config.ts` (R5). Callers then never sit in pg-pool's queue long enough to hit the 5 s `connectionTimeoutMillis` (DB-optimizer A).
   - Collapsing into a `unnest … cross join lateral` statement is a follow-up, not part of this ticket (R7).
3. **Transactions for chunked upserts: one transaction per call when there is more than one chunk.**
   - With a single chunk, there is no transaction (one statement is already atomic).
   - Inside the callback, use only `trx`.
   - `insertNews` stays as independent sequential chunks with no transaction. Its count means "rows that landed", and that is unchanged.
   - This adopts the data engineer's position. The behaviour change (earlier chunks no longer persist when a later chunk fails) is intended, and the reviewer should not flag it: the writes are idempotent, and it stops the gap logic from seeing half a batch.
4. **`Db`: alias, not rename.**
   - `export type Db = PgDb` from the package index.
   - The ~40 type-only importers and the `{} as Db` fakes stay untouched (R7, smaller diff).
   - The ticket's "replace `Db` with the `PgDb` handle" is met, because `Db` now *is* the handle type.
5. **`globalThis` cache: always, not dev-only.**
   - Next can create more than one module instance of `server/db.ts` in production too (separate server layers). A dev-only cache would allow several pools of max 5 each.
   - An unconditional `globalThis[Symbol.for('stoktok.db')]` costs nothing.
   - This deviates from the ticket text ("`globalThis` in dev"). It is recorded as Assumption A2 for Ming to overrule.

## Assumptions
- A1. The local and CI test Postgres accept plaintext TCP from 127.0.0.1 (true for `postgres:17` with the default `pg_hba`). The proxy relays the password exchange untouched.
- A2. "`globalThis` in dev" in the ticket is a minimum, not a prohibition, so caching always is acceptable (decision 5 above). If Ming objects, STK-085 changes one condition. This does not affect this slice.
- A3. pg 8.23 `Client` emits `'error'` when the connection ends or is terminated while a query is active after connect. This is the security review's finding, and the test proves it. If the mutation run shows no crash in some mode, the implementer records which mode and keeps the test as a regression guard.
- A4. The `stall` mode relies on pg-pool's connect timer calling `client.connection.stream.destroy()` (`index.js:252-255`). The caller then sees pg-pool's `Connection terminated due to connection timeout`, mapped by `run()` to DB_ERROR. The test asserts the `DataError` code, not that text.
- A5. Exporting `INTERNALS` from `client.ts` (for `access.ts`) is acceptable, because neither barrel re-exports it and the guard limits the symbol text to `pg/` and `test-db/`.

## Blocking questions
None.

## Split proposal
| Slice | Ticket | Scope | Ticket ACs closed |
|---|---|---|---|
| **b1 (this plan)**: handle hardening | **STK-081** | As above: opaque `PgDb` plus `stats()`, `q()`/`kyselyOf` plus the `run()` map hook, the session-setup listener with the proxy tests, memoized `end()`, jsonb schema typing, the S5 guards and the ADR bullet. Changes only `packages/db/src/pg/**`, `errors.ts`, `r3-guard.test.ts`, `test-db/**` and the ADR. | AC2, AC3, AC4, AC5 (mechanism and guards), AC6 |
| **b2**: port repos and callers | **STK-085 (proposed, new)** | See below | Ticket AC1 scope, AC5 applied, AC2, AC6 |

The architect says b2 cannot be split further without a dual-typed `Db`. Repos, callers and bundling must switch together, because `pg` enters the app graphs the moment the index exports a ported repo.

**Proposed ticket for the orchestrator to create** (the planner writes only plan.md; STK-085 is free — no folder or backlog row exists):

- **Row:** `STK-085 | Data layer on pg + Kysely: port the 17 repos, callers, bundling and guards (STK-080 slice b2) | P1 | architecture, db, data, security`
- **Goal:** the STK-081 ticket scope minus what STK-081 did. Port all 17 repos to Kysely through `@stoktok/db` (index), with the same exported functions (pageSize options removed as decided). Requirements:
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
- **Acceptance criteria:**
  1. All 17 repos run on Kysely through `q()`. No `@supabase/` import remains outside `apps/web/server/auth/**`. `fetchAll`, `unwrap`, `unwrapFound` and `fake-client.ts` are deleted.
  2. The test:db behaviour cases from DB-optimizer §D pass, including the transactions out-of-range-page total, guarded gap updates, the news insert count, every upsert conflict key, the four jsonb round-trips, and the `ai_reserve` concurrency test (mutation proof in the impl-log).
  3. Exercise the worker lifecycle: no pool is opened on a usage error; `end()` runs on success and on error; the image smoke with an unreachable DB exits 1 within 20 s and leaks no host or password.
  4. Web and worker images resolve `pg` (and `kysely` for the worker) at runtime (`check-image.sh` probes).
  5. The r3-guard rules listed above pass, with regex self-tests.
  6. Production keeps working; no release is cut (same release rule as STK-081).
  7. `typecheck`, `lint`, `test`, `test:db`, `db:check`, `check:service-key` and `build` are green.
- **Depends on:** STK-081 (this slice). **STK-082 should be re-pointed to depend on STK-085** instead of STK-081. STK-077 should wait for STK-085 (ADR 0010 Consequences).
- **Consults:** reuse `work/tickets/STK-081/consult-*.md` and the decisions in this plan's "Specialist input used". No new consult is needed.
- **Manual step for Ming:** none.

**Follow-ups (not tickets yet; R7):**
- Collapse the per-symbol price fan-outs into one `unnest … cross join lateral` statement.
- Remove the now-pointless worker symbol-chunk loops (`linesSymbolChunk`, `financialsSymbolChunk`, `resolveChunkSize`) and their cap comments.
- `settings.updated_at` never advances on save (DB-optimizer A; parity kept).
- Confirm the shared Postgres statement-logging settings for `ai_key_set` parameters (DB-optimizer E, for STK-084).
- Order STK-082 before STK-083, because the Vault-stub ai-keys test:db cases depend on it.

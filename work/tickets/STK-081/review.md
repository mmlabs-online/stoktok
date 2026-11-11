## Attempt 1 — 2026-11-11
Verdict: PASS

Reviewed commit c6ed510 against `plan.md` (slice b1 only; the repo port is STK-085), diff `20090ce..c6ed510`.

### Checks (run by reviewer)
Local Postgres 16 (initdb/pg_ctl, trust auth, TCP 127.0.0.1:54341, as `scripts/db-check.sh` does; no Docker), `DB_TEST_URL=postgresql://postgres@127.0.0.1:54341/postgres`. Stopped and removed afterwards.
- typecheck: pass (exit 0)
- lint: pass (exit 0)
- test: pass. core 834, sources 35, ai 184, db 236 + 1 todo, worker 295, web 349. Matches the impl-log.
- test:db: pass. 5 files, 24 tests. Matches the impl-log.
- db:check: `db:check OK`
- check:service-key: `OK: no secret or AI SDK material in client bundle`
- build: pass (exit 0)
- **Mutation proof (re-run by reviewer):** I deleted `this.on('error', onErr);` from `packages/db/src/pg/client.ts` and ran `vitest run -c vitest.db.config.ts -t "setup survives"`. Result: 2 failed, 1 passed. `drop` and `stall` fail because the `uncaughtException` spy is called with `Connection terminated unexpectedly`. `terminate` passes. This matches the impl-log. I then restored the file (`git checkout`) and the tree is clean. The PG log shows `FATAL: terminating connection due to administrator command`, so the `terminate` mode really kills the backend. With pg 8.23 the 57P01 shows up as a query error, not as a client `'error'` event. Plan A3 allows keeping this mode as a regression guard.

### Acceptance criteria
- [x] AC1/AC2: scope and production untouched. Evidence: `git diff --stat 20090ce c6ed510` only touches `packages/db/src/{errors.ts,errors.test.ts,r3-guard.test.ts,pg/**}`, `packages/db/test-db/**`, ADR 0010 and work files. Nothing under `apps/`, `src/repos/`, `scripts/`, `.env.example` or `CLAUDE.md` changed. `grep -rn "@stoktok/db/pg" apps` finds nothing.
- [x] AC3: a socket drop, backend termination or stalled setup does not crash the process. Evidence: `client.ts:43-60` holds a code-only listener during `initSession()` and removes it synchronously right before `cb`. pg-pool 3.14 `newClient` attaches `idleListener` as the first statement in the connect callback, before the `err` branch, so no tick is left without a listener. The `stall` case also confirms the connect timer still covers setup. The three `test-db/session.test.ts › setup survives …` tests pass. The mutation proof above shows they are real regression tests (`terminate` is the exception noted above).
- [x] AC4: the handle is opaque. Evidence: `client.ts:89-95` is a frozen `{end, stats}` with a non-enumerable `Symbol.for` accessor that returns only `{ kysely }`. `src/pg/client.test.ts › handle is opaque …` passes: keys, JSON, `inspect(showHidden)` sentinel, frozen, no `pool`. `test-db/session.test.ts › stats() reports total/idle/waiting` passes.
- [x] AC5 (mechanism and guards): `pg/access.ts` `q()` runs `kyselyOf` inside `run()`. `test-db/access.test.ts` passes all 5 cases (value, CONFLICT without cause or url, 22023→VALIDATION through the map hook, transaction rollback, non-handle → DB_ERROR). `r3-guard.test.ts › S5 …` has 4 rules plus regex self-tests, all passing.
- [x] `end()` is idempotent. Evidence: `client.ts:91` memo. `client.test.ts › end() twice resolves (never connected)` and `session.test.ts › end() twice resolves, stats().total is 0, later q() rejects with DataError` both pass.
- [x] AC6: all checks green (above). The changed `packages/db` logic has tests: errors map hook, handle, `q()`, and jsonb typing via `@ts-expect-error` in `src/pg/upsert.test.ts`.

### Issues
None blocking.

#### Issue 1 — 🟡 should-fix — guard gap
- **Where**: `packages/db/src/r3-guard.test.ts:118` (`KYSELY_CTOR_LOG`)
- **Expected**: the rule "never with a log option" catches a `log` option on the existing constructor in `client.ts:88`.
- **Actual**: `[^}]*` stops at the first `}`. A `log` placed after `dialect: new PostgresDialect({ pool })` is therefore missed. `node -e` confirms that `new Kysely<Database>({ dialect: new PostgresDialect({ pool }), log: (e) => e })` → `false`. That is exactly how someone would edit the one allowed constructor.
- **Fix instruction** (can go with STK-085's guard work): match `\blog\s*:` anywhere between `new Kysely` and the matching close, for example by scanning the text from each `new Kysely` index up to the next `);`, and add the fixture above as a must-match self-test.

### Rules R1–R10
No violations found. R3: the handle cannot print the URL, setup logging is code-only, and `toDataError` attaches no `cause` on the map path. R5: the 300 ms timeout is a test override, and pool values stay in `config.ts`. R7: every changed file is on the plan's list. R8: green, with tests.

### Nits (do not block)
- `KYSELY_FROM` does not see `export { Kysely } from 'kysely'` re-exports outside `pg/`. This is low risk, since a re-export would still need `kyselyOf` (guarded) to reach a live instance.
- If the admin `pg.Client` cannot connect in `pg-proxy.ts` `terminate`, the proxy silently falls back to `killBoth` (drop behaviour), so the test would no longer exercise termination. Consider failing loudly there.
- `DRIVER_IMPORT` is now used only by its own self-test (already noted in impl-log follow-ups).

### Follow-ups (out of scope)
- A `terminate` variant that fails without the listener, for example terminating an idle pooled client after setup, to cover the idle path (from impl-log).
- Fix Issue 1 in STK-085 when the `createPgDb(` allowlist is extended.

## Attempt 2 — 2026-11-11
Verdict: PASS

Scope of this attempt: the fixes Ming asked for in ticket.md "2026-11-11 (Ming, after review attempt 1 PASS)" (commit bd5f04d, on top of 50ee1b4).

### Checks (run by reviewer)
Throwaway local Postgres 16 (initdb, trust auth, TCP 127.0.0.1:54329) with `DB_TEST_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres`. It was stopped and deleted afterwards.
- typecheck: pass, exit 0 (core, ai, sources, db, web via `next typegen && tsc`, worker)
- lint: pass, exit 0
- test: pass. core 834, sources 35, ai 184, db 236 + 1 todo, worker 295, web 349. This matches impl-log.
- test:db: 5 files, 24 tests passed
- db:check: `db:check OK`
- check:service-key: `OK: no secret or AI SDK material in client bundle`
- build: pass, exit 0

### Ming's fix list — evidence
- [x] **`q()` rejects builders and `Kysely`/`Transaction` handles, with `@ts-expect-error` fixtures.** `packages/db/src/pg/access.ts:17-26` adds `Escaping = Compilable<unknown> | Kysely<Database>`, and the callback returns `Promise<T extends Escaping ? never : T>`. That conditional is distributive, so `Kysely | null` is caught. The fixtures are in `packages/db/src/pg/access.test.ts:26-33`. `tsc` includes them because `src` is in the db tsconfig include.
  - **Mutation proof** (scratch copy of `packages/db/src`; the repo was not touched):
    - Baseline: exit 0.
    - (A) Constraint removed (`Promise<T>`): exit 2, TS2578 "Unused @ts-expect-error" at lines 26, 28, 30 and 32. All 4 fixtures fail.
    - (B) `Escaping = Compilable` only: lines 28, 30 and 32 fail.
    - (C) `Escaping = Kysely` only: line 26 fails.
    - (D) Non-distributive `[T] extends [Escaping]`: line 32 fails (the union fixture).
    - Every fixture is load-bearing.
  - **Right reason.** With the directives stripped, the errors are TS2322 `Promise<SelectQueryBuilder…>` / `Promise<Kysely<Database>>` / `Promise<Transaction<Database>>` not assignable to `Promise<never>`, and `Promise<Kysely|null>` not assignable to `Promise<null>`.
  - **Inference intact.** `await q(db, ctx, async k => (await sql<{a:number}>… .execute(k)).rows)` still types `rows[0].a` as `number`, and `number | null` passes through.
- [x] **The `log` guard catches nested config.** `r3-guard.test.ts:191` is now `/new\s+Kysely\b[^(]*\([\s\S]*?(?<![.\w])log\s*[:(]/`.
  - It matches the exact attempt-1 fixture (old regex `false`, new `true`, checked with node) and the `log(e) {}` method shorthand.
  - It does not match `console.log(` or the real `client.ts`.
  - The self-tests are at `:248-249`.
- [x] **Accessor rule covers `getOwnPropertySymbols` and `Reflect.ownKeys`** (`:193`). Self-tests are at `:257-258`. No hits outside pg/.
- [x] **Kysely rule catches re-exports** (`:188`, `:198-205`).
  - These are violations: `export {Kysely}`, `export *`, `export * as k` and `export {sql, Kysely}`.
  - These pass: `export {sql}`, `export type {…}` and `export {type X, sql}`.
  - Self-tests are at `:251-256`.
- [x] **`DRIVER_IMPORT` and its self-test removed.** `DRIVER_IMPORT_PG` is unchanged and still self-tested at `:262-264`.
- [x] Ticket ACs from attempt 1 still hold, and test and test:db are green.

### Scope
The diff 50ee1b4..bd5f04d touches `pg/access.ts`, `pg/access.test.ts` (new), `r3-guard.test.ts`, `work/backlog.md` (attempts 1→2), `impl-log.md` and `ticket.md` (attempts count and Ming's note). That is exactly Ming's list. Nothing is out of plan.

### Issues
#### Issue 1 — 🟡 should-fix — other live executors still escape `q()`
- **Where**: `packages/db/src/pg/access.ts:17`
- **Expected**: anything that can run SQL outside `run()` is rejected as a callback result. That is the intent of security-review 🟡 1 and AC5.
- **Actual**: the following still compile, and the caller can then run SQL outside `run()`. I verified this with tsc on a scratch copy, kysely 0.29.8.
  - `q(db, ctx, async k => k.transaction())` followed by `.execute(trx => …)`. This is `TransactionBuilder`, which is not `Compilable`.
  - `k.connection()` (`ConnectionBuilder`)
  - `k.with('x', …)` (a `QueryCreator` subtype, not `Kysely`)
  - `k.introspection` (`DatabaseIntrospector`, which runs queries)
- **Fix instruction**:
  - In `access.ts`, use `type Escaping = Compilable<unknown> | QueryCreator<Database> | TransactionBuilder<Database> | ConnectionBuilder<Database> | DatabaseIntrospector;` with type imports from `kysely`. `Kysely` and `Transaction` extend `QueryCreator`, so they stay covered.
  - Add `@ts-expect-error` fixtures in `access.test.ts` for `k.transaction()`, `k.connection()`, `k.with('x', (d) => d.selectNoFrom((eb) => eb.lit(1).as('a')))` and `k.introspection`.
  - I checked this exact type on a scratch copy. All four are rejected (TS2322 → `Promise<never>`), the existing 4 fixtures and 3 positives still compile, and inference is unchanged.
- **Severity**: no blocker. The ask as written (builders, `Kysely`, `Transaction`) is met, and nothing outside pg/ uses `q()` yet. This should land before STK-085 ports the repos, either as a tiny follow-up commit here or as STK-085's first commit.

#### Issue 2 — 🟡 should-fix — `log` guard misses shorthand and quoted keys
- **Where**: `packages/db/src/r3-guard.test.ts:191`
- **Expected**: any `log` option on `new Kysely(` is flagged.
- **Actual**: with node, `new Kysely<Database>({ dialect: new PostgresDialect({ pool }), log })` → `false`, `({ log, dialect })` → `false`, and `({ dialect, 'log': f })` → `false`. Property shorthand is the natural form once a `log` helper exists.
- **Fix instruction**:
  - Change the tail to `(?<![.\w])['"]?log['"]?\s*[:(,}]`.
  - Add the three strings above as must-match self-tests.
  - Keep `console.log(` and the real `client.ts` as must-not-match. Add `'new Kysely({ dialect }); console.log(1)'` to the self-tests.

### Rules R1–R10
No violations found. R3/S5: the change only tightens the guards. R7: every changed file is on Ming's list. R8: all checks are green, and the new type logic has compile-time fixtures, which I verified by mutation.

### Nits (do not block)
- `KYSELY_CTOR_LOG` scans from `new Kysely(` to EOF, so a later bare `log(`/`log:` in `client.ts` would be a false positive. This fails safe and is already noted in impl-log.
- `export { sql as s } from 'kysely'` is flagged as a violation (false positive, fails safe).
- `q(db, ctx, async k => k as any)` and wrapped escapes (`[builder]`, `{ k }`, `() => k`) still compile. That is an inherent limit of the type approach. Keep them, plus "no assignment of `k`/`trx` to an outer variable", as STK-085 reviewer rules.
- A bare `sql\`…\`` (`RawBuilder`) is not `Compilable` and can be returned. It is harmless because it needs an executor to run.

### Follow-ups (out of scope)
- If Issues 1–2 are not folded in here, make them STK-085's first commit (before any repo port).
- STK-085 reviewer rule: no escape of `k`/`trx` via outer assignment, wrapping objects, or `any` casts in `q()` callbacks.

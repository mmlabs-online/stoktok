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

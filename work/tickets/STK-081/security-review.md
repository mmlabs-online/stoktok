# STK-081 security review

## Security review: STK-081 slice b1, attempt 1

**Verdict: no 🔴.** The handle no longer leaks the URL, and the crash window from STK-080 🟡 1 is closed with no new gap. There is one 🟡: `q()` still lets a query builder or `k` escape `run()`. Its fix is a type-level change and is best done before STK-085 ports the 17 repos. I only read the code. I ran no tests and relied on the impl-log for check results and the mutation proof.

### 🟢 Opaque handle (AC4, closes STK-080 🟡 2): `packages/db/src/pg/client.ts:89-95`
- The pool, Kysely and the URL live only in closures. Own enumerable keys are just `end` and `stats`. `JSON.stringify` gives `{}`. The object is frozen, so nobody can attach a `pool` field later.
- `util.inspect(db, { showHidden: true, depth: Infinity })` prints the symbol entry as `[Symbol(stoktok.pgdb.internals)]: [Function: value]`. inspect never calls the function and cannot see closure variables. `end` and `stats` are arrow functions, so showHidden shows only `[length]` and `[name]`.
- Logging the Kysely instance itself is also safe. In kysely@0.29.8 the dialect and driver keep config and pool in `#private` fields (`postgres-driver.js:11-20`), which inspect does not print.
- The test at `client.test.ts:70-80` uses the sentinel password and also checks that the host is absent. It covers the AC.
- `end()` is memoized at `:91`. A rejected `destroy()` stays memoized, which is fine.

### 🟢 Session-setup listener (AC3, closes STK-080 🟡 1): `client.ts:43-59`
I checked this against pg@8.23.1 and pg-pool@3.14.0:
- **Listener attached in time.** It is attached synchronously before `initSession()` starts, so it is there before any socket I/O.
- **Removal leaves no gap.** On both success and failure, `off` runs in the same microtask as `cb`. Between `initSession` settling and that `.then`, only microtasks run, never socket I/O. Inside `cb`, pg-pool attaches its `idleListener` synchronously, before it checks `err` (`pg-pool/index.js:266-270`). So the client always has a listener, including a dead client on the failure path.
- **The failure path ends the client before the listener is removed.** `initSession` awaits `this.end()` first, which sets `_ending` and waits for the connection `'end'` event. After that, `client.js:203-224` emits no more `'error'` events. A socket error during that `end()` still reaches our listener.
- **`end()` cannot hang forever.** pg-pool's connect timer is cleared only in `cb` (`index.js:267`), so it also bounds a hanging `this.end()` during setup. This is the correct reason to reject `onConnect`.
- **Logs carry no credentials.** Both log lines contain the SQLSTATE only.
- **Nit:** a setup failure now logs two lines (`db_session_setup_error` and `db_session_init_failed`). This is noise, not a leak.

### 🟡 1. `q()` does not stop `k` or a builder escaping `run()`: `packages/db/src/pg/access.ts:16-18`
- **Problem:** the type `fn: (k) => Promise<T>` accepts any `T`. Both of these compile today:
  - `q(db, ctx, async k => k.selectFrom('news'))`. Kysely builders are not thenables, so the builder comes back unexecuted.
  - `q(db, ctx, async k => k)`.
- **Effect:** the caller can then `.execute()` outside `run()`. Raw pg errors then reach callers, for example `password authentication failed for user "…"` or `connect ECONNREFUSED host:port`. That is exactly the STK-080 S5 caveat. The header comment ("Do not let `k` escape") is a convention only, so "makes bypass impossible" is overstated.
- **Fix (one commit, before STK-085):**
  - Constrain the return type, for example `fn: (k) => Promise<NoEscape<T>>` with `type NoEscape<T> = T extends Compilable<any> | Kysely<any> | Transaction<any> ? never : T`.
  - Add `// @ts-expect-error` fixtures for "builder returned" and "`k` returned" in `src/pg/upsert.test.ts` or a new `access.test-d`.
- **Limit:** this still cannot catch `let leak; q(..., async k => { leak = k })`. Keep that as a reviewer rule for STK-085.
- **Ties to:** AC5 and R3.

### 🟢 Guards: `packages/db/src/r3-guard.test.ts:193-254`
The rules do what the plan says, and their self-tests cover the main import forms. Small gaps, none urgent while nothing outside `pg/` uses Kysely:
- **Symbols reachable without the guarded text.** `Object.getOwnPropertySymbols(db)` and `Reflect.ownKeys(db)` reach the internals with neither `kyselyOf` nor the symbol string in the file (`:200`). Suggestion: add both names to `ACCESSOR`.
- **Re-exports not checked.** `KYSELY_FROM` (`:197`) only checks `import … from 'kysely'`, so `export { Kysely } from 'kysely'` and `export * from 'kysely'` are not caught. The damage is limited: that yields the class, not a connected instance, and `new Kysely` outside `client.ts` is still blocked at `:229-230`.
- **Possible bypass without semicolons.** In a file that omits semicolons, `import type {A} from './a'\nimport { Kysely } from 'kysely'` lets the lazy `[^;]*?` match from the first `import`. `m[1] = 'type '` then skips the check. The code base uses semicolons, so this is low risk.
- **Coverage.** The walker (`:13, :26`) skips `.cts`/`.mts` and `scripts/`.
- **Package exports are tight.** `package.json` exports only `.` and `./pg`, so apps cannot deep-import `pg/access` through the package name.

### 🟢 SqlstateMap hook: `packages/db/src/errors.ts:84-110`
- **Nothing leaks.** The map receives only the validated five-character SQLSTATE. The message text is fixed per code (`'database error'` for unmapped codes), and there is still no `cause`.
- **A throwing map surfaces its own error, not the driver error.** The original error, which can carry the host, is still dropped.
- **Test:** `test-db/access.test.ts:35-44` checks the 22023 → VALIDATION mapping against the real `ai_reserve`.

### 🟢 Test proxy: `packages/db/test-db/pg-proxy.ts`
- **Local only.** It binds to `127.0.0.1:0` (`:78`) and is used only from test-db. It sits behind the existing `test-db-guard`.
- **No lingering sockets.** Each scenario ends the handle, then `proxy.close()` destroys every socket and awaits `server.close` (`session.test.ts:107-109`). The admin `pg.Client` is ended in `finally` (`:71-75`).
- **Nits:**
  - The `sockets` set is never pruned (`:22`). This is a test-only memory leak.
  - The admin client has no `'error'` listener. The risk is negligible.

### 🟢 The `terminate` crash test does not discriminate: `session.test.ts:113`
- **What the impl-log shows:** this test passes even with the listener removed. The 57P01 ErrorResponse arrives as a query error, `initSession` ends the client, and the socket close then emits nothing.
- **AC3 is still met.** The `drop` and `stall` tests do fail without the fix, so the fix is proven. `terminate` still satisfies the AC's literal wording and stays as a regression guard.
- **The impl-log reports this honestly.** The reviewer should not count `terminate` as proof of the fix.

### Recommendations
1. Fix 🟡 1 (the `NoEscape` type on `q()` plus compile-time fixtures), either in this ticket as a small rework or as an explicit STK-085 prerequisite. Ties to AC5 and R3.
2. Optional: add `getOwnPropertySymbols` and `Reflect.ownKeys` to the `ACCESSOR` guard, and add re-export forms to the kysely rule (AC5).
3. STK-085 reviewer rule: no `q()` callback may assign `k` or `trx` to an outer variable.

### Risks
- Until 🟡 1 is fixed, AC5 rests on review discipline across the 17 repo ports.
- `connectionTimeoutMillis: 0` via `overrides` would remove the only time limit on a hanging `end()` during setup. Both profiles set 5000, and only tests override it.

### Open questions
- Should the `q()` type constraint land here (rework) or as the first commit of STK-085?

Files reviewed: `/home/user/stoktok/packages/db/src/pg/client.ts`, `/home/user/stoktok/packages/db/src/pg/access.ts`, `/home/user/stoktok/packages/db/src/pg/index.ts`, `/home/user/stoktok/packages/db/src/errors.ts`, `/home/user/stoktok/packages/db/src/r3-guard.test.ts`, `/home/user/stoktok/packages/db/src/pg/client.test.ts`, `/home/user/stoktok/packages/db/test-db/pg-proxy.ts`, `/home/user/stoktok/packages/db/test-db/session.test.ts`, `/home/user/stoktok/packages/db/test-db/access.test.ts`, `/home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md` (decision 13).

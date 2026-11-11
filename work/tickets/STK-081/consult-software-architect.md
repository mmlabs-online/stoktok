STK-081 consult: software-architect. Changes since the STK-080 consult, slice b only.

## Findings

**F12. `PgDb` leaks the pool and is open to bypass.**
- `PgDb` exposes `kysely` and `pool` as plain enumerable fields (`packages/db/src/pg/client.ts:11-17,71`). The pool's `options.connectionString` therefore shows up in `console.log(db)` and in `util.inspect`.
- Making the field non-enumerable is not enough: `util.inspect(x, {showHidden:true})` still prints it.
- `kysely` is also public. Once `apps/web/server/db.ts:16` runs `export * from '@stoktok/db'`, any web server file can call `getDb().kysely…` and skip both the repos and `run()`.
- Today only tests read `.pool`: `test-db/session.test.ts:46` and `src/pg/client.test.ts:60,63`, which spies on the constructor and does not need the field.

**F13. Crash window in session setup (AC3) — confirmed.**
- pg-pool 3.14 adds its `error` listener only inside the connect callback (`node_modules/.pnpm/pg-pool@3.14.0_pg@8.23.1/node_modules/pg-pool/index.js:266-270`).
- `SessionClient.connect` delays that callback until `initSession` finishes (`client.ts:35-41`). While the `set_config` query runs (`client.ts:47-50`), the client has no `error` listener.
- If the socket drops then, or if the pool's connect timer fires `stream.destroy()` (`pg-pool index.js:250-255`), the client emits `error` with nobody listening. The process dies.
- pg-pool 3.14 does have `onConnect` (`index.js:288-303`), and its idle listener is already attached when the hook runs. But it clears the connect timer first (`index.js:267-268`), so a stalled setup query would hang forever. `@types/pg` 8.23 also has no type for `onConnect`.

**F14. `end()` is not idempotent.** `end: () => kysely.destroy()` (`client.ts:71`) ends the pool, and pg-pool rejects a second `end`. Calling it twice happens easily: an explicit `end()` followed by the harness `drop()` (`test-db/session.test.ts:32-34`, `harness.ts:44`), or `finally` plus `.catch` in the CLI.

**F15. The callers change less than the ticket implies.**
- About 40 app files import `Db` only as a type. Examples: `apps/worker/src/store.ts:29,42-138` and the `{} as Db` fakes in `apps/web/server/*/…test.ts`.
- Only these test files fake the supabase `rpc`/`from` builder and need rewriting: `apps/web/server/ai-keys.test.ts:17,120`, `apps/web/server/ai.test.ts:10-56` and `apps/worker/src/ai.test.ts:9-24`.
- `apps/worker/src/ai.ts:11` defaults `db` to a new client. Under pg that default would be a second pool that nobody ends, and the worker exits via `exitCode` (`cli.ts:154,159-162`), so it would hang.

**F16. Bundling.**
- **Web.** The web build uses Turbopack. It externalises a package only if it resolves from `apps/web`, which is why the SDKs are direct web dependencies (`apps/web/package.json:15-16`; hashed aliases noted at `scripts/check-image.sh:54-56`). Under pnpm's strict layout `pg` is not resolvable from `apps/web` today: it is a dependency of `packages/db` only (`packages/db/package.json:21-22`).
- **Web smoke gap.** The smoke never loads a page module that imports pg. `/` is answered by `proxy.ts` before rendering. So a missing `pg` would not surface in the `MODULE_NOT_FOUND` log grep (`check-image.sh:59`).
- **Worker.** `pnpm deploy --prod` (`apps/worker/Dockerfile:21`) only puts the worker's own direct deps at `/app/node_modules`. tsup inlines `@stoktok/db` (`tsup.config.ts:7`), so its `import 'pg'` / `'kysely'` resolve from `/app/node_modules`. They must therefore be direct worker deps.
- **Existing worker smoke.** It already loads `dist/cli.js` with its top-level imports before the usage exit (`check-image.sh:24-31`, `cli.ts:66-70`), so a missing `pg` already fails it (exit 1, not 2).

**F17. `count(*) over()` loses the total past the last page.** PostgREST `count:'exact'` (`transactions.ts:49`) returns the total even when the range is empty. A window count returns no rows, so the total becomes 0 on an out-of-range page.

**F18. Releases.** Releases build only from `release/v*` branches (`.github/workflows/release.yml:16-18`), so merging this to main ships nothing (AC2 holds). Consequence: a production hotfix before STK-084 has to branch from the last release tag, not from main.

## Recommendations

**R-8 Make the handle opaque.** (AC4, AC5, R3)
- Shape: `PgDb = { end(): Promise<void>; stats(): { total; idle; waiting } }`. Keep the pool and Kysely in a closure or a module `WeakMap`.
- Add an internal accessor that is not exported from `index.ts`.
- `end()` keeps its promise and returns it on later calls (fixes F14).
- Test: `util.inspect(db, {showHidden:true, depth:Infinity})` does not contain a sentinel password.
- Migrate `session.test.ts:46` to `stats().total`.

**R-9 Enforce `run()` by construction, then guard it.** (AC5)
- Repos never receive Kysely. The only way in is `q(db, ctx, (k) => …)`, implemented as `run(ctx, () => fn(kyselyOf(db)))` in `packages/db/src/pg/`. Transactions go inside `fn`.
- r3-guard rule: `kyselyOf`/`.kysely` appear only under `packages/db/src/pg/**` and `packages/db/test-db/**`. Repos, `ledger.ts`, `holdings.ts` and `apps/**` may import only `sql` and types from `kysely`.
- This is a plain text match and much more reliable than trying to work out from the source text that each `.execute()` sits inside a `run(`.
- Optional dynamic check in `test-db`: call each exported repo function against an ended handle and assert it rejects with `DataError`.

**R-10 Session-init crash fix.** (AC3) I recommend option (a).
- **(a) Keep the `SessionClient` subclass.**
  - Attach a code-only `error` listener before `super.connect()` (`client.ts:45`).
  - Remove it in the same `.then` handler, synchronously, right before calling `cb` (`client.ts:38-41`). pg-pool then attaches its own listener in that same tick (`index.js:270`), so there is no gap.
  - This keeps the connect timeout covering setup.
- **(b) `onConnect`.** Less code. But it needs a type augmentation and its own timeout around the setup query, because the pool timer is already cleared.
- **Test with a deterministic in-test TCP proxy**, not a `pg_terminate_backend` race.
  - Case 1: the proxy drops both sockets on the client's first `'Q'` message.
  - Case 2: the proxy swallows `'Q'`, with `connectionTimeoutMillis` around 300.
  - In both cases assert: the caller rejects with `db session init failed`, a `process.on('uncaughtException')` spy is not called, `stats().total === 0`, and a later query on a healthy handle succeeds.

**R-11 Callers.** (scope)
- **Type name.** Re-export `type Db = PgDb` (or rename `PgDb` to `Db`) so the ~40 type-only importers do not churn (R7). Rewrite only the three rpc-faking test files (F15), using `vi.mock` of repo functions.
- **`apps/web/server/db.ts`.** Cache on `globalThis[Symbol.for('stoktok.db')]`. I'd do it unconditionally rather than dev-only: it costs nothing and also covers a duplicated module instance across Next layers. The trade-off is one global symbol. Use `createPgDb(process.env, 'web')`; do not reference the env name in this file (r3-guard `:175-181`).
- **`apps/worker/src/cli.ts`.**
  - Create the handle at `:73`, then wrap the job dispatch (`:74-154`) in `try { … } finally { await db.end() }`.
  - Because `finally` runs before the rejection reaches `.catch` (`:159`), the error path is covered too.
  - A `createPgDb` throw (missing env) has nothing to end. It must still print only the message (`:160`).
- **`apps/worker/src/ai.ts:9-11`.** Make `db` required and remove the `createServiceClient` default. No job uses it yet (`:8`).
- **r3-guard: `createPgDb(` allowlist.** Callers only in `apps/web/server/db.ts`, `apps/worker/src/cli.ts`, `packages/db/src/pg/**` and `packages/db/test-db/**`. This matters because `db.ts:16`'s `export *` would hand `createPgDb` to every web server file.

**R-12 Bundling.** (scope, AC6)
- **Web.**
  - `next.config.ts:8`: add `'pg'` to `serverExternalPackages`.
  - Add `pg` (same range as `packages/db/package.json:22`) to `apps/web/package.json` dependencies. Without it, Turbopack falls back to bundling `pg`, including the optional `pg-native` / `pg-cloudflare` requires.
  - Do not externalise Kysely: it is pure ESM and fine to bundle.
  - Extend the SDK probe at `check-image.sh:56` to also import the hashed `pg-*` alias in `.next/node_modules` (F16).
- **Worker.**
  - Add `pg` and `kysely` to `apps/worker/package.json` dependencies with exactly the ranges in `packages/db/package.json:21-22`. Add a guard test comparing them, or move to a pnpm `catalog:` in `pnpm-workspace.yaml`. Two Kysely copies would be a silent risk.
  - `tsup.config.ts`: add an explicit `external: ['pg', 'pg-native', 'kysely']`.
  - `check-image.sh:21-32`:
    - Keep the usage smoke.
    - Add `docker run -w /app/dist --entrypoint node IMAGE -e "Promise.all([import('pg'),import('kysely')])…"`.
    - Add a no-hang smoke: run `signals` with `STOKTOK_DATABASE_URL=postgres://x:y@127.0.0.1:9/x` under `timeout 20`. Expect exit 1, a stderr without `y@` or the host, and no hang. This proves the `finally`/`end()` path.
  - Web smoke `:38-40`: switch to a dummy `STOKTOK_DATABASE_URL` and drop the Supabase vars.

**R-13 Other r3-guard changes.** (scope)
- `:40-46`: turn into a negative guard — `SUPABASE_SERVICE_ROLE_KEY` appears nowhere in `apps/` or `packages/`.
- Add: `@supabase/` imports (all forms, including `import type`) only under `apps/web/server/auth/**`, plus a regex self-test like `:88-93`.
- Add: a package.json check that `@supabase/*` is absent from `packages/db` and `apps/worker` dependencies.
- Keep `:122-173` (Vault rules) unchanged until STK-082.
- `scripts/check-no-service-key-in-client.sh:19`: drop the `SUPABASE_*` vars from the build line. The needles can stay.

**R-14 Transactions paging (F17).** When a page comes back empty with offset > 0, run a separate `count(*)`. Alternatively, always use `select count(*)` in a CTE joined to the page. Add a `test-db` case for an out-of-range page.

**R-15 Sub-split.** Yes, the slice is too big for a 2-rework cap.
- Size: 62 `db.from/rpc` call sites across 17 repos, 17 repo test files moving from `fake-client` to `test-db`, ~4 app test rewrites, 3 callers, about 8 config and script files.
- **081a — handle hardening.** Only `packages/db/src/pg/**`, `test-db/` and `r3-guard`; no app impact. Covers R-8, R-9's `q()` helper and accessor guard, R-10 with the proxy test, and idempotent `end()`. This closes AC3–AC5 in a small, security-reviewable diff.
- **081b — the port.** Repos, tests, callers, bundling, the `@supabase` guard, `.env.example`, CLAUDE.md R3.
  - It cannot be split further without making `Db` dual-typed (my STK-080 R-7 still holds).
  - Order the commits by repo group: ledger (transactions, corporate actions, settings) → market data (prices, financials, lines, symbols, gaps, news, signals) → assets/watchlist/lottery → AI (usage, summaries, keys) → apps and bundling. The reviewer can then follow them in order.

## Risks
- With option (b) (`onConnect`) and no hook timeout, a stalled backend during setup hangs the request or job forever. In the worker this also holds the LaunchAgent lock (ADR 0003).
- `globalThis` caching keeps a pool alive across dev HMR with a stale profile. Harmless, but a profile change needs a restart.
- Removing `fetchAll` removes the implicit `max_rows` cap. Unbounded reads are then limited only by `statement_timeout` (web 15 s, `config.ts:14`). Acceptable for a single user.
- `test-db` runs as superuser over the Supabase-shaped migrations with the Vault stub (`test-db/global-setup.ts:79-84`). Grant and role bugs stay hidden until STK-083.
- A production hotfix needed between STK-081 and STK-084 must be cut from the last release tag, not main (F18).
- STK-077 should still wait for 081b (ADR 0010 Consequences).

## Open questions
1. Keep the exported name `Db` as an alias of `PgDb` (minimal churn, my preference), or rename it in all ~40 files?
2. `globalThis` cache always, or dev-only as the ticket says?
3. Session-init fix: subclass with a held listener (recommended) or `onConnect` with its own timeout?
4. Accept splitting into 081a (hardening, AC3–AC5) and 081b (port)?

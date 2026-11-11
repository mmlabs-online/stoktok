## Attempt 1 — 2026-11-11
Verdict: REWORK

Reviewed commit `ba3dc6c` against `origin/main` (97 files plus impl-log). The code is in good shape. Every check is green when I run it, every repo port matches the old supabase-js behaviour, and the mutation proofs hold. The only reason for REWORK is the commit shape: Ming's AC1 says the G0 hardening must be the **first commit, before any repo is ported**, and the branch has one squashed port commit (Issue 1). Fixing it is a history split with no code change.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (core, ai, db, sources, web `next typegen && tsc`, worker).
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. Results: core 834; sources 35 (1 file skipped, as before); ai 184; db 88; worker 299 (1 file skipped, as before); web 352. These match the impl-log.
- build: `pnpm build` exit 0 (Next build and worker tsup).
- test:db: `DB_TEST_URL=postgresql://postgres:postgres@127.0.0.1:54331/postgres pnpm test:db`: **22 files, 109 tests passed**. This ran against a throwaway local PostgreSQL 16.15 on TCP (initdb/pg_ctl, `listen_addresses=127.0.0.1`), because Docker is not available.
- db:check: `pnpm db:check` (throwaway cluster mode) → `db:check OK`.
- check:service-key: `pnpm check:service-key` → `OK: no secret or AI SDK material in client bundle`. Every needle had 0 hits, including the DB password sentinel, `postgres://`, `kysely` and `pg-*`.
- check:deploy-env: `OK: deploy env lists consistent`.
- **`ai_reserve` mutation proof (reproduced).** I worked on a scratch copy of the tree, so the repo was never edited. I deleted the `pg_advisory_xact_lock` line (migration line 29) and ran `test-db/ai-usage.test.ts`. Result: `× ai_reserve concurrency … expected [...] to have a length of 3 but got 4`. With the lock in place, the test passes in the full run above.
- **G0 type mutation (reproduced on the scratch copy).** I removed each of `QueryCreator`, `TransactionBuilder`, `ConnectionBuilder` and `DatabaseIntrospector` from `Escaping` in turn. Each removal gives `TS2578 Unused '@ts-expect-error'` on its own fixture (`access.test.ts` lines 38, 34, 36 and 40). Removing the `0 extends 1 & T` branch gives TS2578 at line 42 (`k as any`).
- Worker lifecycle, local equivalent of the image smoke: `STOKTOK_DATABASE_URL=postgres://smoke:smoke-pw@127.0.0.1:9/smoke timeout 20 node apps/worker/dist/cli.js signals` → exit 1 in under 1 s. stderr was only `settings.get: database error`, with 0 matches for `smoke-pw|127.0.0.1`. With no args, the exit code is 2.
- Bundling, checked after the build:
  - `apps/web/.next/node_modules` holds `@anthropic-ai`, `@google` and exactly one `pg-ad45e98bb7b7a165`, and the SSR chunks load `a.y("pg-ad45e98bb7b7a165")`.
  - The `check-image.sh` web probe script, run locally from `.next/server/chunks/ssr`, exits 0.
  - The worker probe `import('pg'), import('kysely')`, run from `apps/worker/dist`, exits 0.
  - In `dist/cli.js`, `grep -c '@stoktok/db'` = 0 and `from "pg"|from "kysely"` = 6.
- Not runnable here (no Docker): `scripts/check-image.sh web|worker` inside the real images. I read the script: it has no `set -e`, so `code=$?` after `timeout 20 docker run` is captured correctly. 124 is treated as a hang. The `trap docker rm -f` covers the timeout. The leak grep covers both host and password. The CI image job on the PR will be the first in-image run (see the PR carry-over below).

### Acceptance criteria
- [ ] **AC1: G0 first commit.** The content is fully met, but the commit order is FAILED; see Issue 1.
  - Content evidence: `access.ts` widens `Escaping` with exactly the five members and adds `NoEscape<T>` with the `any` branch. `access.test.ts:34-42` has the five `@ts-expect-error` fixtures, all biting (mutation above).
  - The `KYSELY_CTOR_LOG` tail is `['"]?log['"]?\s*[:(,}]`. The self-tests include `{ …, log }`, `({ log, dialect })`, `'log': f` and the must-not-match `console.log(1)` (`r3-guard.test.ts` › `S5 regexes catch their fixtures`).
  - Commit order: `git log origin/main..HEAD` = `0de4750` planning, `4ab3d47` plan, `ba3dc6c` (everything). G0 is not a separate first commit.
- [x] **AC2: `q()` callbacks return rows or scalars only.**
  - Evidence: I read every `q(` callback in `src/repos/*.ts`, `ledger.ts`, `holdings.ts` and `pg/upsert.ts`. Each one ends in `.execute()`, `.executeTakeFirst()`, `.executeTakeFirstOrThrow()` or `(await sql…execute(k)).rows`, or returns `void`.
  - `grep -nE "as any|as unknown|: any\b"` over the repos, ledger and holdings only matches comment text in three test files.
  - The `let b` / `let out` builders are local to the callback or to the pure `withFilters` transform (`transactions.ts:44-54`). No `k`/`trx` is assigned outward, and none is wrapped.
  - Transactions use only `trx` (`upsert.ts` `upsertChunked`, `data-gaps.ts` `insertGaps`). Mapping (`mapRow`, `found`) is always outside the callback.
- [x] **AC3: 17 repos on Kysely via `q()`; no `@supabase/` outside auth; helpers deleted.**
  - The `fetchAll|unwrapFound|\bunwrap\b|fake-client|createServiceClient` grep only hits a private, unrelated `unwrap` method in `apps/worker/src/sources/vci-iq-financials.ts` (impl-log deviation 6; confirmed not the db helper).
  - `@supabase/` appears only in `apps/web/server/auth/*` and in the guard's own fixtures.
  - `test-db/repos-ended-handle.test.ts` › `every exported repo function rejects with DataError on an ended handle` and › `the table covers every index export` both pass.
  - `client.ts`, `client.test.ts` and `test/fake-client.ts` are deleted.
- [x] **AC4: test:db behaviour cases.** All of the following are green in my run:
  - transactions › `total stays correct when offset is past the end` (`{rows: [], total: 5}`, plus a filtered case with `total: 1`);
  - data-gaps › the three guarded-update tests;
  - news › `new url inserted and counted…` and `in-batch duplicate counts once; chunkSize 2 sums…`;
  - conflict keys in prices-daily, prices-intraday, financials (2-column and 4-column), symbols, signals (4 discriminating columns), lottery draws and ai_summaries;
  - the jsonb round-trips: settings `rule_configs`, signals `inputs_snapshot`, lottery `lines` and ai_summaries `body`;
  - ai_reserve concurrency, with the mutation proof reproduced.
- [x] **AC5: worker lifecycle.** Evidence:
  - `apps/worker/src/cli.test.ts` › `usage error opens no db (exitCode 2)`, `end() runs once after a successful job`, `end() runs once when the job throws, and the error still propagates`, `an end() rejection does not replace the job result`, and `an openDb throw has nothing to end and propagates`.
  - `cli.ts:66-166`: `parseArgs` runs before `try`, `openDb()` runs inside it, and `finally { await db?.end().catch(() => undefined) }`.
  - The local no-hang run gave exit 1 and leaked nothing (see above). The Docker smoke is carried to the PR.
- [x] **AC6: images resolve `pg` (and `kysely` for the worker).** The probes are in `check-image.sh`. Locally, the alias shape and both probe scripts pass (above). In-image runs are carried to the PR's CI image job.
- [x] **AC7: r3-guard rules with self-tests.**
  - New tests: `@supabase/ imports … only under apps/web/server/auth/` (6 must-match forms, `@stoktok/db` must-not-match), `package.json declare no @supabase/*`, `SUPABASE_SERVICE_ROLE_KEY appears in no source file`, the `createPgDb(` allow-list extended by exactly the two app files, and `pg and kysely ranges … equal packages/db`.
  - The Vault rules are unchanged except for the moved test path (plan A4).
  - All are green in `pnpm test`.
- [x] **AC8: production keeps working; no release.** `git diff --stat origin/main...HEAD -- .github deploy apps/*/Dockerfile supabase` is empty. No `release/v*` branch or tag exists. `.env.example` keeps the legacy `SUPABASE_*` lines, and `STOKTOK_DATABASE_URL` is `reserved` in `docs/deploy.md`.
- [x] **AC9: all checks green.** See Checks above.

### Per-repo behaviour vs the old supabase-js code (checked)
- **Column sets.**
  - Selects match the old `COLS` strings 1:1 in all 17 repos.
  - The upsert column sets come from `pickRows`, which builds each row from the full `*Insert` interface (`rows.ts`), so a repeated upsert overwrites every column. This is the same as PostgREST bulk upsert with `defaultToNull`.
  - `saveSettings` sends only the `settingsToRow` columns, so `rule_configs` and the threshold stay untouched (covered by a test).
  - `saveAppSettings` replaces the full row as a read-modify-write.
  - `setSymbolExchange` and `setSymbolSector` are partial upserts (`keysOf` keeps `null` and drops `undefined`).
  - Corporate-action update is a full replace (covered by a test).
  - Lottery ticket update resets the ticket to `pending`.
- **Conflict keys** are unchanged: `prices_daily (symbol, trade_date)`, `prices_intraday (symbol, ts)`, `financials (symbol, period)`, `financial_lines (symbol, period_kind, period, line)`, `signals (symbol, rule_id, horizon, signal_date)`, `lottery_draws (game, draw_no)`, `ai_summaries (scope, symbol, summary_date)`, `symbols (symbol)`, `settings (id)` and `news (url)` with do-nothing.
- **Return counts.** Upserts return `unique.length` after later-wins dedupe, as before. `insertNews` returns the sum of the ids actually inserted, with no transaction, as the ticket requires. `settleAiUsage` returns `rows.length > 0` with the `status = 'reserved'` guard.
- **Gap guards.** `resolveGaps` and `extendGaps` filter on `id = any(${ids}::bigint[]) and resolved_at is null`, and empty ids return before `q`. `resolved_reason` is written only when a reason is given.
- **`listTransactionsPage`** (`transactions.ts:57-90`): `count(*) over()` on the page, and a separate `count(*)` with the same filters only when the page is empty and `offset > 0`. `total` goes through `toSafeInt` and is stripped before mapping.
- **Fan-outs** use `mapLimit(…, PG_FANOUT_CONCURRENCY = 2, …)` with one `q` per item. The `prices-daily` test asserts `stats().total ≤ 2` on the worker profile.
- **The web `globalThis` cache** (`apps/web/server/db.ts`):
  - Creation is lazy, and the cache is set unconditionally with `??=` on `Symbol.for('stoktok.db')`.
  - `server-only` is still the first line, and the file never names the env var.
  - `db.test.ts` covers the lazy import, a single factory call with `(process.env, 'web')`, and the cache surviving `vi.resetModules()`.
- **Bundling.**
  - Web adds `pg` to `serverExternalPackages`, and `apps/web/package.json` pins the same range as `packages/db`.
  - Worker tsup has `external: ['pg','pg-native','kysely']`, `@supabase/supabase-js` is removed, and the `kysely`/`pg` ranges are equal to `packages/db`'s (enforced by the guard).

### Issues
#### Issue 1 — 🔴 blocker — AC1 commit order (Ming's explicit AC)
- **Where:** the branch history. `ba3dc6c` contains G0 together with all the repo ports.
- **Expected:** Ticket AC1 (Ming, 2026-11-11) says "**First commit, before any repo is ported**". Plan AC1's verification says "`git log --reverse` shows G0 first and touching only `pg/access.ts`, `pg/access.test.ts` and `r3-guard.test.ts`".
- **Actual:** one commit holds G0 to G9. The G0 content is correct (verified by the mutation above), but the order Ming asked for does not exist in the history.
- **Fix instruction (orchestrator or implementer; no code change):**
  1. Rewrite the branch so that the first commit after `4ab3d47` is `STK-085: widen q() Escaping and extend the log guard (G0)`. It must contain only `packages/db/src/pg/access.ts`, `packages/db/src/pg/access.test.ts`, and the G0 hunks of `packages/db/src/r3-guard.test.ts`:
     - the `KYSELY_CTOR_LOG` regex line;
     - the four new `KYSELY_CTOR_LOG.test(...)` self-test lines.
  2. Take everything else from `ba3dc6c` in one or more following commits. Splitting G1 to G9 is welcome but not required by the ticket.
  3. A concrete way:
     - `git reset --soft 4ab3d47 && git restore --staged .`;
     - `git add packages/db/src/pg/access.ts packages/db/src/pg/access.test.ts`;
     - `git add -p packages/db/src/r3-guard.test.ts` (only the hunks above);
     - commit;
     - `git add -A && git commit` for the rest;
     - `git push --force-with-lease`.
  4. Before pushing, confirm that the G0 commit alone passes `pnpm --filter @stoktok/db typecheck && pnpm --filter @stoktok/db test`. Run it at that commit, for example with `git stash` or a worktree.
  5. Confirm that the final tree is byte-identical to `ba3dc6c`: `git diff ba3dc6c HEAD` must be empty.
  6. Record this in the impl-log as Attempt 2.

### Rules R1–R10
No violations found.
- R2: bigints go through `toSafeInt` (`seq`, `volume`, `total`, `spent`, the ai ids). The `writable()` helpers in `assets.ts` and `corporate-actions.ts` also go through `toSafeInt`.
- R3: the env var is read only in `pg/client.ts`, and the app handles live only in the two allow-listed files. The AI key is only a bound parameter. Errors carry no cause (the ai-keys leak test passes).
- R5: `PG_FANOUT_CONCURRENCY` and the chunk sizes are constants or options.
- R7: no unjustified out-of-plan files. `work/backlog.md` and `ticket.md` are state rows only.

### Nits (do not block)
- `assets.ts` and `corporate-actions.ts` `writable()` call `toSafeInt` outside `q()`. A non-integer amount would surface as a `RowMappingError`, not a `DataError('VALIDATION')`. Today the callers pass parsed integers (`server/assets/handlers.ts`, `server/transactions/handlers.ts`), so this cannot be reached.
- `getAiMonthSpend`: a SQL `NULL` result now maps to `MAPPING`, where it used to be `DB_ERROR` ("no data returned"). The function returns a coalesced value, so this cannot be reached.
- `data-gaps.ts` `INSERT_CHUNK_SIZE = 500` is a module constant. The other repos take a `chunkSize` option. This is fine for now.
- The web `ai-keys.test.ts` "format rejection calls no repo function" case is folded into the provider/valid tests. Its name could say so explicitly.

### PR carry-over (CI, not reviewer-verifiable here)
- The first in-image run of the new `check-image.sh` probes happens in the CI image job: the worker `pg`/`kysely` resolve, the worker no-hang smoke against `127.0.0.1:9` (exit 1, under 20 s, no leak), and the web `pg-<hex>` alias import with `STOKTOK_DATABASE_URL`. If any of them fails, it is a fix inside this ticket.

### Follow-ups (out of scope)
- The STK-081 handle: `end()` on a handle that never ran a query is a no-op in Kysely, and a later query reopens the pool (impl-log deviation 3). Consider making `end()` mark the handle as closed so `run()` rejects afterwards regardless of pool state.
- The plan follow-ups stand: collapse the fan-outs; remove `linesSymbolChunk`, `financialsSymbolChunk`, `resolveChunkSize` and the "PostgREST row cap" comments; `settings.updated_at` never advances on save; the STK-084 env cleanup; STK-082 removes the ai-keys test:db cases and their allow-list path.
- `db:check` in `DB_CHECK_URL` mode cannot be re-run on an already-migrated database (pre-existing).

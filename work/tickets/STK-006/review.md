## Attempt 1 — 2026-10-23
Verdict: PASS

### Checks (run by reviewer)
- typecheck: green (packages/core, apps/worker, packages/db `tsc --noEmit` Done; apps/web `next typegen && tsc --noEmit` Done)
- lint: green (`eslint .` Done in core, worker, db, web; no errors/warnings)
- test: green. core 6 files / 53 passed; db 8 files / 33 passed + 1 todo (`no query before auth (STK-004)`)
- db:check: `db:check OK` (apply → down → re-apply, schema unchanged)
- check:service-key: web build OK; hits in `.next/static` for sentinel / `SUPABASE_SERVICE_ROLE_KEY` / `service_role`: 0 / 0 / 0; "OK: no service key material in client bundle"
- The reviewer's results match impl-log.md Attempt 1.

### Acceptance criteria
- [x] AC1: repositories for transactions, corporate_actions, assets, settings, watchlist use the mappers, and no raw rows leak. Evidence: every repo maps through core `transactionFromRow` / `corporateActionFromRow` / `settingsFromRow` or the db `assetFromRow` / `watchlistFromRow` via `mapRow` (packages/db/src/repos/*.ts). `packages/db/src/index.ts` exports no `*Row` types (`rows.ts` is internal). Tests pass: `transactions.test.ts` (9), `corporate-actions.test.ts` (3), `settings.test.ts` (4), `assets-watchlist.test.ts` (4).
- [x] AC2: the service-role client is server-only, there is a bundle check, and no NEXT_PUBLIC key. Evidence: `apps/web/server/db.ts:1` is `import 'server-only'`, and it is the only web importer of `@stoktok/db` (asserted in `r3-guard.test.ts`). `createServiceClient` reads the key only from the `env` argument (`packages/db/src/client.ts`). The `r3-guard.test.ts` tests pass (5). `pnpm check:service-key` finds 0 hits.
- [x] AC3: auth before query. **Waived** (R6 suspended, ticket note). No auth code was added; there is only a comment seam at `apps/web/server/db.ts:9`. `ledger.test.ts` has `test.todo('no query before auth (STK-004)')`.
- [x] AC4: `loadLedger` returns core `buildLedger`'s result. Evidence: `packages/db/src/ledger.ts` loads the three inputs with `Promise.all` and returns `buildLedger(...)` unchanged. Tests pass: `ledger.test.ts › passes mapped inputs to buildLedger and returns its Result unchanged` (identity `toBe(sentinel)`) and `› same-day trades reach buildLedger in (tradeDate, seq) order` (real buildLedger, ok: true). There is no arithmetic on money or quantity in `packages/db/src`. The only comparison is the sort comparator in `transactions.ts` (`compareTransactions`).
- [x] AC5: unit tests with a mocked client. Evidence: a chainable fake in `packages/db/test/fake-client.ts` is used by all repo and ledger tests. Mapping, same-day ordering (`transactions.test.ts › list returns same-day rows sorted by seq…`, plus the ledger test) and pagination (`errors.test.ts › fetchAll stops on a short page`) are covered. The auth-before-query part is a todo (waived with AC3).

### Issues
None.

### Scope
Every changed file is in the plan's file list. The workflow files are `work/backlog.md`, `ticket.md`, `plan.md`, `impl-log.md` and `consult-database-optimizer.md`. There are no changes to `packages/core`, `supabase/` or `apps/worker`. The impl-log documents two deviations, and both are acceptable:
- `unwrapFound` helper.
- The multi-page test runs at the `fetchAll` level instead of the repo level.

### Rules R1–R10
No violations found.
- R1: no calculation outside core; `loadLedger` passes data through.
- R2: values go through `toSafeInt`; there are no floats.
- R3: the key is read only in `client.ts`; the web entry is server-only; the bundle has 0 hits.
- R4/R5: not touched; there are no market constants.
- R6: suspended, not flagged.
- R7: within the plan.
- R8: checks are green and the new logic is tested.
- R9/R10: not affected.

### Nits (do not block)
- `listAssets` / `listWatchlist` (packages/db/src/repos/assets.ts, watchlist.ts) do not paginate through `fetchAll`. This is fine for small, manually entered tables, but it is inconsistent with the other two list functions.
- `getSettings` maps *any* `RowMappingError` on `fee_rate_ppm` to NOT_CONFIGURED, including a malformed value as well as NULL (packages/db/src/repos/settings.ts `toSettings`). The plan specified exactly this; just noting it.
- `check:service-key` is currently a weak proof, because no page imports `server/db` yet. It becomes meaningful once STK-008/009 add server pages. `server-only` is the real guard until then.
- The `void _id;` destructure in `updateCorporateAction` could be replaced with an explicit field pick, as `tradeFields` does.

### Follow-ups (out of scope)
- Restore `requireUser()` in callers of `getDb()` and turn the `test.todo` into a real test when R6/STK-004 returns.
- Validate each `holidays` element in core `settingsFromRow`; add a settings read for the edit form that tolerates NULL fee.
- Add a positive control to `check:service-key` (sentinel present in `.next/server`) once a server page uses `getDb()`.

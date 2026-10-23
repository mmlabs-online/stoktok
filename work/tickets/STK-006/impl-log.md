## Attempt 1 — 2026-10-23

### Files touched
| File | Required because |
|---|---|
| packages/db/package.json, tsconfig.json, vitest.config.ts | New `@stoktok/db` package (plan). `@supabase/supabase-js` ^2.118.0 (installed 2.118.0). |
| packages/db/src/client.ts, errors.ts, rows.ts, mappers.ts, index.ts | Client factory, DataError/unwrap/unwrapFound/fetchAll/mapRow, asset/watchlist mappers, public exports (no row types). |
| packages/db/src/repos/{transactions,corporate-actions,settings,assets,watchlist}.ts | Repositories (AC1). |
| packages/db/src/ledger.ts | `loadLedger` (AC4). |
| packages/db/test/fake-client.ts | Chainable fake client (AC5). |
| packages/db/src/{errors,client,ledger,r3-guard}.test.ts, repos/*.test.ts | Tests listed in plan. |
| apps/web/server/db.ts | server-only entry (AC2); no auth code, comment seam only. |
| apps/web/package.json, next.config.ts | Deps `@stoktok/db`, `server-only`; `transpilePackages`. |
| scripts/check-no-service-key-in-client.sh, package.json | `pnpm check:service-key` bundle proof. |
| pnpm-lock.yaml | New deps. |

### Tests added / changed
- packages/db: errors.test.ts, client.test.ts, ledger.test.ts (incl. `test.todo('no query before auth (STK-004)')`), r3-guard.test.ts, repos/{transactions,corporate-actions,settings,assets-watchlist}.test.ts.
- Deviation: plan test "list pages with range until a short page (pageSize 2)" is covered at `fetchAll` level in errors.test.ts (the repos use a fixed page size 1000, no param added); the transactions test asserts range [0,999].
- Deviation: added `unwrapFound` in errors.ts (maybeSingle null → NOT_FOUND) and `unwrap<T>` takes the row type explicitly, because the untyped supabase client infers `null` data.

### Checks (actual output summary)
- typecheck: green (core, worker, db, web)
- lint: green (no errors/warnings)
- test: core 53 passed; db 33 passed, 1 todo (8 files)
- db:check: `db:check OK`
- check:service-key: hits for sentinel / SUPABASE_SERVICE_ROLE_KEY / service_role in .next/static: 0 / 0 / 0; "OK: no service key material in client bundle"
- `import 'server-only'` passed typecheck; no .d.ts shim was needed. `isValidDate` not exported from core, so assets use a local YYYY-MM-DD regex (per plan).

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Validate each element of `holidays` in settings mapping (core).
- Settings read tolerant of NULL fee rate for the edit form.
- Restore requireUser() in apps/web/server/db.ts callers when R6 returns; Cloudflare exposure before auth.
- Repos use a fixed page size 1000; no multi-page repo-level test.

### Scope self-check
- Could the diff be smaller? No; mostly tests and one cohesive package.
- Diff size: new package ~330 source lines, ~400 test lines; small edits elsewhere.

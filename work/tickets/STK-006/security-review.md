# Security review — STK-006, attempt 1

I had no shell, so I could not run `git diff main...HEAD` or the checks. I read all changed and new files directly. The check results quoted below come from impl-log.md; I did not re-run them.

**Verdict: no 🔴 blocking findings.** R3 is met in the code. One 🟡: the bundle check passes today but cannot fail yet, so it does not prove what AC2 asks.

## Findings

**🟡 1. The bundle check can't fail yet** — `scripts/check-no-service-key-in-client.sh:9-21`
- No page, route or component imports `apps/web/server/db.ts`. A grep of `apps/` finds no importer, so the build never pulls `@stoktok/db` into the client bundle. "0 / 0 / 0 hits" is therefore guaranteed whatever the code does.
- The script is built correctly. `set -euo pipefail` means a `server-only` violation fails the build and the script. It fails if `.next/static` is missing, and the sentinel comes from the runtime env.
- What actually protects AC2 today is `import 'server-only'` (`apps/web/server/db.ts:1`) plus the static guard test.
- Fix: record in review.md that AC2(c) is a regression tripwire that becomes meaningful when the first page imports `server/db`. Add a follow-up to re-run `pnpm check:service-key` in that ticket, ideally after adding a `.next/server` positive control (the sentinel module is present server-side and absent from `static`).

**🟡 2. The `service_role` needle will false-positive later** — `scripts/check-no-service-key-in-client.sh:17`
- The literal `service_role` can show up in client bundles from `@supabase/auth-js` strings once any supabase-js code reaches the browser. Today R3 forbids that, so it is OK now.
- Fix: no change needed now. If it ever false-positives, drop that needle and keep the sentinel and `SUPABASE_SERVICE_ROLE_KEY` needles.

**💭 3. The guard test only catches direct imports** — `packages/db/src/r3-guard.test.ts:41-52`
- The `'use client'` check misses transitive imports (a client file importing a helper that imports `server/db`). `server-only` covers that case at build time.
- The importer check at line 51 matches `from '@stoktok/db'` with single quotes only. Double quotes or `import('@stoktok/db')` would slip past. Prettier probably normalises quotes, so this is low risk.
- Test 1 (`^\s*NEXT_PUBLIC_`, line 25) would miss `export NEXT_PUBLIC_…`. Trivial.

**💭 4. Error messages are clean, but `cause` holds raw details**
- `DataError` messages (`packages/db/src/errors.ts:20`) contain only table, op and pg code. `client.ts:8,10` names the missing variable without its value, and `client.test.ts` checks this.
- `cause` holds the raw PostgREST error (`errors.ts:34-38`, e.g. `Key (symbol)=(…)` details) and the `RowMappingError`, whose core message includes row values (e.g. `mappers.ts:26,28`).
- `cause` is non-enumerable, so `JSON.stringify(err)` won't include it, but `console.error(err)` will print it.
- Note for the first route ticket: send only `code` to clients, never `err.cause` or `String(err)` of the cause.

**💭 5. All write paths use explicit columns.** No mass-assignment risk.
- `transactionToInsert` and `tradeFields` (`repos/transactions.ts:15-18`): update cannot change `source`, `import_batch_id`, `seq` or `id`.
- `corporateActionToRow` with a server-generated UUID, and `id` stripped on update (`repos/corporate-actions.ts:32,48`).
- `assetToRow` (`mappers.ts:33-35`).
- `settingsToRow` hard-codes `id: 1`.
- `addToWatchlist` writes `{ symbol }` only.
- Every select uses an explicit `COLS` list. Every update and delete is scoped by `.eq('id'|'symbol', …)`, so no unscoped mass update or delete is possible.

**💭 6. Service-role client and env are fine** (R3)
- `createServiceClient` reads only from its `env` argument and turns session features off (`client.ts:11-13`).
- The web singleton is lazy and reads `process.env` at runtime (`server/db.ts:11-14`).
- `next.config.ts` has no `env:` block.
- `.env.example` has no `NEXT_PUBLIC_*` keys, and `.env`, `.env.local` and `.next/` are git-ignored.
- `server/db.ts:16` re-exports `createServiceClient`, so any server module could build a client from any env object. That is acceptable, since the module is server-only.

**💭 7. Dependencies are pinned by the lockfile** (`pnpm-lock.yaml:908`)
- `@supabase/supabase-js` is `^2.118.0`, locked at 2.118.0 with its sub-packages at the same version. `server-only` is `^0.0.1`, locked at 0.0.1.
- Caret ranges match the repo convention. There is no CI workflow yet to enforce `--frozen-lockfile`; the CI/deploy ticket should add it.

**💭 8. R6 is suspended, as directed.**
- No auth code was added. There is a comment seam at `server/db.ts:9`, and impl-log records `test.todo('no query before auth (STK-004)')`.
- Any future route that calls `getDb()` has full read/write on the service role and no auth until STK-004 or Cloudflare Access is in place. This is already tracked as a follow-up.

## Recommendations
1. AC2(c): the reviewer should accept `pnpm check:service-key` as a tripwire, not as proof (finding 1). Add a follow-up to re-run it in the first ticket that imports `server/db` from a page or route.
2. Follow-up for the first route ticket: a no-`cause` error response contract (finding 4) and `requireUser()` at each caller (R6, once restored).
3. Optional hardening of the guard test regexes (finding 3). This is not needed for PASS.

## Risks
- Until a client-reachable page exists, AC2's bundle proof rests on `server-only` and the static guard, not on the build check.
- Unauthenticated service-role access is one route away while R6 is suspended.

## Open questions
- None blocking. Ming may want CI to run `pnpm check:service-key` once workflows exist.

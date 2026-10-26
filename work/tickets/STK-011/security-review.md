## Security review: STK-011, attempt 1

**Verdict: no blocking findings (no 🔴).** Two small 🟡 items and a few 💭 notes.

I had no shell, so I could not run `git diff 569e159^..HEAD`. I read the files listed in impl-log.md directly instead. I did not run any checks myself; the green results below come from impl-log.md.

### Findings

**Migration and rollback**
- ✅ `supabase/migrations/20261025000100_symbols.sql:13-15`: RLS is enabled with no policies, so anyone without an explicit grant is denied everything. Access is revoked from `anon` and `authenticated`, and only `service_role` gets select/insert/update/delete.
  - The default privileges set in `20261023000200_v1_rls_grants.sql:17-19` already revoke new-table access from `anon`/`authenticated`, so the explicit revoke is a second layer.
  - The table has a text primary key, so no sequence grants are needed.
- ✅ Check constraints:
  - `symbol ~ '^[A-Z0-9]{1,20}$'` (line 5).
  - `exchange in ('HOSE','HNX','UPCOM')` or NULL (line 6).
- ✅ `supabase/rollback/20261025000100_symbols.down.sql:1` only drops the table. It does not touch grants or default privileges, so it cannot reopen access.
- 💭 `symbols.sql:5`: the database allows symbols of 1–20 characters, but `normalizeSymbol` (`packages/core/src/symbol.ts:4`) requires 3–10. The database is looser, which is safe because core is the gate. Tightening it to `{3,10}` would make the two match. Not required.

**scripts/db-check/checks.sql**
- ✅ The generic checks loop over every public table, so they cover `symbols` automatically: RLS enabled (115-121), no policies (123-128), no grants to anon/authenticated/PUBLIC (130-139), and anon/authenticated denied select and insert with 42501 (141-152).
- ✅ The new checks pass: `symbols` added to `tables_exist` (34), column checks (109-113), service_role read/write (182-191), and three bad-row cases (212-214).
- 💭 There is no `rls_blocks_even_with_grant` case for `symbols` (only `watchlist`, 154-169). It isn't needed, because the `no_policies` check covers the same guarantee.

**packages/db/src/repos/symbols.ts and getRecentCloses**
- ✅ No mass assignment. `symbols.ts:25` upserts only a fixed object: `{ symbol, exchange, updated_at }`. `created_at` cannot be overwritten, and `updated_at` is set on the server.
- ✅ `.in('symbol', [...symbols])` (`symbols.ts:14`) is fed only by `loadWatchlist` (`load-watchlist.ts:55-61`). Those values are symbols read from the database (the ledger and the watchlist), never request input. supabase-js quotes values containing `,()`, and the values here can't contain those characters anyway.
- ✅ `getRecentCloses` (`prices-daily.ts:41-43`) uses parameterized `.eq('symbol', symbol)` with the same database-sourced list.
- 💭 It runs one query per symbol (N queries). Already logged as a follow-up; it's a performance issue, not a security one.

**Handlers and actions**
- ✅ Every entry point re-validates on the server:
  - `handleAddWatch` uses `validateWatchlistInput`: `normalizeSymbol` plus the `EXCHANGES` whitelist via `parseExchangeInput` (`validate-watchlist.ts:24-29`).
  - `handleRemoveWatch` and `handleSetExchange` call `normalizeSymbol` on the bound symbol (`handlers.ts:42, 56`) and `parseExchangeInput` on the exchange (`handlers.ts:58`).
  - Exchange matching is exact against a whitelist after trim and uppercase. Anything else is rejected.
- ✅ The STK-008/030 undefined/null pattern is closed. The bound symbol (`page.tsx:14,16`, `.bind(null, r.symbol)`) is public and can be changed by the client, but:
  - It must pass `normalizeSymbol`, which returns null for empty, `"undefined"`-style garbage or wrong-format values. The handler then returns `SYMBOL_INVALID` before any repo call.
  - So `removeFromWatchlist`'s `.eq('symbol', …)` (`watchlist.ts:24`) never receives undefined or an empty string, and there is no unfiltered delete.
  - Nothing ever deletes from `symbols`.
- ✅ DataError details don't leak. `fromThrown` (`handlers.ts:21-24`) maps errors to a fixed code (`SAVE_FAILED`, or `WATCHLIST_DUPLICATE` on CONFLICT) through `failForm` and `message({code})`. The DataError message and cause never reach the client. Non-DataErrors are rethrown, and Next hides those in production behind an error digest.
- ✅ Redirects: there are none. `actions.ts` only calls `revalidatePath('/watchlist')`, a constant path.
- ✅ The service key stays server-only:
  - `apps/web/server/db.ts:1` has `import 'server-only'`.
  - The client components (`add-symbol-form.tsx:5`, `row-forms.tsx:6`) import only types from `server/watchlist/handlers`, and those imports are erased at build time.
  - impl-log.md reports that `check:service-key` passed.
- 🟡 `handlers.ts:41, 54`: if a client calls an action directly with a non-string bound argument (null, a number, an object), `normalizeSymbol(raw)` (`symbol.ts:3`) throws a TypeError, which becomes a 500 instead of `SYMBOL_INVALID`. This is not a security hole: it fails closed and nothing is written. Fix: add `typeof symbolRaw !== 'string'` to the guard. Similarly, `str()` / `fd.get` throws if `formData` is not a FormData object, which also fails closed.
- 🟡 `handlers.ts:54-66`: `setExchangeAction` accepts any symbol that is well-formed but not watched or held, and upserts a `symbols` row for it. Since action endpoints are public, a caller can create unlimited orphan rows or change the exchange of any symbol. That matters because the exchange drives price limits and tick size on the board. Today this is covered only by the suspended R6. Recommendation: either accept it and note it as part of the R6 / STK-004 exposure, or restrict the action to symbols that are watched or held (that change would go to the follow-ups list per R7, not this diff).
- 💭 `handlers.ts:32-33`: in `handleAddWatch`, `setSymbolExchange` runs before `addToWatchlist`. A duplicate add still overwrites the stored exchange even though it returns `WATCHLIST_DUPLICATE`. It's harmless (the user chose that exchange), and it isn't atomic. Noted only.

### Recommendations
1. 🟡 Add a typeof string guard on the bound `symbolRaw` in both handlers. This hardens the server actions against crafted calls, the same lesson as STK-008/030.
2. 🟡 Record the `setExchangeAction` scope (any symbol is writable) in the R6 / STK-018 go-live risk list. Optionally limit it to watched or held symbols in a follow-up.
3. 💭 Optionally tighten the database symbol check to `{3,10}` so it matches core.

### Risks
- **R6 suspended (not blocking):** all three server actions are unauthenticated public endpoints. Once the app is exposed (STK-018), anyone can add or remove watchlist entries and change exchanges, and the board reveals Ming's held symbols. This must be resolved by restoring R6 or putting the subdomain behind Cloudflare Access before go-live.

### Open questions
- None blocking. One for Ming or the planner: should changing a symbol's exchange be limited to symbols that are watched or held?

## Attempt 1 — 2026-10-23
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: green (core, worker, db, web `next typegen && tsc --noEmit`), exit 0
- lint: green, all 4 packages, exit 0
- test: green. core 15 files / 136 tests; db 8 files / 39 passed + 1 todo; web 8 files / 71 tests. Matches impl-log.
- build: green. `/transactions`, `/transactions/new`, `/transactions/[id]/edit`, `/transactions/[id]/delete` are dynamic; `/transactions/corporate-actions/new` is static.
- check:service-key: OK, 0 hits in `.next/static`.
- Visual/runtime check: I ran `next start` against a throwaway PostgREST stub (3 transactions, 1 cash dividend, settings with `fee_rate_ppm = NULL`). I drove it with Chromium through a scratch playwright-core install. Screenshots are in `/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/stk-008/` (list, new, edit, ca-new at 375 and 1280, plus new-errors-375). The list, filters, pagination, fee banner, edit pre-fill and Vietnamese field errors all render correctly. An overflowing input (qty 100.000.000 × price 100.000.000) shows the LEDGER_INVALID banner and does not crash.

### Acceptance criteria
- [x] AC1 list + filters + pagination, server-side: `packages/db/src/repos/transactions.test.ts` › "listTransactionsPage pushes all filters to SQL…" and "…without filters adds none"; `apps/web/lib/transaction-list-query.test.ts`. `page.tsx` is an async server component that calls `listTransactionsPage`. Seen working in the browser at 375/1280.
- [ ] AC2 add/edit/delete (auth waived, R6): the handlers are correct and tested (`handlers.test.ts` › create/update/delete/NOT_FOUND/oversell). **But the add/edit form loses the chosen side after any validation error (Issue 1)**, so a sell can be saved as a buy.
- [ ] AC3 corporate actions (cash and stock dividend; rights issue deferred per plan A1): the handlers and core are tested (`handlers.test.ts` › "creates a valid cash dividend…", "…stock dividend", "rejects rights_issue", "maps a unique violation to CA_DUPLICATE"). **Same reset bug on the `type` select (Issue 1).**
- [x] AC4 core validation + Vietnamese errors: `validate-transaction.test.ts` (price > 0, lot multiple vs `oddLot`, `lotSize: 10` proves R5 parameterisation), `check-ledger-change.test.ts` (T+2, multiple lots, partial sells, stock dividend listing date, edit/delete breaking a later sell, escape hatch), `messages-vi.test.ts`. In the browser, the QTY_NOT_LOT and PRICE_LOW_UNCONFIRMED messages render under their fields.
- [x] AC5 integer VND, no calc in UI: `parse-input.ts` uses a regex and BigInt with no floats. `handlers.test.ts` › "stores 125.400 as integer 125400". `no-calc-in-ui.test.ts` is green. My grep of the new `.tsx` found no arithmetic, `Number(`, parsing or `new Date(`.
- [x] AC6 tests: core validation tests exist. Each invalid handler case asserts that no repo write happens. Reject-without-auth is waived (R6) and the waiver is noted in impl-log.

### Issues
#### Issue 1 — 🔴 blocker — data integrity: `<select>` values reset after a failed submit
- **Where**: `apps/web/components/transactions/transaction-form.tsx:37-48` (`side`), `apps/web/components/transactions/corporate-action-form.tsx:28-39` (`type`)
- **Expected**: after a server validation error, every field shows what the user submitted. The handler already echoes `values.side` / `values.type`.
- **Actual**: React 19 resets a form after its `action` completes, and an uncontrolled `<select defaultValue>` falls back to its first option. Reproduced in Chromium: on /transactions/new, choose **Bán**, qty 150, submit, and the error shows but the select reads **Mua** (`side= buy` after the error). In the CA form, choose "Cổ tức cổ phiếu", submit with held 0, and it comes back as `cash_dividend`. If the user fixes the quantity and resubmits, the sell is **saved as a buy**: a silent ledger corruption. Text inputs and checkboxes do keep their values; only selects are affected.
- **Fix instruction**: make both selects controlled. In `TransactionForm`, add `const [side, setSide] = useState(values.side)` and render `<select value={side} onChange={(e) => setSide(e.target.value)} …>`. Do the same for `type` in `CorporateActionForm`. Hooks must run before the `if (state.ok) return null` early return, so move that return below the hooks or initialise the state from `initial.values`. No other change is needed: the controlled value survives the form reset. Note the manual check in impl-log (select Bán, trigger an error, and confirm it stays Bán). I will re-verify in the browser.

#### Issue 2 — 🟡 should-fix — corporate action table is unreadable at 375px
- **Where**: `apps/web/components/transactions/corporate-action-list.tsx:13-31`
- **Expected**: readable columns on mobile (the plan's AC1/AC3 manual checks at 375px).
- **Actual**: `<th>`/`<td>` have no horizontal padding, so at 375px the cells run together ("FPTCổ tức tiềnCổ tức tiền 1.000 ₫/cp"; see `list-375.png`).
- **Fix instruction**: add horizontal padding to every cell (e.g. `px-2` on `th`/`td`, `whitespace-nowrap` on the date column). Or reuse the card pattern from `transaction-list.tsx` with `hidden md:table` / `md:hidden`. Keep it formatting-only.

#### Issue 3 — 🟡 should-fix — untrusted `id` gives 500 instead of 404 (from security-review S1)
- **Where**: `apps/web/app/(app)/transactions/[id]/edit/page.tsx:9-17`, `[id]/delete/page.tsx:8-12`, `apps/web/app/(app)/transactions/actions.ts:29-45`
- **Expected**: a non-UUID id gives `notFound()` on the pages and the `NOT_FOUND` form error in the actions.
- **Actual**: Postgres raises 22P02 → `DataError` is not `NOT_FOUND`, so the page throws a 500.
- **Fix instruction**: see `security-review.md` S1. Add a single `isUuid` helper in `apps/web/server/` and use it in both pages and both id-taking actions.

### Rules R1–R10
No violations found.
- R1: all financial logic (validation, sellable replay, descriptions) is in `packages/core`. The `.tsx` files only format.
- R2: integer end to end (BigInt-checked parse, int4 caps for qty and price, bigint for fee and tax).
- R3: client components receive server actions as props and import only types from `server/`. The service-key check passes.
- R5: lot size comes from `DEFAULT_TRADING_RULES` as a parameter. Settlement days and holidays come from settings.
- R6: suspended, not flagged.
- R7: out-of-plan files (`form-fields.tsx`, `isValidDate` export, import via `server/db.ts`, `force-dynamic`) are justified in impl-log.
- R8: green.

### Nits (do not block)
- 💭 The `checkLedgerChange` escape hatch (`check-ledger-change.ts:59-62`) is per plan. Because `buildLedger` stops at the first OVERSELL across *all* symbols, one pre-existing oversell masks every new oversell dated after it, on any symbol. Increasing the quantity of the already-oversold sell is also allowed. This is acceptable for v1 (manual entry can't create the first oversell), but worth a follow-up.
- 💭 In the desktop table, the "Ước tính" tax cell sits flush against "Sửa". A little `pr-` on the Thuế column would help.
- 💭 `page.tsx` reverses the corporate action list in the component (`[...actions].reverse()`). That is ordering, not math, but a `newestFirst` option in the repo would be cleaner.

### Follow-ups (out of scope)
- Generic `app/(app)/error.tsx` boundary (security-review S2).
- Per-symbol oversell checking so one bad symbol doesn't mask the others (see nit 1).
- Plan F1–F6 stand.

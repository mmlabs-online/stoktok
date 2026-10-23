## Attempt 1 — 2026-10-23

Built Slice A (transactions) then Slice B (corporate actions) in one pass. Not committed (orchestrator commits).

### Files touched
| File | Required because |
|---|---|
| packages/core/src/entry/rules.ts (new) | R5 lot size as config parameter, INT32_MAX, low-price threshold |
| packages/core/src/entry/parse-input.ts (new) | AC5 integer VND parsing without floats |
| packages/core/src/entry/messages-vi.ts (new) | AC4 Vietnamese messages defined once |
| packages/core/src/entry/validate-transaction.ts (new) | AC4 validation, edit pre-fill |
| packages/core/src/entry/check-ledger-change.ts (new) | AC4 sellable check via buildLedger replay |
| packages/core/src/entry/validate-corporate-action.ts (new) | AC3 (Slice B) |
| packages/core/src/entry/describe.ts (new) | AC3 list description |
| packages/core/src/calendar.ts | `vnDateOf` for "today" in VN time |
| packages/core/src/index.ts | export new symbols (+ `isValidDate`, see Out-of-plan) |
| packages/core/src/entry/*.test.ts (7 new), calendar.test.ts | R8 |
| packages/db/src/repos/transactions.ts | `listTransactionsPage`, `getTransaction` |
| packages/db/src/repos/settings.ts | `getEntrySettings` |
| packages/db/src/index.ts | exports |
| packages/db/test/fake-client.ts | `gte`, `lte`, `count` |
| packages/db/src/repos/transactions.test.ts, settings.test.ts | R8 |
| apps/web/lib/transaction-list-query.ts (+ test) | AC1 URL parsing, page meta, hrefs |
| apps/web/server/clock.ts | single server clock |
| apps/web/server/transactions/handlers.ts (+ test) | AC2, AC3, AC4, AC6 |
| apps/web/app/(app)/transactions/actions.ts | server actions (one entry point each) |
| apps/web/app/(app)/transactions/page.tsx | list page, filters, pagination, "Sự kiện quyền" |
| apps/web/app/(app)/transactions/new/page.tsx, [id]/edit/page.tsx, [id]/delete/page.tsx, corporate-actions/new/page.tsx | AC2, AC3 pages |
| apps/web/components/transactions/{transaction-form,delete-transaction-form,corporate-action-form,transaction-list,transaction-filters,pagination,corporate-action-list}.tsx | UI |
| apps/web/components/transactions/transactions.test.tsx | R8 |

### Tests added / changed
- core: parse-input, validate-transaction, check-ledger-change, validate-corporate-action, describe, messages-vi, calendar `vnDateOf`
- db: `listTransactionsPage` (filters, range, count, order; no filters; null count), `getTransaction`, `getEntrySettings` (set, NULL fee, missing row)
- web: transaction-list-query, handlers (create/update/delete/corporate action, invalid input means no write, NOT_FOUND, CONFLICT to CA_DUPLICATE, DB_ERROR to SAVE_FAILED), transactions.test.tsx
- Reject-without-auth tests waived: R6 suspended (CLAUDE.md, 2026-10-23). No auth code added; each action calls `getDb()` first, which is where `requireUser()` goes later.

### Checks (actual output summary)
- typecheck: all packages pass (core, db, web `next typegen && tsc --noEmit`), no errors
- lint: all packages pass, no problems
- test: core 15 files / 136 tests; db 8 files / 39 passed + 1 todo; web 8 files / 71 tests, all pass
- build: pass (routes /transactions, /transactions/new, /transactions/[id]/edit, /transactions/[id]/delete, /transactions/corporate-actions/new)
- check:service-key: OK, 0 hits in .next/static

Manual checks at 375px and >= 768px were NOT run (no browser, no Supabase env in this environment); the layout uses `hidden md:table` / `md:hidden` and `min-h-11` targets. The reviewer or Ming should eyeball them.

### Out-of-plan files
- apps/web/components/transactions/form-fields.tsx (new): shared Field/TextField/CheckField/banner/class strings so the three forms do not triplicate them.
- packages/core/src/index.ts also exports `isValidDate` (file is in the plan; the symbol was not): needed by `parseTransactionListQuery` to validate dates without `new Date(`.
- Handlers import repo functions from `apps/web/server/db.ts` (not `@stoktok/db`) because `packages/db/src/r3-guard.test.ts` allows only that file to import `@stoktok/db`. The handler test therefore mocks `../db` and `server-only`.
- `new/page.tsx` has `export const dynamic = 'force-dynamic'` so the build does not prerender a page that reads the DB.

### Deviations from the plan
- Client form components take the server action as a prop (passed from the server page) instead of importing `actions.ts`; same R3 outcome, easier to test.
- `pageMeta` also returns `prevPage`/`nextPage` so pagination.tsx does no arithmetic (R1 spirit).
- Edit pre-fill sets `confirmLowPrice` true when the stored price is below 1.000 so the row can be re-saved.

### Follow-ups (noticed, not done)
- Plan follow-ups F1 to F6 stand (rights issue, CA edit/delete, rule_configs lot size, extra input checks, UX extras, thousand-VND entry).
- Settings page is still a placeholder, so the "Cài đặt" link in the fee banner leads to an empty screen until STK-010.

### Scope self-check
- Could the diff be smaller? No further: no migration, no new dependency, no rights issue, no CA edit/delete.
- Diff size: ~+2,150 lines incl. tests (21 new files plus 10 modified); modified files are small additive edits.

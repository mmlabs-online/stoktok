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

## Attempt 2 (REWORK) — 2026-10-23

### Files touched
- apps/web/components/transactions/transaction-form.tsx, corporate-action-form.tsx: `side` / `type` selects are now controlled (`useState` initialised from `initial.values`, hook placed before the `state.ok` early return). Required by review Issue 1.
- apps/web/components/transactions/corporate-action-list.tsx: `px-2` on all cells, `whitespace-nowrap` on the date column (Issue 2).
- apps/web/server/is-uuid.ts (new): single `isUuid` helper (Issue 3).
- apps/web/server/transactions/handlers.ts: `handleUpdateTransaction` and `handleDeleteTransaction` return `NOT_FOUND` for a non-UUID id before any DB access. Both actions go through these handlers, so the guard covers them (Issue 3).
- apps/web/app/(app)/transactions/[id]/edit/page.tsx, [id]/delete/page.tsx: `if (!isUuid(id)) notFound()` (Issue 3).

### Tests
- handlers.test.ts: non-UUID id for update and delete gives NOT_FOUND with no list/write call; existing fixture ids changed to UUIDs.
- transactions.test.tsx: form rendered with `values.side='sell'` has the `sell` option selected (Issue 1, cheap SSR check).
- Manual check still worth doing in a browser: choose Bán, trigger a validation error, confirm the select stays Bán (same for CA type). The browser form-reset behaviour is not covered by the SSR test.

### Checks
- typecheck, lint: pass
- test: core 136, db 39 passed + 1 todo, web 74 (8 files), all pass
- build: pass; check:service-key: OK, 0 hits

### Out-of-plan files
- apps/web/server/is-uuid.ts (new helper, requested by security-review S1).

### Follow-ups
- Unchanged (security S2 error.tsx, per-symbol oversell check).

### Scope self-check
Only the three review issues were changed. Nothing committed.

## Attempt 3 (REWORK) — 2026-10-23

### Files touched
| File | Required because |
|---|---|
| apps/web/components/transactions/transaction-form.tsx | Review attempt 2 Issue 1: `<form action={formAction}>` replaced by `onSubmit` (preventDefault, `new FormData(e.currentTarget)`, `startTransition(() => formAction(fd))`), so React 19 no longer resets the form (and the selects) after the action. Controlled select kept. |
| apps/web/components/transactions/corporate-action-form.tsx | Same change for the corporate-action form. |

`delete-transaction-form.tsx` untouched (no fields). `pending` still comes from `useActionState` and disables the submit button, since the action runs inside a transition.

### Tests added / changed
- None. The bug is browser form-reset behaviour, which SSR/vitest cannot cover; verified in a real browser instead (below). `no-calc-in-ui.test.ts` stays green.

### Browser check (done, real Chromium)
Scratch playwright-core in `.../scratchpad/pw` (outside the repo), PostgREST-like stub `.../scratchpad/stub.mjs`, fresh `next build` + `next start -p 3921`. Scripts `pw/a3.mjs`, `pw/a3b.mjs`; screenshots in `.../scratchpad/stk-008/attempt3/`. Servers stopped afterwards.
- /transactions/new: choose Bán, qty 150, submit: select value `sell` (label Bán). Second failed submit: still `sell`; the POST body contains `sell` (2 POSTs observed). Reselecting Mua still works (`buy`).
- /transactions/<sell id>/edit: prefill `sell`, error on price: still `sell`.
- /transactions/corporate-actions/new: choose Cổ tức cổ phiếu, held 0, submit twice: `stock_dividend` after both; the POST body contains `stock_dividend`.
- Delete page still renders its form with the "Xóa" button (not submitted against the stub). The disabled-while-pending state was not observed visually (the stub responds instantly); the code path is unchanged (`disabled={pending}`).

### Checks (actual output summary)
- pnpm install: up to date
- typecheck: pass (exit 0)
- lint: pass
- test: core 15 files / 136; db 8 files / 39 passed + 1 todo; web 8 files / 74, all pass
- build: pass
- check:service-key: OK, no service key material in client bundle

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- None new.

### Scope self-check
- Could the diff be smaller? No. +20 / -4 lines across two files, nothing committed.

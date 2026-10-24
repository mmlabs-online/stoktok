## Attempt 1 — 2026-10-24
Verdict: PASS

Scope reviewed: `git diff 1814c6c^..HEAD` (STK-030 only; STK-009 is in PR #8). R6 is suspended, so missing auth is not flagged.

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile`: up to date.
- typecheck: pass (core, db, worker, web).
- lint: pass, no warnings.
- test: core 176 passed (18 files); db 49 passed + 1 todo (9 files); web 106 passed (12 files). These match impl-log.md.
- build: success. `/assets`, `/assets/new`, `/assets/[id]/edit` and `/assets/[id]/delete` are all dynamic (ƒ).
- check:service-key: OK, 0 hits in `.next/static`.
- Runtime: `next start` against a stateful PostgREST stub for `assets` (GET/POST/PATCH/DELETE, `vnd.pgrst.object` + 406 PGRST116), driven by playwright-core Chromium at 375px and 1280px. Screenshots are in the session scratchpad under `stk-030/`.
  - `/assets` with no rows shows the empty state "Chưa có tiền mặt hoặc tài sản khác" with a link to add. With rows, the table shows at 1280px and cards at 375px. No horizontal overflow; a long name wraps; a value of 0 renders "0 ₫".
  - Add: the form defaults to type `cash` and as-of = today (2026-10-24). Entering "1,5" shows "Nhập số nguyên đồng, ví dụ 125400 hoặc 125.400.". A date of 2027-01-01 (after removing `max`) shows "Ngày cập nhật không được ở tương lai.". The type select stays on "other", and name and value are kept. A valid save (20.000.000) redirects to `/assets` and the new row shows.
  - Edit: the form prefills type, name, value and date. Saving 30.000.000 redirects, and the list updates.
  - Delete: the confirmation page reads "Xóa TCBS tiền mặt (50.000.000 ₫)? Tổng tài sản sẽ được tính lại.". Clicking Xóa removes the row and redirects to `/assets`.
  - `/assets/not-a-uuid/edit`, `/assets/not-a-uuid/delete` and an unknown UUID on `/edit` all return 404.
  - Dashboard with no transactions: the link "Quản lý tiền mặt & tài sản khác" → `/assets` is present. Net worth went 0 → 80.000.000 ₫ (Tiền mặt 50.000.000 · Khác 30.000.000) after add/edit, and → 30.000.000 ₫ after the delete.
  - All servers stopped afterwards.

### Acceptance criteria
- [x] AC1 `/assets` lists name, type, value and as-of, with a desktop table and phone cards. Evidence: `components/assets/asset-list.tsx:41-84` (`hidden md:table` / `md:hidden`, `min-h-11` actions), and `assets.test.tsx` › renders name, type label… / value 0 renders "0 ₫" / edit and delete links / empty state (all pass). Runtime screenshots `assets-rows-{375,1280}.png` and `assets-empty-*.png`.
- [x] AC2 Add/edit/delete use full-page forms and server actions in `server/assets/handlers.ts`, with a delete confirmation page; non-UUID gives 404 / NOT_FOUND. Evidence: `app/(app)/assets/actions.ts:82-104`, `[id]/edit/page.tsx` and `[id]/delete/page.tsx` (`isUuid` → `notFound()`, `DataError` NOT_FOUND → `notFound()`), and `handlers.test.ts` (non-UUID → ASSET_NOT_FOUND with no repo call). Runtime: 404 for non-UUID and unknown ids, and the redirects work.
- [x] AC3 `validateAssetInput` in core: name required, type cash|other, integer VND ≥ 0, valid as-of date; Vietnamese messages keyed by code. Evidence: `packages/core/src/entry/validate-asset.ts:43-65`, `validate-asset.test.ts` (5 cases: type, name/NFC/100 code points, value 0 / grouped / "1,5" / "-1" / cap, asOf future/invalid/empty), and `messages-vi.test.ts` including the 4 new codes.
- [x] AC4 The dashboard links to `/assets` and net worth picks up changes. Evidence: `portfolio-summary.tsx:51-53`, `portfolio.test.tsx` › summary links to /assets, also with no holdings, and `build-portfolio.test.ts` › several rows at ASSET_VALUE_MAX… The actions revalidate `/` (`actions.ts:84`). Runtime: net worth 0 → 80M → 30M.
- [x] AC5 Unit tests for core validation and handler tests (invalid input → no write; unknown id → NOT_FOUND). Evidence: `handlers.test.ts` (create/update invalid → no `createAsset`/`updateAsset` call; repo NOT_FOUND → ASSET_NOT_FOUND; delete DataError mapping and rethrow), and `assets-watchlist.test.ts` › getAsset (2). Auth tests are waived (R6).

### Issues
None.

### Scope
Every changed code file is in the plan's file list. `server/transactions/handlers.ts` only adds `export` to three helpers, as planned. The tracking files (`work/backlog.md`, ticket, consults, plan, impl-log) are workflow output. No migration, no new dependency, no nav change.

### Rules R1–R10
No violations found.
- R1/R2: parsing, validation and the cap are in core. Value is an integer parsed by BigInt `parseIntegerInput` with a 10^14 cap. Components only format (`MoneyText`, `formatDate`, `formatVnd`).
- R3: `getDb` is used only in server pages, actions and handlers. Components import only the `Asset` type via `server/db` (type-only, erased). check:service-key is clean.
- R5: `ASSET_VALUE_MAX` is a sanity bound, not a market rule.
- R6: suspended; the `requireUser()` placeholder comments are present.
- R8: core and handler tests were added and all checks are green.

### Nits (do not block)
- 💭 Desktop table: the Sửa/Xóa actions sit tight against the date column (`asset-list.tsx:301-304`); a `pl-4` on the actions cell would add air.
- 💭 Edit prefill shows the value ungrouped ("50000000"), as planned. Grouping it would match the help text, but that is a UX choice.
- 💭 `validate-asset.ts:63`: `|| type === null` is redundant (a null type always sets `errors.type`). It exists only for type narrowing, which is fine.

### Follow-ups (out of scope)
- From the plan: a duplicate-name warning, a staleness hint for an old `as_of`, a liabilities/margin type, and a `cancelHref` prop to unify the two delete forms.

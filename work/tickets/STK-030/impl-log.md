# Implementation log — STK-030

## Attempt 1

### Files touched
Core (`packages/core/src`)
- `entry/rules.ts`: added `ASSET_VALUE_MAX`, `ASSET_NAME_MAX_LENGTH` (AC3, overflow bound).
- `entry/messages-vi.ts`: 4 new codes and Vietnamese text (AC3).
- `entry/messages-vi.test.ts`: new codes added to `CODES`.
- `entry/validate-asset.ts` (new) and `entry/validate-asset.test.ts` (new): `validateAssetInput`, `assetToFormValues` (AC3, R1, R2).
- `portfolio/build-portfolio.test.ts`: overflow regression case (AC4).
- `index.ts`: exports.

DB (`packages/db/src`)
- `repos/assets.ts`: `getAsset` (edit and delete pages).
- `repos/assets-watchlist.test.ts`: `getAsset` tests.
- `index.ts`: export `getAsset`.

Web (`apps/web`)
- `server/transactions/handlers.ts`: exported `message`, `fieldErrors`, `failForm` (no behaviour change).
- `server/assets/handlers.ts` (new), `server/assets/handlers.test.ts` (new).
- `app/(app)/assets/actions.ts`, `page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx`, `[id]/delete/page.tsx` (all new).
- `components/assets/asset-list.tsx`, `asset-form.tsx`, `delete-asset-form.tsx`, `assets.test.tsx` (all new).
- `components/portfolio/portfolio-summary.tsx`: link to `/assets`.
- `components/portfolio/portfolio.test.tsx`: link test.

Work tracking: `work/tickets/STK-030/impl-log.md`.

### Tests added
validate-asset (type, name, value, asOf, prefill), messages codes, build-portfolio overflow, getAsset (2), asset handlers (create, update, delete), asset list and form render tests, portfolio summary link.

### Check results
- `pnpm install`: up to date.
- `pnpm typecheck`: pass (core, db, worker, web).
- `pnpm lint`: pass, no warnings.
- `pnpm test`: core 176 passed, db 49 passed (1 todo), web 106 passed.
- `pnpm build`: success, routes `/assets`, `/assets/new`, `/assets/[id]/edit`, `/assets/[id]/delete` listed.
- `pnpm check:service-key`: OK, no service key material in the client bundle.

### Out-of-plan files
None. Note: components must import the `Asset` type from `server/db`, not `@stoktok/db` (r3-guard test only allows `server/db.ts` to import `@stoktok/db`).

### Follow-ups
Per plan: duplicate-name warning, staleness hint for old `as_of`, liabilities/margin type, optional `cancelHref` prop to unify the two delete forms.

### Scope self-check
Only plan files changed. No auth code added (R6 suspended). Not committed or pushed, as instructed.

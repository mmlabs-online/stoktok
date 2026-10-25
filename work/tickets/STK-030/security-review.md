## Security review: STK-030, attempt 1 (static read only, nothing run)

**Verdict: no 🔴. One 🟡 that should be fixed before PASS: it repeats the STK-008 S3 bug exactly.** Everything else you asked me to check is clean.

### Findings

🟡 **S1: an `undefined` id on the update action creates an asset.** This is the STK-008 S3 pattern again.
- `apps/web/server/assets/handlers.ts:31` only checks the id when `id !== undefined`.
- `:35` then takes the create branch when `id === undefined`.
- `handleUpdateAsset` at `:45-46` passes `id` through unchecked.
- `updateAssetAction(id: string, …)` at `apps/web/app/(app)/assets/actions.ts:25-29` does not check the id either.
- **Exploit:** the id bound in `[id]/edit/page.tsx:20` is a server-action argument that the client sends, and React's encoding can carry `$undefined`. A direct POST to `updateAssetAction` with `id = undefined` skips the UUID check and calls `createAsset`. The values are still validated, so the impact is a write in the wrong mode (data integrity), not a privilege gain. With R6 suspended, anyone can already create through `createAssetAction`. But the ticket asked for exactly this case to be rejected.
- `null` and non-string ids are safe: `isUuid` (`server/is-uuid.ts:4`) checks `typeof === 'string'`, so they get `ASSET_NOT_FOUND`.
- **Fix (one commit):** in `handleUpdateAsset`, add `if (!isUuid(id)) return failForm(readAssetForm(formData), 'ASSET_NOT_FOUND');` before calling `submitAsset`. Or pass an explicit `{ mode: 'create' } | { mode: 'edit', id }` instead of deciding by whether `id` is undefined.
- **Test:** `handleUpdateAsset(db, undefined as unknown as string, fd, today)` returns `ASSET_NOT_FOUND` and `createAsset` is never called. `server/assets/handlers.test.ts` has no undefined or null id case today. This covers AC2 ("non-UUID ids give NOT_FOUND") and AC5.

🟡 **S2 (follow-up, not in this diff, R7): STK-008 S3 is still unfixed in transactions.** `apps/web/server/transactions/handlers.ts:108`, `:114`, `:122` and `:133-134` still have the undefined-id-means-create pattern. That is probably why it was copied here. Put it on the follow-ups list.

💭 **S3: hidden control characters in `name`.** `validate-asset.ts:33` normalises to NFC and collapses whitespace. Zero-width and bidi-override characters (e.g. U+202E) still get through. There is no XSS risk because React escapes the text. At most a stored name could display misleadingly. Optional: strip `\p{Cc}` and `\p{Cf}`.

### Checks that passed
- **Server re-validation, no mass assignment:** `readAssetForm` (`handlers.ts:18-20`) reads only 4 named fields as strings. `validateAssetInput` builds a new object: type whitelist, NFC and length ≤ 100 for name, integer value ≤ 1e14 via `parseIntegerInput`, date valid and not in the future. `assetToRow` (`packages/db/src/mappers.ts:34-36`) maps the fields explicitly. The DB has `check (type in …)`, `value >= 0` and `bigint` as a backstop.
- **Delete id:** `handlers.ts:49` checks `isUuid` with no `!== undefined` shortcut, so undefined and null are rejected. A zero-row delete returns NOT_FOUND (`assets.ts:42`).
- **Pages:** `[id]/edit/page.tsx:11` and `[id]/delete/page.tsx:10` call `notFound()` for non-UUID ids. `getAsset` NOT_FOUND also gives a 404. Other errors are rethrown to Next, which hides the message in production (digest only). There is no `error.tsx` that prints `error.message`.
- **No DB details reach the client:** `fromThrown` (`handlers.ts:23-27`) returns only a code (`ASSET_NOT_FOUND` or `SAVE_FAILED`) plus fixed Vietnamese text via `failForm`. `DataError.cause` and messages are never put into `FormState`. Errors that are not `DataError` are rethrown, which is the same masked path.
- **Redirects:** only the constant `redirect('/assets')` (`actions.ts:16`). `revalidatePath` uses constant paths.
- **Service key (R3):** `server/db.ts` imports `server-only`. The client components (`asset-form.tsx:5`, `delete-asset-form.tsx:5`) use only `import type` from server modules, which is erased at build. The impl-log reports that `check:service-key` passed. RLS and grants revoke `anon` and `authenticated` on `assets` (`20261023000200_v1_rls_grants.sql:6-10`).
- **Helpers exported from `server/transactions/handlers.ts`:** `message`, `fieldErrors` and `failForm` are pure formatting functions. The file is not a `'use server'` module, so exporting them creates no new action endpoints. It is reachable only from server code, and any client value import would fail the build because of `server-only` through `../db`.
- **Links:** `asset-list.tsx:17,20` build hrefs from DB uuids. No `dangerouslySetInnerHTML`.

### Not blocking (R6 suspended)
- None of the 3 actions in `actions.ts` or the 4 asset pages has authentication or an allowlist check. The `requireUser()` TODO comments are in place (`actions.ts:11`, `handlers.ts:11`). The exposure note for STK-018 still applies.

### Recommendations
1. Fix S1 and add the undefined/null id test in this attempt (AC2, AC5).
2. Log S2 as a follow-up for transactions.
3. S3 is optional.

### Open questions
None.

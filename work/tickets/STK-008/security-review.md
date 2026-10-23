# Security review: STK-008, attempt 1

**Verdict: no 🔴 blocking findings.** There are 2 🟡 should-fix items and a few 💭 notes. This was a static read only; I ran nothing.

## Findings

🟡 **S1. Transaction `id` is used unvalidated.** Locations:
- `apps/web/app/(app)/transactions/actions.ts:29-45` (`updateTransactionAction(id, …)`, `deleteTransactionAction(id)`)
- `apps/web/app/(app)/transactions/[id]/edit/page.tsx:9-12`
- `apps/web/app/(app)/transactions/[id]/delete/page.tsx:8-9`
- `apps/web/server/transactions/handlers.ts:131-139`

The id comes from `.bind(null, id)` and from the route params. Anyone can POST to a server action's ID with any arguments, so the action must treat `id` as untrusted, possibly not even a string. It is not exploitable: postgrest-js `.eq('id', v)` puts `v` into an encoded URL search param, so it cannot inject a filter or an extra param. A non-UUID makes Postgres raise 22P02. That becomes `VALIDATION`, then `SAVE_FAILED` in the actions. On the edit/delete pages it is not `NOT_FOUND`, so the page throws a 500 where it should show a 404.
- Fix: at the top of both actions (or the handlers) and both pages, check `typeof id === 'string'` and match it against a UUID regex. On failure return `failForm(…, 'NOT_FOUND')` in actions and call `notFound()` in pages. Put the check in one shared helper (`isUuid` in core or `apps/web/server`).
- Rule tied: none directly. It hardens AC2 server-side re-validation.

🟡 **S2. No `error.tsx` boundary under `apps/web/app/`.** I found none (glob). Errors that are not `DataError`, which `fromThrown` rethrows (`handlers.ts:57`), and page errors like S1 fall through to Next's default error page. In production Next hides the message and shows only a digest, so nothing leaks today. `DataError.message` is already safe anyway (table.op plus pg code; the cause is never serialized; `errors.ts:10-20`). Still, add a generic Vietnamese `app/(app)/error.tsx` that never renders `error.message`, so a later dev-mode or custom boundary doesn't start exposing it. This is a follow-up (R7), not this diff.

💭 **N1. Mass assignment: OK.**
- `readTransactionForm` / `readCorporateActionForm` (`handlers.ts:63-90`) only read named keys.
- `side` and CA `type` are whitelisted in core (`validate-transaction.ts:49`, `validate-corporate-action.ts:33`), and symbol goes through `normalizeSymbol`.
- `updateTransaction` writes only `tradeFields` (`transactions.ts:15-18`), never source, import ids or seq.
- Create forces `source: 'manual'`, and the CA id comes from the server (`randomUUID`).
- File-typed FormData entries become `"[object File]"` and fail validation.

💭 **N2. Query params / PostgREST filters: OK.** `parseTransactionListQuery` (`transaction-list-query.ts:20-44`) whitelists everything: symbol via `normalizeSymbol`, side as an enum, dates via `isValidDate`, page as `^\d{1,6}$`. The repo uses only `.eq/.gte/.lte/.range` (`transactions.ts:49-57`), with no `.or()`, `.filter()` or raw strings. `listHref` builds URLs with `URLSearchParams` and a fixed `/transactions` path.

💭 **N3. Redirects: OK.** `done()` (`actions.ts:17-20`) redirects to the constant `/transactions`. There is no `returnTo` or next param anywhere, so no open redirect.

💭 **N4. Error leakage: OK.** Clients only get `FormMessage {code, message}` built from `entryMessage(code)` (`handlers.ts:43, 51-61`). `DataError.cause` and pg details never reach form state. Echoed `values` are the user's own input and React escapes them on render.

💭 **N5. Service key (R3): OK.**
- `server/db.ts` imports `'server-only'` and reads `process.env` at runtime.
- Client forms import only *types* from `server/transactions/handlers.ts`, which are erased at build. They get actions as props from server pages.
- impl-log reports `check:service-key` found 0 hits in `.next/static`.

💭 **N6. CSRF: no extra concern.** All mutations are POST server actions, which get Next's Origin/Host check by default. Nothing mutates through GET; the delete page is GET, but deleting needs the action POST.

💭 **N7. Minor DoS: no length cap on form strings.** Long strings are echoed back in `values`. This is negligible for a single user; an optional cap (e.g. 64 characters per field) would fix it in `readTransactionForm`.

💭 **N8. R6 (auth) is suspended, not flagged.** Every action and page is unauthenticated, and so is every write through the service-role client that bypasses RLS. Each entry point calls `getDb()` first, so adding `requireUser()` later is one line each. As CLAUDE.md says, this must be resolved (STK-004 or Cloudflare Access) before STK-018 go-live.

## Recommendations
1. Fix S1 in this ticket: a UUID guard in the 2 actions and 2 pages, plus a handler test with a non-UUID id that expects NOT_FOUND and no write (AC2, AC6, R8).
2. Log S2 and N7 as follow-ups (R7).

## Risks
- Until R6 is restored, anyone who can reach the app can read and change the whole ledger. Today that is mitigated only by the app not being exposed publicly.

## Open questions
- None.

---

# Security review: STK-008, attempt 2 (rework)

**Verdict: S1 is fixed for every string or non-UUID id. There are no 🔴 findings. One new 🟡 edge case: if the edit action gets an `undefined` id, it creates a transaction instead of rejecting the request.** I only read the code statically and ran nothing.

## Findings

✅ **S1 is fixed.**
- `apps/web/server/is-uuid.ts:1-4`: the regex is `^…$`, anchored at both ends. It has the `i` flag but not `m`. In JS, `$` without `m` matches only at the true end of input, so a trailing `\n` or extra text is rejected. The pattern is strict: hex only, 8-4-4-4-12, with no version check, which suits Postgres `uuid`. `typeof v === 'string'` runs first, so numbers, objects, arrays and `null` all return false and nothing throws.
- **Delete action:** `handlers.ts:137` runs the guard before `getEntrySettings`, `checkChange` and `deleteTransaction`, and returns `NOT_FOUND`.
- **Update action:** `handlers.ts:108` runs the guard before any DB access and returns `NOT_FOUND`.
- **Pages:** the edit page (`[id]/edit/page.tsx:11`) and the delete page (`[id]/delete/page.tsx:10`) both call `notFound()` before `getDb()`. The `.bind(null, id)` calls (`edit:24`, `delete:22`) only ever bind an id that passed the check.
- **Tests:** `handlers.test.ts:134-140` and `:164-170` pass non-UUID ids and assert `NOT_FOUND`, no `listTransactions` call and no write. This meets recommendation 1 from attempt 1.
- **Corporate-action create:** it takes no id from the client, so it needs no guard (confirmed).

🟡 **S3 (new): an `undefined` id on the update action is treated as a create.** `handlers.ts:108` only validates when `target.id !== undefined`, and `:114` and `:122` take the *add* branch when `target.id === undefined`. React's server-action argument encoding can carry `undefined` (`$undefined`). So a direct POST to `updateTransactionAction` with `id = undefined` (`actions.ts:29-35`) skips the guard and calls `createTransaction`.
- **Impact is low.** The input still goes through full core validation and the ledger check, `source` is still `'manual'`, and the create action already allows the same thing. The real problem is that it breaks the "edit never creates" invariant and the claim that every non-UUID id gets `NOT_FOUND`.
- **Fix (one line):** in `handleUpdateTransaction` (`handlers.ts:133-134`), check `if (!isUuid(id)) return failForm(readTransactionForm(formData), 'NOT_FOUND');` before calling `submitTransaction`. Or pass an explicit `{ mode: 'edit', id }` instead of relying on whether `id` is undefined. Add a test that calls `handleUpdateTransaction(db, undefined as unknown as string, …)` and expects `NOT_FOUND` and that `createTransaction` was not called.
- **Rule tied:** AC2 (server-side re-validation) and R8 (tests for changed logic).

💭 **The rework added nothing else new.** No new sinks, redirects or error-leak paths. `failForm` echoes only the user's own form values. `null` reaches `isUuid` and returns `NOT_FOUND` correctly.

💭 S2 (no `error.tsx` boundary) and N7 (no length cap on form strings) are still follow-ups (R7), unchanged. R6 is suspended and not flagged, but it must be resolved before STK-018 goes live.

## Recommendations
1. Fix S3 in this ticket with the guard in `handleUpdateTransaction` plus the test. It is small and should-fix, not blocking.
2. Keep S2 and N7 on the follow-ups list.

## Risks
- Until R6 is restored, the ledger is open to anyone who can reach the app.

## Open questions
- None.

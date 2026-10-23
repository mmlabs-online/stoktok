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

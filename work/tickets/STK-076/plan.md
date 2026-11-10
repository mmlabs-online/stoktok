Status: READY

# Plan — STK-076: Settings "Khóa AI" card and key save/delete actions (STK-074 slice b)

## Spec summary
- docs/spec-v1.md §7, line 214 (updated by STK-074 / ADR 0009): "Secrets: Supabase keys only in the deploy repo's env handling, never in the app repo. LLM API keys may be entered on Settings and are stored in Supabase Vault (service_role only, decrypted only on the server); env keys in the deploy repo are the fallback (ADR 0009). Never in the app repo."
- CLAUDE.md Conventions: "Secrets: only in `.env.local` (git-ignored), the deploy repo, and — for AI provider keys entered on Settings — Supabase Vault (ADR 0009). Keys are never returned to the browser or logged."
- CLAUDE.md R3: "Service role key is server-only … The browser never talks to the DB directly." R6: "Every server route / server action verifies the Authen JWT (`requireUser()`)."
- ADR 0009 §7: "r3-guard … restricts `ai_key_set` / `ai_key_delete` to the ai-keys repo and its test (STK-076 extends the list)". §8: "Never `rpc(..., { get: true })` for `ai_key_set`." §3: "Precedence is UI key, then env key, then the provider is disabled."
- Ticket goal: "Let Ming paste, replace and delete the Anthropic and Google AI keys from a "Khóa AI" card on Settings, using the STK-074 Vault storage, without the key ever being sent back to the browser."

Already merged and reused unchanged (STK-074): `saveAiKey`, `deleteAiKey`, `listAiKeyMeta` (packages/db/src/repos/ai-keys.ts, re-exported by `apps/web/server/db.ts`), `validateAiKeyFormat` / `AiKeyFormatCode` / `AI_KEY_LENGTH` (packages/core/src/ai/keys.ts), `readAiEnv` (packages/ai/src/env.ts).

## Acceptance criteria → verification
| # | Criterion (ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | "Khóa AI" card outside the settings form, after the AI usage card; one row per provider with paste/save, replace, delete with inline confirm; after save only last 4 + saved date shown; full key never rendered, returned by any action, or sent to the browser again | `page.tsx` diff: `<AiKeysCard>` is a sibling between `<AiUsageCard>` and `<SettingsForm>` (not a child of the form). `ai-keys-card.test.tsx` › "renders one row per provider in AI_PROVIDERS order", "ui row shows last4 and date only", "no sentinel in HTML for any state/result". `server/ai-keys.test.ts` › "save result has exactly ok, provider, last4, savedAt", "no result JSON contains the sentinel". `pnpm check:service-key` green |
| 2 | Save/delete actions call `requireUser()` first, accept only the provider enum, validate via core format check, return only `{ ok, provider, last4, savedAt }` or an error code, log only `{event, provider, code}` | `apps/web/test/settings-ai-key-actions.test.ts` › "requireUser before getDb before handler (save, delete)", "requireUser rejection touches no db". Existing `apps/web/test/entrypoints.test.ts` stays green (it scans every `'use server'` export). `server/ai-keys.test.ts` › "unknown provider → AI_KEY_PROVIDER, no rpc", "format rejection codes, no rpc", "logged lines parse to exactly {event, provider, code}" |
| 3 | Row states: none (AI off), ui (last4 + date), env (presence only, no last4); password input autofill off and cleared after success and error | `packages/core/src/ai/key-rows.test.ts` › state matrix. `server/ai.test.ts` › "aiEnvPresence returns booleans only". `ai-keys-card.test.tsx` › "each state renders its text", "env row has no last4 and no Xóa", "input attributes", "input has no value after success and after error". Code review: `<form action={formAction}>` + uncontrolled input + explicit `formRef.current?.reset()` on every new action state |
| 4 | Tests: rendered HTML, every action result and captured console output never contain a sentinel; each row state renders; delete needs confirmation; format rejection | Tests listed below (sentinel in handler + card tests; console spies in handler tests; confirm-step test in card test; format codes in handler test) |
| 5 | `typecheck`, `lint`, `test`, `check:service-key` green | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:service-key` |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/ai/key-rows.ts` | **Create.** Types `AiKeyRowState`, `AiKeyRow`, `AiKeyErrorCode`, `AiKeyActionState`; `AI_PROVIDER_LABELS`; pure `aiKeyRows(meta, envPresent)`; `aiKeyMessage(code, op)`; `aiKeySuccessMessage(provider, op)` | Row-state derivation and fixed Vietnamese messages are testable logic, and the `'use client'` card must get its types from a non-server module (r3-guard `server\/ai` pattern blocks `import type … from '../../server/ai-keys'`) |
| `packages/core/src/ai/key-rows.test.ts` | **Create.** Unit tests | R8 |
| `packages/core/src/ai/index.ts` | **Modify.** Export the above | Public API |
| `apps/web/server/ai.ts` | **Modify.** Add `aiEnvPresence(env: AiEnv = readAiEnv()): Record<AiProvider, boolean>` | Only `server/ai.ts` may import `@stoktok/ai`; booleans only leave it (ticket carry-over "presence-only boolean") |
| `apps/web/server/ai.test.ts` | **Modify.** Add presence tests | R8 |
| `apps/web/server/ai-keys.ts` | **Create.** `import 'server-only'`; `readAiKeyRows`, `handleSaveAiKey`, `handleDeleteAiKey` | Server logic for the card, testable without Next.js (same pattern as `server/settings/handlers`) |
| `apps/web/server/ai-keys.test.ts` | **Create.** Handler tests with a fake `Db` | AC2–AC4 |
| `apps/web/app/(app)/settings/actions.ts` | **Modify.** Add `saveAiKeyAction`, `deleteAiKeyAction` | AC2 (R6) |
| `apps/web/test/settings-ai-key-actions.test.ts` | **Create.** Order/auth tests for the two actions | AC2 |
| `apps/web/app/(app)/settings/page.tsx` | **Modify.** Load rows via `readAiKeyRows(getDb())`, render `<AiKeysCard>` between `AiUsageCard` and `SettingsForm` | AC1 placement |
| `apps/web/components/settings/ai-keys-card.tsx` | **Create.** `'use client'` card: `AiKeysCard`, `AiKeyRowForm` (stateful), `AiKeyRowView` (pure, exported for tests) | AC1, AC3 |
| `apps/web/components/settings/ai-keys-card.test.tsx` | **Create.** `renderToStaticMarkup` tests | AC1, AC3, AC4 |
| `packages/db/src/r3-guard.test.ts` | **Modify.** Extend the `ai_key_set|ai_key_delete` allow-list; add new assertions (see Tests) | Ticket carry-over; ADR 0009 §7 |

No other file. Explicitly **not** in this ticket: the ADR 0009 step-2 wording fix (separate `/solo` after merge), any migration, any change to `packages/db` repo code, `.env.example`, `scripts/check-no-service-key-in-client.sh`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `packages/core/src/ai/key-rows.test.ts` › no meta, no env → both rows `state:'none'`, no `last4`/`savedOn` | AC3 none |
| › meta for anthropic only, no env → anthropic `ui` with `last4` and `savedOn: '10/11/2026'` (from `updatedAt: '2026-11-10T03:00:00Z'`), google `none` | AC3 ui |
| › `updatedAt` late UTC (`'2026-11-10T18:30:00Z'`) → `savedOn: '11/11/2026'` (Vietnam date) | date in VN time |
| › env only → `state:'env'`, no `last4`/`savedOn`, `envFallback: true` | AC3 env |
| › meta and env for the same provider → `ui` wins, `envFallback: true` | precedence (ADR §3) |
| › rows are in `AI_PROVIDERS` order with labels "Anthropic", "Google AI"; meta rows for unknown providers are ignored | shape |
| › `aiKeyMessage` returns a non-empty fixed string for every `AiKeyErrorCode` × `'save'|'delete'`; the `AI_KEY_LENGTH` message contains "20" and "256" | fixed messages |
| `apps/web/server/ai.test.ts` › `aiEnvPresence({ anthropicApiKey: SENTINEL })` → `{ anthropic: true, google: false }`; `JSON.stringify` of the result has no sentinel; `aiEnvPresence({})` → both false | presence-only |
| `apps/web/server/ai-keys.test.ts` › save: valid key → `rpc` called once as `('ai_key_set', { p_provider, p_key: SENTINEL })` with **no third argument** (no `{ get: true }`); result `Object.keys` sorted equals `['last4','ok','provider','savedAt']` | AC2 shape, ADR §8 |
| › save: format rejection — `''`, missing `key` field, `' '+SENTINEL`, `SENTINEL+'\n'`, 19 chars, 257 chars, `SENTINEL+'ã'` → `{ ok:false, provider:'google', code }` with `AI_KEY_EMPTY`/`AI_KEY_WHITESPACE`/`AI_KEY_LENGTH`/`AI_KEY_CHARSET`; `rpc` not called | format rejection, no trim |
| › save/delete: provider `'openai'`, missing, or a `File` → `{ ok:false, provider:null, code:'AI_KEY_PROVIDER' }`; `rpc` not called | provider enum |
| › save: rpc returns `{ error: { code:'XX000', message:'…'+SENTINEL, details:SENTINEL } }` → `{ ok:false, provider, code:'AI_KEY_DB_ERROR' }` | DB error mapping |
| › save: rpc **throws** `new Error('boom '+SENTINEL)` → `AI_KEY_DB_ERROR` | thrown errors |
| › delete: rpc data `true` → `{ ok:true, provider, deleted:true }`; `false` → `deleted:false`; rpc called as `('ai_key_delete', { p_provider })`; error → `AI_KEY_DB_ERROR` | delete |
| › sentinel sweep: `JSON.stringify` of every result above contains no sentinel; console spies (`log`,`info`,`warn`,`error`) across all cases capture no sentinel | AC4 no echo / no log leak |
| › every captured log line `JSON.parse`s to an object whose keys are exactly `['code','event','provider']` (events `ai_key_save_failed` / `ai_key_delete_failed`) | AC2 log shape |
| › `readAiKeyRows`: meta + presence → `{ ok:true, rows }` matching `aiKeyRows`; `from('ai_keys')` select fails → `{ ok:false }` and one log `{event:'ai_key_list_failed', code}`; presence loader throws → `{ ok:false }`; the db fake has no `rpc` calls (never decrypts) | soft-fail, no decrypt |
| `apps/web/test/settings-ai-key-actions.test.ts` › saveAiKeyAction: call order `['requireUser','getDb','handleSaveAiKey']`, `revalidatePath('/settings')` on ok, not on error, no `redirect` | AC2 R6 |
| › deleteAiKeyAction: same order; ok → `revalidatePath('/settings')` | AC2 R6 |
| › requireUser rejects → both actions reject; `getDb` and handlers not called | AC2 |
| `apps/web/components/settings/ai-keys-card.test.tsx` › `AiKeysCard` renders title "Khóa AI", the note, one row per provider in order, and is a `<section aria-labelledby>` with **no** `<form` wrapping the whole card (each row has its own form) | AC1 |
| › `read:{ok:false}` → "Không đọc được trạng thái khóa AI…" and no `<input`/`<button` | soft-fail UI |
| › none row: "Chưa có khóa — AI tắt", button "Lưu khóa", no "Xóa" | AC3 |
| › ui row: "••••" + last4 + "lưu ngày 10/11/2026", button "Thay khóa", button "Xóa" is `type="button"` | AC1/AC3 |
| › ui row with `envFallback` shows "được ưu tiên hơn khóa trên máy chủ" | AC3 |
| › env row: "Đang dùng khóa trên máy chủ" and "không xóa tại đây"; no "••••", no "Xóa" | AC3 env presence only |
| › password input: `type="password"`, `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-1p-ignore`, `data-lpignore="true"`, `data-bwignore`, a `<label for>` per provider, hidden `provider` input, no `value=` attribute on the key input | AC3 |
| › `AiKeyRowView` with a save **error** state and with a save **success** state: key input still has no `value=`; error shows `aiKeyMessage(code,'save')` in `role="alert"`; success shows "Đã lưu khóa Anthropic" in `role="status"` | AC3 cleared, fixed messages |
| › delete needs confirmation: `confirming:false` → no element with `data-testid="ai-key-delete-form-<provider>"` and no submit button labelled for delete; `confirming:true` → that form exists with hidden `provider`, a `type="submit"` "Xóa" (aria-label "Xác nhận xóa khóa Anthropic"), a `type="button"` "Hủy", and the warning ("AI dùng Anthropic sẽ tắt." without env fallback / "quay về khóa trên máy chủ" with it) | AC1/AC4 confirm |
| › sentinel sweep: rows built with `aiKeyRows([{ provider:'anthropic', last4: SENTINEL.slice(-4), updatedAt }], …)` and every save/delete state variant → HTML never contains `SENTINEL` | AC4 |
| `packages/db/src/r3-guard.test.ts` › `ai_key_set|ai_key_delete` allow-list = repo, repo test, `apps/web/server/ai-keys.ts`, `apps/web/server/ai-keys.test.ts` (rename the title, drop "(STK-076 extends this list)") | carry-over |
| › `apps/web/server/ai-keys.ts` starts with `import 'server-only';` | R3 |
| › `readAiKeySecrets|ai_key_secrets` absent from `apps/web/server/ai-keys.ts`, `apps/web/app/(app)/settings/actions.ts`, `apps/web/app/(app)/settings/page.tsx` and every file under `apps/web/components/settings/` | carry-over (documents the existing allow-list) |
| › `apps/web/components/settings/ai-keys-card.tsx` contains `'use client'` and no import path containing `server/` | client card takes plain props only |

## Approach
1. **Core `packages/core/src/ai/key-rows.ts`** (no I/O, no env names, no `service_role` text — it ships to the client bundle):
   - `export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: 'Anthropic', google: 'Google AI' }`.
   - `export type AiKeyRowState = 'ui' | 'env' | 'none'`.
   - `export interface AiKeyRow { provider: AiProvider; label: string; state: AiKeyRowState; last4?: string; savedOn?: string /* DD/MM/YYYY, Vietnam date */; envFallback: boolean }`.
   - `export function aiKeyRows(meta: readonly { provider: string; last4: string; updatedAt: string }[], envPresent: Record<AiProvider, boolean>): AiKeyRow[]` — iterate `AI_PROVIDERS`; meta row → `ui` with `last4`, `savedOn = formatDate(vnDateOf(new Date(updatedAt)))`; else `envPresent` → `env`; else `none`. `envFallback = envPresent[p]`. Structural input type, so core does not depend on `@stoktok/db`.
   - `export type AiKeyErrorCode = AiKeyFormatCode | 'AI_KEY_PROVIDER' | 'AI_KEY_DB_ERROR'`.
   - `export type AiKeyActionState = { ok: true; provider: AiProvider; last4: string; savedAt: string } | { ok: true; provider: AiProvider; deleted: boolean } | { ok: false; provider: AiProvider | null; code: AiKeyErrorCode }`.
   - `aiKeyMessage(code, op: 'save' | 'delete')` fixed strings, never interpolating input: EMPTY "Hãy dán khóa API."; WHITESPACE "Khóa có khoảng trắng hoặc xuống dòng. Hãy dán lại đúng khóa."; LENGTH `Khóa phải dài từ ${AI_KEY_LENGTH.min} đến ${AI_KEY_LENGTH.max} ký tự.`; CHARSET "Khóa chứa ký tự không hợp lệ. Hãy dán lại đúng khóa."; PROVIDER "Nhà cung cấp không hợp lệ."; DB_ERROR save "Không lưu được khóa. Thử lại." / delete "Không xóa được khóa. Thử lại."
   - `aiKeySuccessMessage(provider, op)` → "Đã lưu khóa Anthropic" / "Đã xóa khóa Anthropic".
   - Export all from `packages/core/src/ai/index.ts`.
2. **`apps/web/server/ai.ts`**: add `export function aiEnvPresence(env: AiEnv = readAiEnv()): Record<AiProvider, boolean> { return { anthropic: !!env.anthropicApiKey, google: !!env.googleAiApiKey }; }` (import type `AiEnv` from `@stoktok/ai`, `AiProvider` from `@stoktok/core`). The test passes an `AiEnv` object, so no env variable name appears in any test (r3-guard "AI key names" rule). Do not use `importOriginal<typeof import('@stoktok/ai')>` anywhere in apps/web (it would match the `@stoktok/ai` importer guard).
3. **`apps/web/server/ai-keys.ts`** (first line `import 'server-only';`; imports `saveAiKey`, `deleteAiKey`, `listAiKeyMeta`, `DataError`, type `Db` from `./db`; core helpers from `@stoktok/core`; never `readAiKeySecrets`):
   - `parseProvider(fd)`: `fd.get('provider')` must be a string in `AI_PROVIDERS`, else `null`.
   - `handleSaveAiKey(db, fd): Promise<AiKeyActionState>`: provider null → `AI_KEY_PROVIDER`. `const key = fd.get('key')`; `typeof key === 'string' ? key : ''` (no trim). `validateAiKeyFormat(key)` here (the repo would only throw a generic VALIDATION) → on failure return its code. Then `try { const m = await saveAiKey(db, provider, key); return { ok: true, provider, last4: m.last4, savedAt: m.updatedAt }; } catch (e) { log('ai_key_save_failed', provider, e); return { ok:false, provider, code:'AI_KEY_DB_ERROR' }; }`. Build the success object field by field (never spread repo output).
   - `handleDeleteAiKey(db, fd)`: provider check, `deleteAiKey`, return `{ ok: true, provider, deleted }`; catch → log `ai_key_delete_failed`, `AI_KEY_DB_ERROR`.
   - `log(event, provider, e)`: `console.warn(JSON.stringify({ event, provider, code: e instanceof DataError ? e.code : 'unknown' }))`. Never log `e`, its message, or the form data.
   - `readAiKeyRows(db, loadPresence = async () => (await import('./ai')).aiEnvPresence()): Promise<{ ok: true; rows: AiKeyRow[] } | { ok: false }>` — inside one try: `aiKeyRows(await listAiKeyMeta(db), await loadPresence())`; catch → log `{event:'ai_key_list_failed', code}` (DataError code or `'read_failed'`), `{ ok:false }`. Dynamic import mirrors `readAiBudget`'s soft-fail and keeps the page from importing `server/ai` directly. A list failure is **not** shown as "none" (consult rec. 5).
   - Note for the implementer: the log event `ai_key_delete_failed` contains the substring `ai_key_delete`, which is why this file joins the write-wrapper allow-list. Keep those strings out of the actions file, page, card and their tests.
4. **Actions** in `apps/web/app/(app)/settings/actions.ts`:
   ```ts
   export async function saveAiKeyAction(_prev: AiKeyActionState | null, formData: FormData): Promise<AiKeyActionState> {
     await requireUser();
     const state = await handleSaveAiKey(getDb(), formData);
     if (state.ok) revalidatePath('/settings');
     return state;
   }
   ```
   `deleteAiKeyAction` identical with `handleDeleteAiKey`. No redirect (the `?saved=1` flow belongs to the settings form). No logging in the actions.
5. **Page**: after `readAiBudget()`, `const keys = await readAiKeyRows(getDb());` and render `<AiKeysCard read={keys} saveAction={saveAiKeyAction} deleteAction={deleteAiKeyAction} />` between `<AiUsageCard>` and `<SettingsForm>`. Page still starts with `await requireUser()`.
6. **Card `apps/web/components/settings/ai-keys-card.tsx`** (`'use client'`; imports only `@stoktok/core` values/types, `react`, `lucide-react`, `../transactions/form-fields` class helpers; no path containing `server/`, also not in comments):
   - `AiKeysCard({ read, saveAction, deleteAction })` where `read: { ok: true; rows: AiKeyRow[] } | { ok: false }` and `AiKeyAction = (prev: AiKeyActionState | null, fd: FormData) => Promise<AiKeyActionState>`. `<section aria-labelledby="ai-keys-title" className="bg-surface border-border space-y-4 rounded-lg border p-4 max-w-2xl">`, `<h2>` "Khóa AI", note "Khóa được mã hóa trên máy chủ và không bao giờ hiển thị lại. Khóa lưu ở đây được ưu tiên hơn khóa trên máy chủ.", then `<ul>` of `AiKeyRowForm`, or the read-failure line (`role="status"`, AlertTriangle) with no controls.
   - `AiKeyRowForm({ row, saveAction, deleteAction })`: `const [saveState, saveFormAction, savePending] = useActionState(saveAction, null)`; same for delete; `const [confirming, setConfirming] = useState(false)`; `formRef`; `useEffect(() => { formRef.current?.reset(); }, [saveState])` (explicit clear on success **and** error, in addition to React's `<form action>` reset); after a delete result, `setConfirming(false)` via the delete form's action wrapper or the same effect pattern. Renders `AiKeyRowView`.
   - `AiKeyRowView` (exported, pure; props: `row`, `saveState`, `deleteState`, `confirming`, `savePending`, `deletePending`, `formRef?`, `onSaveAction`, `onDeleteAction`, `onAskDelete`, `onCancelDelete`):
     - Status line with icon + text (not colour only): none → Ban + "Chưa có khóa — AI tắt"; ui → Check + "Đã lưu — kết thúc bằng <span aria-hidden>••••</span>{last4} · lưu ngày {savedOn}" (+ "Khóa này được ưu tiên hơn khóa trên máy chủ." if `envFallback`); env → Check + "Đang dùng khóa trên máy chủ" + "Khóa từ biến môi trường máy chủ, không xóa tại đây".
     - Save form `<form ref action={onSaveAction}>`: hidden `provider`; `<label htmlFor="ai-key-<provider>">Khóa API {label}</label>`; `<input id name="key" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" data-bwignore="" data-form-type="other" placeholder="Dán khóa API" aria-invalid aria-describedby />` — uncontrolled, no `value`/`defaultValue`; submit button `min-h-11` "Thay khóa" if `state==='ui'` else "Lưu khóa", disabled + "Đang lưu…" + `aria-busy` while pending. Replace needs no confirm.
     - Delete (ui rows only): when not confirming, a `type="button"` "Xóa" with `aria-label="Xóa khóa {label}"` calling `onAskDelete`. When confirming, `<form action={onDeleteAction} data-testid="ai-key-delete-form-<provider>">` with hidden `provider`, text "Xóa khóa {label}?" + warning (`envFallback` ? "AI sẽ quay về khóa trên máy chủ." : "AI dùng {label} sẽ tắt."), `type="submit"` "Xóa" (`aria-label="Xác nhận xóa khóa {label}"`, autoFocus) and `type="button"` "Hủy".
     - Messages: error → `<p role="alert" className="text-price-down text-sm">{aiKeyMessage(code, op)}</p>`; success → `<p role="status">{aiKeySuccessMessage(provider, op)}</p>`. Display of last4/date comes **only** from `row` props (refreshed by `revalidatePath`), never from the action result.
7. **r3-guard** edits as listed in Tests.
8. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm check:service-key`.
9. Optional (not required for PASS): a rendered check with Chromium/Playwright of a scratch harness page is **not** needed; the static tests plus code review cover the ACs. If the implementer wants one, it must live in the scratchpad, not in the repo.

Rules:
- **R1:** no calculation in the card; row state and date label come from core `aiKeyRows`, messages from core.
- **R3:** the key travels only browser → POST body → server action → repo → `ai_key_set` (POST rpc). No decrypt path is reachable from the page, actions or card (guard assertions). Card receives only `AiKeyRow` (last4, date, state, booleans). Env values never leave `server/ai.ts` (booleans only).
- **R6:** both actions `await requireUser()` before `getDb()`; covered by the new test and the existing `entrypoints.test.ts`.
- **R7:** no ADR wording fix, no repo/migration change, no "test key" button.
- **R8:** tests above; core change has unit tests.
- R2, R4, R5, R9, R10: not affected.

## Specialist input used
- **consult-data-visualization-engineer (STK-076 delta):**
  - Adopted: one server module `server/ai-keys.ts` with `server-only` and db-as-parameter handlers; actions in the existing `settings/actions.ts` with `requireUser()` → `getDb()` → handler and `revalidatePath('/settings')`, no redirect; env presence as booleans only via `server/ai.ts` (open question 1 → in `server/ai.ts`); discriminated action state with a separate delete variant; provider parsed via `AI_PROVIDERS.includes`; key read without trim; logs only `{event, provider, code}` and never `e`; one `useActionState` per row; soft-fail list read shown as "không đọc được", not "none"; display from props, result only for the transient message; env row explains it cannot be deleted here; replace needs no confirm (open question 2); r3-guard allow-list extension and the two extra assertions; the listed tests.
  - Adapted: shared types and the row derivation live in **core** (`key-rows.ts`) instead of `server/ai-keys.ts`, because the `'use client'` guard regex `server\/ai` would reject a type import from `server/ai-keys` in the card. `readAiKeyRows` loads env presence through a dynamic `import('./ai')` inside its soft-fail, so the page imports only `server/ai-keys`. Delete success is `{ ok, provider, deleted }` (boolean), not `deleted: true`. DataError `VALIDATION` from the repo maps to `AI_KEY_DB_ERROR` (core already validated; the specific format code is returned before any DB call).
- **consult-data-visualization-engineer (STK-074 base):**
  - Adopted: placement outside `SettingsForm` after `AiUsageCard`; per-row `<form>`; password-manager ignore attributes; uncontrolled input cleared on success and error; no `values` echo; inline two-step delete with provider name in `aria-label` and a warning about AI turning off; `role="status"`/`role="alert"` per row; `min-h-11`; icon + text states; env state shows no last4.
  - Changed: `autoComplete="off"` (ticket AC3 wording) instead of `"new-password"`, which can trigger browser "suggest strong password" and fill a generated value. Input is always visible (button label "Thay khóa" for a saved key) instead of a "Thay khóa" toggle that reveals it — less state, same function. Spelling "Khóa" per ticket carry-over.
  - Rejected: `trim()` before validation (ADR 0009 §6: no trimming); "test key" button (out of scope).

## Assumptions
(Defaults for Ming to confirm; none blocks.)
1. `autoComplete="off"` plus password-manager ignore attributes is the "autofill off" requirement; browsers may still offer to save the password — acceptable.
2. Delete success returns `{ ok: true, provider, deleted: boolean }`; the ticket's `{ ok, provider, last4, savedAt }` is the save result.
3. After a validation error the user re-pastes (the input is cleared on error by design).
4. The "saved date" is the Vietnam calendar date `DD/MM/YYYY` of `ai_keys.updated_at` (no time).
5. Cloudflare Tunnel / host do not log request bodies (ops note from the consult; no code change).
6. Card copy (Vietnamese strings in Approach step 6) is a default; Ming can adjust wording later without code-structure changes.

## Blocking questions
None.

## Split proposal
None. This is already slice (b) of STK-074. Estimated ~380 lines of production code plus ~450 lines of tests; one feature, one cycle.

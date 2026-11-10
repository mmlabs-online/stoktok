# STK-076 consult — data-visualization-engineer (delta on work/tickets/STK-074/consult-data-visualization-engineer.md)

**Findings (new or changed versus the STK-074 consult)**

1. The data per provider is already available from the merged code. `listAiKeyMeta(db)` returns `{provider, last4, updatedAt}` and never decrypts. `resolveAiKeys(stored, readAiEnv())` returns `source: Record<provider, 'ui'|'env'|'none'>`, but it needs the decrypted `stored` map, so the page must not use it. Instead compute env presence as `const env = readAiEnv(); envPresent = { anthropic: !!env.anthropicApiKey, google: !!env.googleAiApiKey }`. `readAiEnv` is exported from `@stoktok/ai` and already trims and blanks. The r3-guard "AI key names" rule is satisfied because only `env.ts` names the variables. Only the booleans leave the server module.
2. Row state per provider (UI wins over env, same as the resolver):
   - Meta row present: "ui", showing last4 and date (`updatedAt`).
   - No meta row and `envPresent`: "env", showing presence only.
   - Neither: "none" (AI off).
   - If the user saves a UI key while an env key exists, the state is "ui" and the card can add "ghi đè khóa máy chủ". If they then delete it, the row falls back to "env", so the post-delete state must come from re-reading, not from assuming "none".
3. Constraint from the r3-guard: `apps/web/server/db.ts` is the only `apps/web` file allowed to import `@stoktok/db`. It re-exports everything from the db package, so `saveAiKey`, `deleteAiKey` and `listAiKeyMeta` come from `./db`. Only `apps/web/server/ai.ts` may import `@stoktok/ai`, so `readAiEnv` must also be reached through `server/ai.ts`.
4. The guard's `server\/ai` pattern in the 'use client' test matches any path that contains `server/ai`. `server/ai-keys.ts` would match too, which is fine because client components must not import it. The card component must take plain props, with no server imports.

**Recommendations**

1. Add one server module, `apps/web/server/ai-keys.ts`, starting with `import 'server-only';`. It follows the existing `settings/handlers` pattern, where handlers take `db` as a parameter so tests need no Next.js runtime. It contains:
   - `readAiKeyRows(db, envPresent)`, returning `AiKeyRow[]`.
   - `handleSaveAiKey(db, provider, key)`.
   - `handleDeleteAiKey(db, provider)`.
   - A thin helper `readAiEnvPresence()` placed in `server/ai.ts` (it imports `readAiEnv` from `@stoktok/ai`). Exporting only booleans from there is the smallest r3-guard change: no change is needed for the key-name rule.
2. Place the `'use server'` actions `saveAiKeyAction` and `deleteAiKeyAction` in the existing `apps/web/app/(app)/settings/actions.ts`. Each calls `requireUser()` first, then `getDb()`, then the handler (as the file header comment requires). They call `revalidatePath('/settings')` on success and do not redirect, because the `?saved=1` flow belongs to the settings form. A redirect would also drop the row state.
3. Update the r3-guard test: extend the write-wrapper allow-list (`ai_key_set|ai_key_delete`) with `apps/web/server/ai-keys.ts` and `apps/web/server/ai-keys.test.ts`. Do not add the actions file, the page or the card to it. They call only `saveAiKey`, `deleteAiKey` and `listAiKeyMeta` through the handlers, and those function names are not matched by the guard. Add two new guard tests:
   - `readAiKeySecrets|ai_key_secrets` stays out of `server/ai-keys.ts`, the actions file, the page and `components/settings/*`. This is already enforced by the existing allow-list, but an explicit assertion documents it.
   - `ai-keys.ts` starts with `import 'server-only'`.
4. Action state shape (discriminated, no value echo):
   ```
   type AiKeyActionState =
     | { ok: true; provider: AiProvider; last4: string; savedAt: string }  // save
     | { ok: true; provider: AiProvider; deleted: true }                   // delete
     | { ok: false; provider: AiProvider | null; code: AiKeyFormatCode | 'AI_KEY_PROVIDER' | 'AI_KEY_DB_ERROR' }
   ```
   - The ticket's `{ ok, provider, last4, savedAt }` is the save result; the delete result is a distinct variant.
   - Map the DataError `VALIDATION` to the format code and `DB_ERROR` to `AI_KEY_DB_ERROR`.
   - The component maps codes to fixed Vietnamese strings, so no server text is ever shown.
   - Parse the provider from `FormData` via `AI_PROVIDERS.includes`, so an unknown value gives `AI_KEY_PROVIDER` with `provider: null`.
   - Read the key with `formData.get('key')` and require a string. Do not trim: `validateAiKeyFormat` rejects trailing whitespace.
   - Wrap in try/catch and log only `JSON.stringify({event:'ai_key_save_failed'|'ai_key_delete_failed', provider, code})`. Never log `e`, because `DataError` carries only the fixed text plus the pg code but the habit is risky.
   - Use one `useActionState` per row. This clears the input on both success and error, via a key remount or a ref reset in the form action wrapper. Use `autoComplete="off"`, `type="password"`, and `name` values that password managers don't treat as credentials (`data-1p-ignore`, `data-lpignore`).
5. The page loads rows with soft-fail, like `readAiBudget`. If `listAiKeyMeta` throws, render the card as "không đọc được" with no row actions, and log the code only. Do not treat this as "none", because the UI would invite a save that could look like it overwrote nothing.
6. Card props are `rows: { provider; state: 'ui'|'env'|'none'; last4?: string; savedAt?: string }[]` and nothing else. The component is a client component (confirm state, `useActionState`) that imports only `@stoktok/core` types. The date is formatted from the ISO `savedAt` through the existing date formatting helper, with no calculation in the UI (R1).

**Tests**

- `server/ai-keys.test.ts`, with a fake `Db` and a sentinel key `SENTINEL_KEY_...` (≥20 chars):
  - save returns exactly the keys `ok, provider, last4, savedAt` (and the delete result has no extra keys);
  - `JSON.stringify` of every result, including error results, never contains the sentinel;
  - a console spy (log, warn, error) never captures the sentinel across success, format rejection and a DB error whose message contains the sentinel;
  - format rejection for empty, whitespace, short, long and non-ASCII input returns the right code without calling `rpc`;
  - an unknown provider returns `AI_KEY_PROVIDER` without calling `rpc`;
  - the rpc is called with the key as a parameter and without `{get:true}`.
- Row derivation (`readAiKeyRows`): the ui/env/none matrix, ui wins over env, and env presence appears only as a boolean, which can be checked by setting the env key to a sentinel and asserting the rows contain no env value.
- Actions test: `requireUser` is called before `getDb`, in both actions. If `requireUser` rejects, the db is never touched.
- Card component test:
  - `renderToStaticMarkup` for each of the three row states, with the sentinel absent from the HTML;
  - the delete button first shows a confirm step and the action fires only on confirm;
  - the password input has `autoComplete="off"`;
  - the error code maps to a fixed Vietnamese string.
- r3-guard: the allow-list extension and the new assertions above.
- Final checks: `typecheck`, `lint`, `test`, `check:service-key`.

**Risks**

- A `useActionState` result is serialized into the RSC payload and the form action; the key sent in the form submission goes over POST body only. Next.js dev server logging of action arguments is not a concern for form posts, but verify that the host/Cloudflare layer does not log request bodies (an ops note, not a code change).
- After a successful save, `revalidatePath` refreshes the page props. If the component keeps the old `last4` in local state instead of using the new props, the card can drift. Source the display from the props and use the action result only for the transient confirmation.
- Deleting the last UI key while no env key exists turns AI off, and `getAi()` reads on every call, so the effect is immediate. The confirm text should say so.
- Env row ("máy chủ") has no delete affordance. A user could think delete does nothing; show text "Khóa từ biến môi trường máy chủ, không xóa tại đây".

**Open questions**

1. Should the env-presence helper live in `server/ai.ts` (my recommendation: one new export) or in `server/ai-keys.ts` importing `readAiEnv` through `./ai`? Both are guard-compliant; the first avoids a second importer of the `server/ai` module graph. Planner to decide.
2. Should the replace flow require the delete-style confirm? I recommend no: replace is a normal save, and only delete needs a confirm.

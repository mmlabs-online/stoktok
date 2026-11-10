## Attempt 1 — 2026-11-10
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0 — core 793, ai 184, db 192 (+1 todo), sources 35, worker 295, web 349 (44 files) passed. Matches impl-log.md.
- check:service-key: exit 0, "OK: no secret or AI SDK material in client bundle" (0 hits for env key names, SDKs, provider hosts in `.next/static`).
- Rendered check (scratchpad only, not in repo): bundled the real `AiKeysCard` with esbuild + the built app CSS, drove it in Chromium (deviceScaleFactor 1) with fake actions. States none/env/ui/read-failure render with correct Vietnamese labels; after an error save and a success save (submitting the sentinel) both key inputs have `value === ""` and the sentinel is absent from the DOM; "Xóa" opens the inline confirm with focus on "Xác nhận xóa khóa Anthropic"; "Hủy" closes it; confirming closes it and shows "Đã xóa khóa Anthropic". No page/console errors. Layout fine at 760px.

### Acceptance criteria
- [x] AC1 card outside the form after the AI usage card, per-provider rows, save/replace/delete with inline confirm, only last4 + date shown — evidence: `apps/web/app/(app)/settings/page.tsx:24-26` (sibling between `AiUsageCard` and `SettingsForm`); `ai-keys-card.test.tsx` › "title, note, one row per provider…", "ui row shows last4 and date…", "delete needs confirmation", "the sentinel never appears in HTML"; save success built field by field (`server/ai-keys.ts:586`); display comes only from `row` props.
- [x] AC2 actions `requireUser()` first, provider enum, core format check, result shape, log shape — evidence: `settings/actions.ts:24-36`; `settings-ai-key-actions.test.ts` (order `requireUser→getDb→handler`, rejection touches nothing); `entrypoints.test.ts` green; `ai-keys.test.ts` › format rejection ×7, provider openai/missing/File, "result has exactly four keys", "logs are exactly {event, provider, code}" (3 lines, no sentinel). `log()` never logs `e`/message/form data (`server/ai-keys.ts:573-575`).
- [x] AC3 row states none/ui/env (env presence only), autofill off, input cleared after success and error — evidence: `key-rows.test.ts` state matrix incl. VN date and ui-over-env precedence; `ai.test.ts` › "aiEnvPresence returns booleans only"; card tests "env row: presence only", "password input attributes", "input has no value after error and success"; Chromium run confirms runtime clearing (`useEffect` reset on `[saveState]` + React form reset).
- [x] AC4 sentinel never in HTML/results/console; each state renders; delete needs confirm; format rejection — evidence: tests listed above.
- [x] AC5 typecheck, lint, test, check:service-key green — see Checks.

### Issues
None.

### Documented deviation
- Delete-confirm reset happens inside the wrapped `useActionState` delete action (`ai-keys-card.tsx:240-244`) instead of an effect, because `react-hooks/set-state-in-effect` forbids setState in effects. Accepted: verified in Chromium that the confirm closes after the result, on success and (by construction) on error, and the error message still shows via `Result` outside the confirm form.

### Scope
Every changed code file is in the plan's file list; `work/backlog.md` / `ticket.md` are workflow bookkeeping. No out-of-plan files.

### r3-guard
`packages/db/src/r3-guard.test.ts:118-149`: allow-list extended to exactly the 4 planned files; new assertions for `server-only` first line, no `readAiKeySecrets|ai_key_secrets` in ai-keys/actions/page/components/settings (with a `>= 5` targets sanity check), and the card being `'use client'` with no `server/` import. All pass.

### Rules R1–R10
No violations found. R1: row state/date/messages from core. R2/R4/R5/R9/R10 not affected. R3: key travels browser → action → repo → `ai_key_set` only; no decrypt path from page/actions/card (guarded); env values leave `server/ai.ts` as booleans only. R6: both actions `await requireUser()` before `getDb()`. R8: core `key-rows.ts` has unit tests.

### Nits (do not block)
- `ai-keys-card.tsx:395` shows "Đã xóa khóa …" even when `deleted: false` (nothing was there to delete); harmless, could say nothing changed.
- A stale save success message stays visible next to a later delete message in the same row (both `Result`s render); consider clearing the other op's message.
- Card test "delete needs confirmation" checks "Hủy" text but not that it is `type="button"` (plan listed it); runtime check confirmed it.
- `page.tsx` calls `getDb()` twice; fine, purely cosmetic.

### Follow-ups (out of scope)
- ADR 0009 step-2 wording fix (already planned as a separate /solo).
- Optional "test key" button (explicitly excluded by the plan).

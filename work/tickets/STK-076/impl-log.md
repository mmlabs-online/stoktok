## Attempt 1 — 2026-11-10

### Files touched
| File | Required because |
|---|---|
| packages/core/src/ai/key-rows.ts (new) | Row-state derivation, action-state types and fixed Vietnamese messages (plan step 1) |
| packages/core/src/ai/key-rows.test.ts (new) | R8 unit tests |
| packages/core/src/ai/index.ts | Export the new API |
| apps/web/server/ai.ts | `aiEnvPresence` (booleans only) |
| apps/web/server/ai.test.ts | Presence test |
| apps/web/server/ai-keys.ts (new) | `handleSaveAiKey`, `handleDeleteAiKey`, `readAiKeyRows` |
| apps/web/server/ai-keys.test.ts (new) | Handler tests, sentinel and log-shape checks |
| apps/web/app/(app)/settings/actions.ts | `saveAiKeyAction`, `deleteAiKeyAction` (requireUser first) |
| apps/web/test/settings-ai-key-actions.test.ts (new) | Call order / auth tests |
| apps/web/app/(app)/settings/page.tsx | Load rows, render `AiKeysCard` between usage card and form |
| apps/web/components/settings/ai-keys-card.tsx (new) | The card, per-row forms, inline delete confirm |
| apps/web/components/settings/ai-keys-card.test.tsx (new) | Rendered-HTML tests |
| packages/db/src/r3-guard.test.ts | Extended write-wrapper allow-list plus three new assertions |

### Tests added / changed
- key-rows.test.ts: states (none/ui/env), VN date, precedence, order/labels, messages
- ai.test.ts › aiEnvPresence returns booleans only
- ai-keys.test.ts: save shape and no `{get:true}`, format rejections, provider enum, db error/throw, delete, sentinel sweep, log shape, readAiKeyRows
- settings-ai-key-actions.test.ts: order, revalidate, auth rejection
- ai-keys-card.test.tsx: card shape, soft-fail, row states, input attributes, cleared input, delete confirm, sentinel sweep
- r3-guard.test.ts: allow-list, server-only first line, no decrypt entry points in settings files, card is client-only without server imports

### Checks (actual output summary)
- typecheck: all workspaces pass
- lint: all workspaces pass
- test: core 793, ai 184, db 192 (+1 todo), sources 35, worker 295, web 349 passed; no failures
- check:service-key: OK, no secret or AI SDK material in client bundle

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- ADR 0009 step-2 wording fix (already planned as a separate /solo).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: 6 modified files +67 / -4, plus 7 new files. Not committed (per orchestrator).
- Deviation: delete-confirm state is reset inside the wrapped delete action instead of an effect (lint rule react-hooks/set-state-in-effect forbids setState in an effect).

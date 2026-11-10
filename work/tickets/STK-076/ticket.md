# STK-076: Settings "Khóa AI" card and key save/delete actions (STK-074 slice b)

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P2 |
| Areas | security, ui |
| Attempts | 0 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Let Ming paste, replace and delete the Anthropic and Google AI keys from a "Khóa AI" card on Settings, using the STK-074 Vault storage, without the key ever being sent back to the browser. Split from STK-074 (see work/tickets/STK-074/plan.md "Split proposal"); UI design in work/tickets/STK-074/consult-data-visualization-engineer.md.

## Spec reference
docs/spec-v1.md §7 (as updated by STK-074 / ADR 0009). CLAUDE.md R3, R6. Depends on STK-074.

## Acceptance criteria
- [ ] Settings has a "Khóa AI" card (outside the settings form, after the AI usage card) with one row per provider: paste and save, replace, delete with an inline confirm. After saving only the last 4 characters and the saved date are shown; the full key is never rendered, returned by any server action, or sent to the browser again.
- [ ] The save/delete server actions call `requireUser()` first (R6), accept only the provider enum, validate the key with the STK-074 core format check, return only `{ ok, provider, last4, savedAt }` or an error code (no value echo), and log only `{event, provider, code}`.
- [ ] Rows show the state: no key (AI off), saved via UI (last4 + date), or using the server env key (presence only, no last4). The password input has autofill off and is cleared after both success and error.
- [ ] Tests: the rendered HTML, every action result and captured console output never contain a sentinel key; each row state renders; delete needs confirmation; format rejection.
- [ ] `typecheck`, `lint`, `test` and `check:service-key` green.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-074 per its plan.md (proposed there as "STK-075"; that ID was already taken by the font ticket).
- 2026-11-10 (orchestrator): carry-overs from the STK-074 reviews:
  - Extend the r3-guard allow-list for `ai_key_set` / `ai_key_delete` (today: the ai-keys repo and its test only) to the new server module(s) that save/delete keys; the Settings page and actions must use only `saveAiKey` / `deleteAiKey` / `listAiKeyMeta`, never `readAiKeySecrets`.
  - Never call `rpc(..., { get: true })` for key writes (the key would go into the URL).
  - Validate with core `validateAiKeyFormat` (20–256 printable ASCII, no trimming); show fixed-string Vietnamese errors, never the input.
  - The "using the server env key" state needs a presence-only boolean from the server (no env value, no last4).
  - UI spelling "Khóa" (consistent with "Xóa", "Hủy"); design in work/tickets/STK-074/consult-data-visualization-engineer.md.

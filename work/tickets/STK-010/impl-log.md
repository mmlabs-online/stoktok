# Implementation log — STK-010

## Attempt 1 — 2026-10-25

Built in the plan's order: Slice A (core, db, wiring, scan), then Slice B (web handler, action, page, form). Nothing committed or pushed.

### Files touched
| File | Required because |
|---|---|
| packages/core/src/settings/market-rules.ts (new) | Market rules and exchanges defined once; parse and merge of rule_configs (AC4, AC5) |
| packages/core/src/settings/validate-settings.ts (new) | Core validation, form-string conversion, bounds, treatments (AC2, AC3) |
| packages/core/src/settings/market-rules.test.ts (new) | AC4, AC5 |
| packages/core/src/settings/validate-settings.test.ts (new) | AC2, AC3 |
| packages/core/src/entry/parse-input.ts / .test.ts | `parseRatePercentInput`, `formatRatePercentInput` (BigInt, no floats) |
| packages/core/src/entry/rules.ts | `DEFAULT_TRADING_RULES` derives from `DEFAULT_MARKET_RULES` |
| packages/core/src/entry/messages-vi.ts / .test.ts | New codes; OVERSELL_SELF uses `settlementDays` |
| packages/core/src/entry/check-ledger-change.ts / .test.ts | OVERSELL params carry `settlementDays`; exact-params assertion updated |
| packages/core/src/db/rows.ts | `SettingsFullRow` |
| packages/core/src/db/mappers.ts / .test.ts | `appSettingsFromRow`, `settingsInputToRow` |
| packages/core/src/index.ts | Public exports |
| packages/db/src/repos/settings.ts / .test.ts | `getAppSettings`, `getMarketRules`, `saveAppSettings` |
| packages/db/src/index.ts | Exports |
| apps/web/server/settings/handlers.ts / .test.ts (new) | Settings save handler |
| apps/web/app/(app)/settings/actions.ts (new) | Server action, no auth (R6 suspended) |
| apps/web/app/(app)/settings/page.tsx | Replaces the EmptyState with the form; `force-dynamic` like the other data pages |
| apps/web/components/settings/settings-form.tsx (new) | Form UI, display only |
| apps/web/components/settings/settings.test.tsx (new) | AC1, AC3 |
| apps/web/server/transactions/handlers.ts / .test.ts | Lot size read from stored rules (`getMarketRules`) |
| apps/web/app/(app)/transactions/[id]/edit/page.tsx | Same, for the odd-lot pre-tick |
| apps/web/test/no-hardcoded-rules.test.ts (new) | R5 source scan with self-check, empty allowlist |

### Tests added / changed
- All tests listed in the plan were added in the files above.
- Extra: scan test asserts it covers more than 20 files (not vacuous).

### Checks (actual output summary)
- pnpm install: done
- typecheck: pass (core, db, web, worker)
- lint: pass
- test: core 21 files / 230 tests; db 10 files / 65 passed + 1 todo; worker 4 files / 26 tests; web 15 files / 118 tests. All pass.
- build: pass
- check:service-key: OK, 0 hits

### Out-of-plan files
- None. The form uses a local `ValueField` instead of changing `form-fields.tsx` (it lacked `decimal` inputMode and `placeholder`).

### Follow-ups (noticed, not done)
- Plan follow-ups F1 to F5 stand as written (withholding and holidays UI, price-limit consumers, atomic rule_configs merge, cutoff and sanity settings, per-exchange lot size).
- The form has no visual check at 375px; only static-markup tests ran.

### Scope self-check
- Could the diff be smaller? No: the diff matches the plan's file list.
- Diff size: modified files +/- see `git diff --shortstat`; new files are the settings modules, handler, form and tests.

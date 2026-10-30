## Attempt 1 — 2026-10-30

### Files touched
| File | Required because |
|---|---|
| packages/core/src/settings/read-fields.ts (new) | Shared readers moved from validate-settings.ts, unchanged |
| packages/core/src/settings/signal-rules-form.ts (new) | Raw type, sections/labels, validation, form values, merge |
| packages/core/src/settings/signal-rules-form.test.ts (new) | Unit tests (R8) |
| packages/core/src/settings/validate-settings.ts | SettingsFormRaw/SettingsInput/AppSettings extended; one validation pass |
| packages/core/src/settings/validate-settings.test.ts | Fixtures and new cases |
| packages/core/src/settings/market-rules.test.ts | "preserves signals" case |
| packages/core/src/entry/messages-vi.ts | Two new cross-field codes |
| packages/core/src/db/mappers.ts, mappers.test.ts | signalRules read/write in one row |
| packages/core/src/index.ts | Exports |
| apps/web/server/settings/handlers.ts, handlers.test.ts | Read the 18 keys; tests |
| apps/web/components/settings/settings-form.tsx, settings.test.tsx | New card; tests |
| packages/db/src/repos/settings.test.ts | Fixture + save → getSignalRules round trip |
| apps/worker/src/jobs/medium-signals.test.ts | Wiring test |

### Tests added / changed
- signal-rules-form.test.ts (all cases in plan), validate-settings.test.ts (errors together, form defaults), market-rules.test.ts › preserves signals, mappers.test.ts (2 new), handlers.test.ts (toggle off, invalid signal field), settings.test.tsx (3 new), db settings.test.ts round trip, medium-signals.test.ts wiring.

### Checks (actual output summary)
- typecheck: green (core, db, web, worker)
- lint: green
- test: core 408, db 107 (+1 todo), worker 94, web 181 passed

### Out-of-plan files
None. Deviation: `SignalRuleSection` uses `rows: SignalRuleFieldSpec[][]` instead of `pairWithNext`, so the component needs no pairing logic. No change needed in packages/db/src/repos/settings.ts.

### Follow-ups (noticed, not done)
- FormBanner summary / focus first invalid field for off-screen signal errors (A9).
- Dynamic P/E EPS-basis badge (A2).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +600 / -40 lines (majority tests), not committed.

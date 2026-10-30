## Attempt 1 — 2026-10-30
Verdict: PASS

### Checks (run by reviewer)
- typecheck: green (core, db, web incl. `next typegen`, worker)
- lint: green (all 4 packages)
- test: core 35 files / 408 passed; db 14 files / 107 passed + 1 todo; worker 8 files / 94 passed; web 20 files / 181 passed. These match impl-log.md.

### Acceptance criteria
- [x] A card shows every medium parameter, with defaults when unset and Vietnamese labels and units. Evidence: `settings.test.tsx › signal rules card renders every field, label and default` (14 inputs + 4 checked toggles = 18 leaves, card title present). `validate-settings.test.ts › settingsToFormValues` (null row gives all 18 default strings). `mappers.test.ts › null row gives DEFAULT_SIGNAL_RULES…`. Labels and units are in `signal-rules-form.ts` (`SIGNAL_RULE_SECTIONS`).
- [x] Validation reuses the STK-015 bounds; invalid values get Vietnamese errors and nothing is written. Evidence: `signal-rules-form.ts:764-777` reads only `SIGNAL_RULE_BOUNDS`. `signal-rules-form.test.ts › bounds come from SIGNAL_RULE_BOUNDS (inclusive)`, `parse failures…`, both cross-field cases, and `accepts exactly what parseSignalRules keeps`. I also checked by hand that the validator's bounds and cross-field rules match `parseSignalRules` in `signals/config.ts`. `handlers.test.ts › invalid signal field returns Vietnamese error and does not save` checks that `saveAppSettings` is not called.
- [x] Saving merges `signals` without touching `market` (and vice versa), in one save. Evidence: `mappers.ts:231-234` composes `mergeSignalRules(mergeRuleConfigs(...))` into one row. Tests: `mergeSignalRules › keeps market, other horizons and unknown keys`, `market-rules.test.ts › preserves signals`, `mappers.test.ts › writes market and signals.medium and keeps other keys`, and `handlers.test.ts › saves a ppm SettingsInput` (now includes `signalRules`).
- [x] The STK-015 job reads the saved values. Evidence: `medium-signals.test.ts › rules saved through the settings form drive the job` (rows for MA 20/100 exist, no 50/200 rows, growth params match) and `db settings.test.ts › saveAppSettings then getSignalRules returns the saved signal rules`.
- [x] Unit and handler tests exist; no auth. Evidence: the tests above. The diff contains no `requireUser` or auth code.

### Issues
None.

### Rules R1–R10
No violations found.
- R1: all logic, labels and defaults live in core; the component only maps over `SIGNAL_RULE_SECTIONS`.
- R2: ratios are ppm integers, converted through `parseRatePercentInput`/`formatRatePercentInput`.
- R5: bounds come from `SIGNAL_RULE_BOUNDS` and defaults from `DEFAULT_SIGNAL_RULES`; the no-hardcoded-rules scan is green.
- R3: unchanged.
- R6: suspended.
- R7: changed files match the plan's list. The other changes are `work/backlog.md`, `ticket.md` and the consult files (workflow files). The `rows` vs `pairWithNext` deviation is logged in impl-log.md.

### Nits (do not block)
- `settings-form.tsx:36`: the toggle label "Bật" is a literal Vietnamese string in the component. The plan's step 10 says strings should come from core, although the same step also names "Bật" directly. It could become a core constant.
- The plan suggested reusing `CheckField` for the toggle; the implementation uses an inline `<label><input type="checkbox">`. It works the same way.
- `signal-rules-form.ts:756`: `r.value as number` is safe only because `blank` is `'required'`. A short comment would help.

### Follow-ups (out of scope)
- A FormBanner summary, or focusing the first invalid field, for signal errors that are off-screen on mobile (A9).
- A dynamic P/E EPS-basis badge driven by `TCBS_FINANCIALS_EPS_BASIS` (A2).

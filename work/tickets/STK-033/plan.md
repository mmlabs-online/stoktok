Status: READY

# Plan — STK-033: Signal-rules section on the Settings screen

## Spec summary
- docs/spec-v1.md §3 F4: "Signals (rule-based, computed in code)" … "Medium term (1–6 months) | P/E and P/B vs sector, earnings growth trend, plan completion vs annual target, price vs 50/200-day MA" (the rules are listed as "Example rules (configurable)").
- docs/spec-v1.md §5: "`settings` | fee_rate, tax_rate, concentration_threshold, rule configs".
- CLAUDE.md R5: "Market rules are configuration, never hard-coded". R1: no calculation in UI. R2: integers only (ppm for ratios).
- Ticket goal: "Ming can view and edit the medium-term signal rule parameters (`settings.rule_configs.signals.medium`) in a 'Quy tắc tín hiệu (trung hạn)' card on `/settings`."
- STK-015 already provides `DEFAULT_SIGNAL_RULES`, `SIGNAL_RULE_BOUNDS` and `parseSignalRules` in `packages/core/src/signals/config.ts` (the bounds are commented "shared with the Settings screen (STK-033)"). The worker job reads them through `store.getSignalRules()` → `getSignalRules(db)` → `parseSignalRules(rule_configs)`.
- "Plan completion vs annual target" is not part of `SignalRules`, so it is out of scope here.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | A settings card shows every medium signal parameter (all 18 `SignalRules` leaves) with its default when unset, plus Vietnamese labels and units. | `settings.test.tsx › signal rules card renders every field, label and default`: the card title "Quy tắc tín hiệu (trung hạn)" is present, along with all 18 `name="…"` attributes and every label from `SIGNAL_RULE_SECTIONS`. Default values are `"5","20","20","5","20","20","4","2","10","1","50","200","2","7"` and the 4 toggles are checked. `validate-settings.test.ts › settingsToFormValues › no row gives signal defaults`. |
| 2 | Core validation for the new fields uses the STK-015 bounds. Invalid values get Vietnamese errors and nothing is written. | `signal-rules-form.test.ts` (bounds read from `SIGNAL_RULE_BOUNDS`, every error code, the two cross-field rules, all errors reported together). `handlers.test.ts › invalid signal field returns Vietnamese error and does not save` checks that `saveAppSettings` is not called. |
| 3 | Saving merges `rule_configs.signals` without touching `rule_configs.market` (and vice versa), in one save with the existing settings form. | `signal-rules-form.test.ts › mergeSignalRules keeps market and unknown keys`. The existing `market-rules.test.ts › preserves unknown keys` covers the other direction, and a new case adds a `signals` key to it. `mappers.test.ts › settingsInputToRow writes both market and signals.medium`. `handlers.test.ts › saves a ppm SettingsInput` now includes `signalRules`. |
| 4 | The STK-015 job reads the saved values (wiring test). | `medium-signals.test.ts › rules saved through the settings form drive the job`. `settings.test.ts (db) › saveAppSettings then getSignalRules returns the saved signal rules`. |
| 5 | Unit and handler tests exist. No auth (R6 suspended). | `pnpm typecheck && pnpm lint && pnpm test` are green. No `requireUser`/auth code appears in the diff. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/settings/read-fields.ts` (new) | Move `readPercent`, `readInteger`, `percentRange` and `intRange` here from validate-settings.ts unchanged, and export them. | Both validators share them without a circular import (AC2: same parsers and error codes). |
| `packages/core/src/settings/signal-rules-form.ts` (new) | Add `SignalRulesFormRaw`, `SignalRulesField`, `SIGNAL_RULE_SECTIONS` (labels, help, units, input mode, order), `validateSignalRulesInput`, `signalRulesToFormValues` and `mergeSignalRules`. | AC1–AC3. All labels and logic stay in core (R1, R5). |
| `packages/core/src/settings/signal-rules-form.test.ts` (new) | Unit tests (see below). | AC2, AC3, R8. |
| `packages/core/src/settings/validate-settings.ts` | `SettingsFormRaw` extends `SignalRulesFormRaw`. Add `signalRules: SignalRules` to `SettingsInput` and `AppSettings`. `validateSettingsInput` merges in the signal errors and value. `settingsToFormValues` fills in the signal fields. Use the readers from read-fields.ts. | AC1–AC3: one form, one validation pass. |
| `packages/core/src/settings/validate-settings.test.ts` | Update the fixtures for the new fields. Add the signal cases listed below. | Typecheck and AC1/AC2. |
| `packages/core/src/settings/market-rules.test.ts` | Add a `signals` key to the "preserves unknown keys" case, or add a new case. | AC3 ("vice versa"). |
| `packages/core/src/entry/messages-vi.ts` | Add codes `MIN_CONSECUTIVE_ABOVE_COMPARISONS` and `MA_LONG_NOT_ABOVE_SHORT` with their Vietnamese text. | AC2 cross-field errors. |
| `packages/core/src/db/mappers.ts` | `appSettingsFromRow` adds `signalRules` (`parseSignalRules(row.rule_configs)`, or `DEFAULT_SIGNAL_RULES` for a null row). `settingsInputToRow` writes `mergeSignalRules(mergeRuleConfigs(existing?.rule_configs, market), input.signalRules)`. | AC1 (defaults when unset) and AC3 (one save). |
| `packages/core/src/db/mappers.test.ts` | Update fixtures. Add a case that writes both namespaces. | AC3. |
| `packages/core/src/index.ts` | Export the new symbols. | Web uses them. |
| `apps/web/server/settings/handlers.ts` | `readSettingsForm` reads the 18 new keys. Checkboxes come in as `str()` (`'on'` when checked, `''` when absent). | AC2/AC3. |
| `apps/web/server/settings/handlers.test.ts` | Extend the `form()` helper and the expected `SettingsInput`. Add the cases below. | AC2/AC3/AC5. |
| `apps/web/components/settings/settings-form.tsx` | Add a 4th card, "Quy tắc tín hiệu (trung hạn)", rendered from `SIGNAL_RULE_SECTIONS`, after "Danh mục". | AC1. |
| `apps/web/components/settings/settings.test.tsx` | Build `values` from `settingsToFormValues(appSettingsFromRow(null))`. Add the card tests. | AC1. |
| `packages/db/src/repos/settings.test.ts` | Add a save → `getSignalRules` round trip. Update fixtures if needed. | AC4. |
| `apps/worker/src/jobs/medium-signals.test.ts` | Add the wiring test. | AC4. |

No change to `packages/db/src/repos/settings.ts` is needed: `saveAppSettings` already passes the whole `SettingsInput` to `settingsInputToRow`, and `getSignalRules` already parses `rule_configs`. If the implementer finds otherwise, record it in impl-log.md. No migration is needed because `rule_configs` is already a jsonb column.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `signal-rules-form.test.ts › valid raw → SignalRules with ppm integers` | Percent text "20" → 200000, "2" → 20000, "1" → 10000, "0,5" → 5000. Integers parse. `'on'` → true, `''` → false. |
| `… › signalRulesToFormValues(DEFAULT_SIGNAL_RULES) round-trips through validateSignalRulesInput` | Guards against a 100× percent mix-up. Format → validate gives deep equality with `DEFAULT_SIGNAL_RULES`. |
| `… › bounds come from SIGNAL_RULE_BOUNDS (inclusive)` | For each numeric field: min and max are accepted, min−1 (or one ppm step below) and max+1 give `OUT_OF_RANGE`, and the params are formatted from `SIGNAL_RULE_BOUNDS` (e.g. minPeers "3"/"50", maDays "5"/"250", neutral band "0%"/"20%", ratio "0%"/"100%"). |
| `… › parse failures map to existing codes` | `abc` gives `WHOLE_NUMBER_INVALID` / `PERCENT_INVALID`. `1,23456` gives `PERCENT_TOO_PRECISE`. Blank gives `REQUIRED`. A negative gives `OUT_OF_RANGE`. |
| `… › minConsecutive > comparisons → MIN_CONSECUTIVE_ABOVE_COMPARISONS on growthMinConsecutive` | Cross-field rule. The edge minConsecutive = comparisons is accepted. minConsecutive 9 (above `comparisons.max`) gives `OUT_OF_RANGE`, not the cross-field code. |
| `… › shortDays >= longDays → MA_LONG_NOT_ABOVE_SHORT on maLongDays` | Cross-field rule. Equal values are rejected, short = long − 1 is accepted, and `maShortDays` carries no error. |
| `… › cross-field check skipped when either side is individually invalid` | Only the per-field error is shown. |
| `… › validator accepts exactly what parseSignalRules keeps` | For each accepted edge case (all mins, all maxes, pair edges): `parseSignalRules(mergeSignalRules({}, value))` deep-equals `value`. This is finance Finding 3 / R-2. |
| `… › mergeSignalRules keeps market, other signals horizons and unknown keys` | `existing = { market: {...}, signals: { long: {x:1}, medium: { extra: 1, priceVsMa: { legacy: 1 } } }, other: 2 }`. Every key survives and the medium values are replaced. A non-object `existing` is wrapped. |
| `market-rules.test.ts › mergeRuleConfigs preserves signals` | The other direction of AC3. |
| `validate-settings.test.ts › reports market and signal errors together` | One pass. `ok:false` when only a signal field fails, and the market value is not returned. |
| `validate-settings.test.ts › settingsToFormValues › no row gives signal defaults` | AC1 defaults ("5","20","20",…,"7","on"). |
| `messages-vi` (via `signal-rules-form.test.ts`) `› new codes have Vietnamese text` | `entryMessage` text for both codes. |
| `mappers.test.ts › settingsInputToRow writes market and signals.medium and keeps other keys` | AC3 in one row write. |
| `mappers.test.ts › appSettingsFromRow parses signalRules; null row → DEFAULT_SIGNAL_RULES` | AC1. |
| `handlers.test.ts › saves a ppm SettingsInput` (updated) | `signalRules` is in the saved input. |
| `handlers.test.ts › unchecked toggle saves enabled:false` | The `peEnabled` key is absent from FormData, giving `signalRules.peVsSector.enabled === false` (not the default true). |
| `handlers.test.ts › invalid signal field returns Vietnamese error and does not save` | `maLongDays` = `maShortDays` gives a `MA_LONG_NOT_ABOVE_SHORT` message; `saveAppSettings` is not called; `values` echoes the raw strings. |
| `settings.test.tsx › signal rules card renders every field, label and default` | AC1. |
| `settings.test.tsx › signal field error has aria-invalid and aria-describedby` | Uses `maLongDays-error`. |
| `settings.test.tsx › toggle unchecked when value is ''` | Checkbox state comes from values. |
| `db settings.test.ts › saveAppSettings then getSignalRules returns the saved signal rules` | AC4 at the repo level (fake db, same style as the existing lot-size round trip). |
| `medium-signals.test.ts › rules saved through the settings form drive the job` | AC4. Build the raw form with minPeers 8, MA 20/100 and band 5. Then run `validateSettingsInput` → `settingsInputToRow(v.value, null)` → `parseSignalRules(row.rule_configs)` → `memoryStore({ rules })` → `run`. Assert that keys `price_vs_ma_20` and `price_vs_ma_100` exist, that no `price_vs_ma_50`/`_200` rows exist, and that the `earnings_growth_trend` `inputs_snapshot.params` equal the saved `earningsGrowth`. |
| `no-hardcoded-rules.test.ts` (unchanged) | Must stay green, so no rule literals go in web or worker source. |

## Approach
1. **Readers.** Move `readPercent`, `readInteger`, `percentRange` and `intRange` from validate-settings.ts to `settings/read-fields.ts` with identical behaviour. Existing validate-settings tests must pass unchanged, which proves the move did not alter behaviour.
2. **Form field names.** Use flat camelCase keys in `SignalRulesFormRaw`, all strings:
   `peEnabled, peMinPeers, peDiscount, pePremium, pbEnabled, pbMinPeers, pbDiscount, pbPremium, growthEnabled, growthComparisons, growthMinConsecutive, growthThreshold, growthMinBase, maEnabled, maShortDays, maLongDays, maNeutralBand, financialsMaxFetchAgeDays`.
   Toggles are `'on'` (checked) or `''` (absent from FormData). `signalRulesToFormValues` emits `'on'`/`''`. The validator maps exactly `'on'` → true and anything else → false. This avoids the hidden-input trick: an absent checkbox key means off.
3. **`validateSignalRulesInput(raw)`** returns `{ ok: true; value: SignalRules } | { ok: false; errors }`. It reads bounds only from `SIGNAL_RULE_BOUNDS` (R5):
   - minPeers: `B.minPeers`.
   - discount, premium, growthThreshold and minBase: `B.ratioPpm`, as percent.
   - comparisons: `B.comparisons`.
   - minConsecutive: `{ min: 1, max: B.comparisons.max }`, the same as the parser.
   - MA days: `B.maDays`.
   - neutral band: `B.neutralBandPpm`, as percent.
   - freshness: `B.maxFetchAgeDays`.
   - All percent fields are `'required'`, since there is no blank → default here.

   The cross-field checks run only when both sides parsed:
   - `minConsecutive > comparisons` puts `MIN_CONSECUTIVE_ABOVE_COMPARISONS` on `growthMinConsecutive`.
   - `shortDays >= longDays` puts `MA_LONG_NOT_ABOVE_SHORT` on `maLongDays`.

   All errors are collected together.
4. **`mergeSignalRules(existing, rules)`.** Spread the `existing` root, then `signals`, then `medium`, then each rule object (`peVsSector`, `pbVsSector`, `earningsGrowth`, `priceVsMa`, `freshness`) with the new values on top. Unknown keys survive at every level, and `market` is untouched (same style as `mergeRuleConfigs`).
5. **`SIGNAL_RULE_SECTIONS`.** An ordered array in core: `{ key, legend, enabledField?, note?, fields: { name, label, help?, mode: 'numeric' | 'decimal', pairWithNext? }[] }`. Labels, units and help text are below. The P/E and P/B sections are built by one helper that takes `'P/E'`/`'P/B'`, so the texts stay identical apart from the ratio name. Help text that mentions bounds is built from `SIGNAL_RULE_BOUNDS` with `formatQuantity`, never as literals.
6. **validate-settings.ts.**
   - `SettingsFormRaw extends SignalRulesFormRaw`.
   - Add `signalRules: SignalRules` to `SettingsInput` and `AppSettings`.
   - `validateSettingsInput` calls `validateSignalRulesInput(raw)`, merges its errors into the same `errors` object, and returns `ok:false` if any error exists.
   - `settingsToFormValues` spreads `signalRulesToFormValues(s.signalRules)`.
7. **Mappers.** Make the two changes listed in the files table. `settingsInputToRow` composes `mergeSignalRules(mergeRuleConfigs(...), input.signalRules)`, so it stays one upsert (AC3 "one save").
8. **messages-vi.ts.** Add the two codes:
   - `MIN_CONSECUTIVE_ABOVE_COMPARISONS`: "Không được lớn hơn số quý so sánh."
   - `MA_LONG_NOT_ABOVE_SHORT`: "MA dài phải lớn hơn MA ngắn."
9. **Handler.** `readSettingsForm` adds the 18 keys with `str(fd, key)`. No other change.
10. **Component.** Add a card titled "Quy tắc tín hiệu (trung hạn)" with the note from `SIGNAL_RULE_CARD_NOTE` in core.
    - Render one `<fieldset>` + `<legend>` per section, with dividers between them. Each section has a toggle labelled "Bật" (`CheckField`, `defaultChecked={values[f] === 'on'}`), an optional static note, and `ValueField`s. Pairs use `grid gap-4 sm:grid-cols-2`.
    - No arithmetic, no default literals and no Vietnamese strings other than ones that come from core (R1/R5).
    - Inputs are never `disabled`, because disabled inputs drop out of FormData. No client state or dirty tracking (STK-010 A7).
    - Errors come from `errors[name]` like the existing fields.
11. Run `pnpm typecheck && pnpm lint && pnpm test`.

**Labels, units and help text (all in core, Vietnamese).**
- Card note: "Tham số của tín hiệu trung hạn (1–6 tháng). Tín hiệu chỉ cho biết chiều hướng, không phải khuyến nghị." The words "mua" and "bán" are avoided (R9/R10).
- P/E so với ngành (P/B so với ngành is the same with "P/B"):
  - Static note on P/E only: "P/E bị ẩn cho đến khi xác minh cơ sở EPS của nguồn dữ liệu."
  - "Số mã cùng ngành tối thiểu (mã)". Help: "Chỉ tính các mã trong danh sách theo dõi và danh mục. Dưới mức này tín hiệu bị ẩn."
  - "Ngưỡng thấp hơn trung vị ngành (%)".
  - "Ngưỡng cao hơn trung vị ngành (%)".
- Tăng trưởng lợi nhuận:
  - "Số quý so sánh (quý)". Help: "So sánh cùng kỳ năm trước."
  - "Số quý liên tiếp tối thiểu (quý)". Help: "Không vượt quá số quý so sánh."
  - "Ngưỡng tăng trưởng (%)".
  - "Nền lợi nhuận tối thiểu (% doanh thu)". Help: "Nền thấp hơn mức này chỉ cho biết chiều hướng, không tính %."
- Giá so với đường MA:
  - "MA ngắn (phiên)" and "MA dài (phiên)". Help on the long MA: "MA ngắn phải nhỏ hơn MA dài. Đổi số phiên sẽ bắt đầu chuỗi tín hiệu mới."
  - "Biên trung tính quanh MA (%)".
- Độ mới của dữ liệu tài chính:
  - No toggle.
  - "Tuổi tối đa của dữ liệu tài chính (ngày)". Help: "Tăng giá trị này nới lỏng kiểm tra dữ liệu cũ."

**Rules.**
- R1: logic, labels and defaults live in core, and the component only maps over them.
- R2: values are ppm integers, converted via `parseRatePercentInput`/`formatRatePercentInput` (no floats).
- R5: bounds come from `SIGNAL_RULE_BOUNDS`, defaults come from `DEFAULT_SIGNAL_RULES` via `parseSignalRules`, and the scan stays green.
- R3: unchanged, with server-only data access.
- R6: suspended, so no auth code.
- R7: no STK-036 guard settings and no price-limit hint.

Estimated diff is about 450 lines, of which about 60% is tests. It is one feature, so there is no split.

## Specialist input used
- **UI A** (one card, fieldset per rule, order, shared P/E–P/B renderer): adopted.
- **UI B / finance R-1** (strings in core, unit in the label): adopted. Labels are lightly reworded. I used finance's unit "phiên" for MA lengths (trading sessions) instead of UI's "ngày", because `getRecentCloses(n)` counts trading closes.
- **UI C / finance R-1** (reuse `parseRatePercentInput`/`formatRatePercentInput`, no new converter): adopted.
- **UI D**:
  - Never `disabled`: adopted.
  - The 2-column pairs: adopted.
  - "Dim when off + 'Đang tắt' note": rejected, because it needs client state that tracks the checkbox, and STK-010 has none. The static toggle is enough for v1.
  - The hidden "0" input: replaced by absent = off.
  - The dotted names (`signal.peVsSector.enabled`): replaced by flat camelCase keys, which are cleaner as TS keys and HTML ids.
- **UI E / finance R-2** (one pass, reuse existing codes, cross-field error on a specific field): adopted.
  - **Disagreement:** I attach `shortDays >= longDays` to **`maLongDays`** (finance) and not `maShortDays` (UI). This puts it on the dependent, second field of the pair, consistent with `minConsecutive` (which both consults put on the dependent field). The `maShortDays` field is not marked invalid; its help text states the rule.
- **UI F / finance R-3** (merge keeps `market`, other horizons and unknown keys; tests in both directions): adopted.
- **UI G** (scan unchanged, help text in core): adopted.
- **UI H** (component tests): adopted.
- **UI risk "error off-screen on mobile"**: not adopted. FormBanner listing failing labels is new behaviour not in STK-010, so it goes to follow-ups under R7.
- **Finance R-2 round-trip test** (validator ⇔ parser): adopted as "validator accepts exactly what parseSignalRules keeps".
- **Finance R-4** (all fields editable; warning hint on freshness; no soft warnings for 0% edges): adopted.
- **Finance R-5** (wiring test with MA 20/100 rule IDs): adopted.
- **Finance R-6** (no STK-036 guard settings; no `publishLagDays`/EPS basis/cutoff/`RULE_VERSION`): adopted. The optional price-limit hint is dropped under R7.
- **Finance Findings 5 and 7** (MA rule ID changes, old rows remain): reflected in help text only. Downstream filtering is STK-016's concern.

## Assumptions
These are planner defaults for Ming to confirm in the PR.
- A1. Each rule gets its own enable toggle ("Bật"), as STK-015's `enabled` flags imply (UI open question 1). Freshness has no toggle, because it has no `enabled` flag.
- A2. The P/E EPS-basis note is static text. There is no "Tạm ẩn" badge driven by `TCBS_FINANCIALS_EPS_BASIS` (UI Q2). That would add a new data dependency to the screen; follow-up.
- A3. `financialsMaxFetchAgeDays` is editable on the card, with a warning hint (UI Q3, finance Q1). AC1 says "every medium signal parameter". It is not hidden under "Nâng cao".
- A4. P/E and P/B discount and premium are four separate inputs, not a linked "±%" field (UI Q4, finance Q2). This matches storage.
- A5. There is no hint under the market price limits about the MA guard (finance Q3), under R7.
- A6. The `shortDays >= longDays` error goes on `maLongDays`.
- A7. All signal fields are required in the form (blank gives `REQUIRED`). The form is always pre-filled with stored values or defaults, so there is no blank → default behaviour as with concentration.
- A8. A stored but invalid value (one that `parseSignalRules` drops) is displayed as its default. Saving then writes the default explicitly. This is acceptable.
- A9. Errors only appear after submit, with no scroll-to-first-error. Possible follow-up: FormBanner summary or focusing the first invalid field.

## Blocking questions
None.

## Split proposal
None.

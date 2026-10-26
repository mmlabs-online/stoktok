Status: READY

# Plan — STK-010: Settings screen

## Spec summary
- `docs/spec-v1.md` §2.1: "All values below are **configuration, not hard-coded**, and must be verified against current exchange and TCBS rules before go-live." Rows used here: "Settlement | T+2", "Daily price limits | HOSE ±7%, HNX ±10%, UPCoM ±15%", "Board lot | 100 shares (odd lots handled separately)", "Selling tax | 0.1% of sale value", "Brokerage fee | Ming's actual TCBS fee rate (user setting)".
- §3 F2: "Concentration view: weight of each holding; warning above a user-set threshold."
- §5: "`settings` | fee_rate, tax_rate, concentration_threshold, rule configs".
- CLAUDE.md R5: "Market rules are configuration, never hard-coded: fee rate, sell tax, price limits per exchange, settlement days, lot size." R6 is **suspended**. The AC2 wording "behind auth (R6)" is waived, so no auth code is added.
- Existing schema (`supabase/migrations/20261023000100_v1_tables.sql`): `settings` has the ledger columns, `concentration_threshold_ppm` (nullable, 0..1e6), and `rule_configs jsonb` (object; comment: "R5 per-exchange price limits, lot size, signal rule params; no money values"). **No migration is needed.**

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Form for fee rate, sell tax, price limits HOSE/HNX/UPCoM, settlement days, lot size, concentration threshold, cash dividend treatment | `apps/web/components/settings/settings.test.tsx › renders every field` checks that each `name=` (`feeRate`, `sellTaxRate`, `priceLimitHOSE`, `priceLimitHNX`, `priceLimitUPCOM`, `settlementDays`, `lotSize`, `concentrationThreshold`, both `cashDividendTreatment` radios) and its Vietnamese label are present. Manually: `/settings` renders the three cards at 375px and on desktop. |
| 2 | Saved through a server action into `settings` in the units core uses (ppm, integers). Invalid values are rejected by core validation with Vietnamese messages. (Auth part waived, R6.) | Core: `validate-settings.test.ts` (ranges, all errors together, ppm output) and `parse-input.test.ts › parseRatePercentInput` (`"0,15"` gives 1500 and so on). Repo: `settings.test.ts › saveAppSettings payload` writes integers in ppm. Handler: `server/settings/handlers.test.ts › invalid input returns Vietnamese fieldErrors and echoes raw values`. `messages-vi.test.ts` has a message for every new code. |
| 3 | When no row exists, the defaults shown match the CLAUDE.md table | `validate-settings.test.ts › no row → form values equal the CLAUDE.md table` uses literal expected strings (tax `"0,1"`, HOSE `"7"`, HNX `"10"`, UPCOM `"15"`, settlement `"2"`, lot `"100"`, treatment `reduceCost`, fee `""`). `settings.test.ts › getAppSettings no row → source 'default'`. `settings.test.tsx › shows defaults banner`. |
| 4 | Core reads these values everywhere they apply. No hard-coded rule values remain in web or worker (R5), checked by a test | (a) Wiring: `transactions/handlers.test.ts › lot size comes from stored rules` (stored lotSize 10: qty 50 accepted; stored 100: qty 50 rejected with "bội số của 100"; `getMarketRules` called with the db). `settings.test.ts › getMarketRules reads rule_configs` plus `› save→read round trip` (the saved `rule_configs` payload fed back to `getMarketRules` gives lotSize 10). `check-ledger-change.test.ts › OVERSELL params carry settlementDays` and `messages-vi.test.ts › OVERSELL_SELF shows T+{settlementDays}` (3 gives "T+3", with no literal "T+2"). (b) Scan: `apps/web/test/no-hardcoded-rules.test.ts` is green, and its self-check proves the patterns catch known-bad samples. |
| 5 | Signal rule parameters are not in this ticket | Review the diff: no signal fields in the form or core types. `mergeRuleConfigs` keeps any other top-level key (e.g. `signals`) untouched: `market-rules.test.ts › preserves unknown keys`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/settings/market-rules.ts` | **new**. `EXCHANGES = ['HOSE','HNX','UPCOM'] as const`, `Exchange`, `EXCHANGE_LABELS` (`UPCOM` → "UPCoM"). `MarketRules extends TradingRules { priceLimitPpm: Record<Exchange, number> }`. `DEFAULT_MARKET_RULES = { lotSize: 100, priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 } }`. `parseMarketRules(json: unknown): MarketRules` (falls back per key). `mergeRuleConfigs(existing: unknown, rules: MarketRules): Record<string, unknown>` | AC1, AC4, R5: price limits and lot size defined once, typed. The merge never drops other namespaces. |
| `packages/core/src/settings/validate-settings.ts` | **new**. `SettingsFormRaw`, `SettingsField`, `SettingsInput`, `AppSettings`, `SETTINGS_BOUNDS`, `CASH_DIVIDEND_TREATMENTS` (value + Vietnamese label + one-line explanation), `validateSettingsInput(raw)`, `settingsToFormValues(s: AppSettings)`, `concentrationDefaultText()` | AC2, AC3: validation and form-string conversion in core (R1) |
| `packages/core/src/settings/market-rules.test.ts` | **new** | AC4, AC5 |
| `packages/core/src/settings/validate-settings.test.ts` | **new** | AC2, AC3 |
| `packages/core/src/entry/parse-input.ts` | add `parseRatePercentInput(text, { maxPpm })` and `formatRatePercentInput(ppm)` (BigInt/string only) | AC2: percent ↔ ppm without floats (R2) |
| `packages/core/src/entry/parse-input.test.ts` | add cases | AC2 |
| `packages/core/src/entry/rules.ts` | `DEFAULT_TRADING_RULES = { lotSize: DEFAULT_MARKET_RULES.lotSize }`. Remove the "until STK-010" comment. | R5: 100 is defined once |
| `packages/core/src/entry/messages-vi.ts` | new codes `PERCENT_INVALID`, `PERCENT_TOO_PRECISE`, `OUT_OF_RANGE` (params `min`, `max`), `WHOLE_NUMBER_INVALID`, `TREATMENT_INVALID`. `OVERSELL_SELF` text uses `T+${p('settlementDays')}` instead of the literal "T+2" | AC2. AC4: the message currently hard-codes the settlement rule |
| `packages/core/src/entry/messages-vi.test.ts` | add the new codes to `CODES`. Add the OVERSELL_SELF settlementDays case | AC2, AC4 |
| `packages/core/src/entry/check-ledger-change.ts` | add `settlementDays: settings.settlementDays` to the OVERSELL_SELF/OTHER `params` | AC4: the message reads the stored value |
| `packages/core/src/entry/check-ledger-change.test.ts` | update the exact `toEqual` params (line ~42) to include `settlementDays: 2`. Add a case with settlementDays 3 | AC4 (an existing assertion changes shape) |
| `packages/core/src/db/rows.ts` | add `SettingsFullRow = SettingsRow & { concentration_threshold_ppm: number \| null; rule_configs: unknown }` | Typed row for the new repo functions |
| `packages/core/src/db/mappers.ts` | add `appSettingsFromRow(row: SettingsFullRow \| null): AppSettings` (null row → defaults; fee may be null) and `settingsInputToRow(input: SettingsInput, existing: SettingsFullRow \| null): SettingsFullRow` (keeps withholding, holidays and cost_method from the existing row or `DEFAULT_MARKET_SETTINGS`; `rule_configs` = `mergeRuleConfigs(existing?.rule_configs, …)`). `settingsToRow` is left unchanged. | AC2, AC3, merge requirement |
| `packages/core/src/db/mappers.test.ts` | add cases | AC2, AC3 |
| `packages/core/src/index.ts` | export the new symbols | Public API |
| `packages/db/src/repos/settings.ts` | add `getAppSettings(db): Promise<{ settings: AppSettings; source: 'default' \| 'stored' }>` (never throws NOT_CONFIGURED), `getMarketRules(db): Promise<MarketRules>` (selects `rule_configs` only; no row → defaults), `saveAppSettings(db, input: SettingsInput): Promise<AppSettings>` (read the full row, then `settingsInputToRow`, then upsert on `id`, then select back). Existing functions are unchanged. | AC2, AC3, AC4 |
| `packages/db/src/repos/settings.test.ts` | add cases | AC2–AC4 |
| `packages/db/src/index.ts` | export the 3 new functions | Public API |
| `apps/web/server/settings/handlers.ts` | **new**. `readSettingsForm(fd)`, `SettingsFormState = FormState<SettingsFormRaw>`, `handleSaveSettings(db, fd)`. Reuses `failForm`/`fieldErrors` from `server/transactions/handlers.ts`. DataError → `SAVE_FAILED`; anything else is rethrown. Comment: R6 suspended, `requireUser()` goes in the caller. | AC2 |
| `apps/web/server/settings/handlers.test.ts` | **new** | AC2 |
| `apps/web/app/(app)/settings/actions.ts` | **new** `'use server'` `saveSettingsAction(prev, fd)`. On ok: `revalidatePath('/', 'layout')` then `redirect('/settings?saved=1')` | AC2 |
| `apps/web/app/(app)/settings/page.tsx` | replace the EmptyState. Server component: `getAppSettings(getDb())`, then `settingsToFormValues`, then `<SettingsForm …>`. Reads `searchParams.saved`. | AC1, AC3 |
| `apps/web/components/settings/settings-form.tsx` | **new** client form (layout under Approach §6). Display only. | AC1 |
| `apps/web/components/settings/settings.test.tsx` | **new** | AC1, AC3 |
| `apps/web/server/transactions/handlers.ts` | replace `DEFAULT_TRADING_RULES` with `await getMarketRules(db)` (run in parallel with `getEntrySettings`) | AC4: the lot-size setting has an effect |
| `apps/web/server/transactions/handlers.test.ts` | add `getMarketRules` to the `../db` mock (default: lot 100). Add wiring tests | AC4 |
| `apps/web/app/(app)/transactions/[id]/edit/page.tsx` | replace `DEFAULT_TRADING_RULES` with `getMarketRules(db)` in the `Promise.all` | AC4: the odd-lot pre-tick uses the stored lot size |
| `apps/web/test/no-hardcoded-rules.test.ts` | **new** source scan over web and worker (Approach §8) | AC4 |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `parse-input.test.ts › parseRatePercentInput`: `"0,15"` gives 1500; `"0.15"` gives 1500; `"0,1"` gives 1000; `"7"` gives 70000; `"100"` gives 1_000_000; `" 0,0001 "` gives 1; `""` is REQUIRED; `"-1"` is NEGATIVE; `"0,12345"` is TOO_PRECISE; `"1,2,3"`, `"1.000,5"`, `"abc"`, `"1e3"`, `","` are INVALID; `"99999999999999999999"` is TOO_LARGE with no precision loss; the maxPpm edge (equal is ok, +1 is TOO_LARGE) | AC2, R2 |
| `parse-input.test.ts › formatRatePercentInput`: 1500 gives `"0,15"`, 1000 gives `"0,1"`, 70000 gives `"7"`, 0 gives `"0"`, 1 gives `"0,0001"`; round trip `parse(format(p)) === p` over a table (0, 1, 9, 10, 999, 1000, 1500, 70000, 150000, 999999, 1000000) | AC2, AC3 |
| `market-rules.test.ts › parseMarketRules`: `{}`, `null`, an array, and a string each give DEFAULT_MARKET_RULES. Partial (`market.lotSize` 10 only) gives lot 10 and default limits. Wrong types (`lotSize: "10"`, `0`, `-5`, `1.5`, limit `"7"`) fall back for that key only | AC4 |
| `market-rules.test.ts › mergeRuleConfigs`: preserves the top-level `signals` key and unknown keys inside `market` and `market.priceLimitPpm`. Overwrites only `lotSize` and the three limits. A non-object `existing` gives `{ market: … }` | Merge requirement, AC5 |
| `market-rules.test.ts › DEFAULT_TRADING_RULES.lotSize equals DEFAULT_MARKET_RULES.lotSize` | R5, single definition |
| `validate-settings.test.ts › valid input returns ppm integers`: fee `"0,15"` gives 1500, tax `"0,1"` gives 1000, limits 70000/100000/150000, days 2, lot 100, concentration `"25"` gives 250000, treatment `income` | AC2 |
| `validate-settings.test.ts › range edges per field` (min ok, max ok, max+1 gives OUT_OF_RANGE, negative gives OUT_OF_RANGE): fee 0..5%, tax 0..5%, each price limit 1..30%, days 0..5, lot 1..10 000 (0 rejected), concentration 1..100% (0 rejected) | AC2 |
| `validate-settings.test.ts › blank fee is allowed → null; blank concentration → null; blank tax/limits/days/lot → REQUIRED` | AC2, Assumptions A2/A3 |
| `validate-settings.test.ts › reports all errors together` (several bad fields give several keys) | AC2 |
| `validate-settings.test.ts › treatment outside enum → TREATMENT_INVALID`; `"abc"` for lot gives WHOLE_NUMBER_INVALID; `"0,123456"` for fee gives PERCENT_TOO_PRECISE | AC2 |
| `validate-settings.test.ts › OUT_OF_RANGE params come from SETTINGS_BOUNDS` (fee max gives `{ min: '0%', max: '5%' }`), and `entryMessage` of that contains "5%" | AC2 (text and check cannot drift) |
| `validate-settings.test.ts › no row → form values equal the CLAUDE.md table` (literal expected object, see AC3) | AC3 |
| `validate-settings.test.ts › settingsToFormValues(stored) round-trips through validateSettingsInput` | AC2, AC3 |
| `mappers.test.ts › appSettingsFromRow(null)` gives defaults with fee null. Full row: maps concentration and rule_configs and keeps a null fee. Invalid treatment throws RowMappingError | AC3 |
| `mappers.test.ts › settingsInputToRow`: existing row → keeps withholding/holidays/cost_method and merges rule_configs (`signals` kept). No existing row → withholding 50000, holidays `[]`, cost_method `'WAC'`. Fee null stays null | AC2, merge |
| `settings.test.ts (db) › getAppSettings`: no row → `source: 'default'` with fee null. Stored row with null fee → no throw, `source: 'stored'`. DB error → DataError | AC3 |
| `settings.test.ts (db) › getMarketRules`: selects `'rule_configs'` with eq id 1. No row → defaults. Partial JSON → per-key fallback. DB error → DataError | AC4 |
| `settings.test.ts (db) › saveAppSettings payload`: reads first, then upserts with `onConflict: 'id'`. The payload has `concentration_threshold_ppm`, `rule_configs.market.lotSize`, the existing `rule_configs.signals` preserved, and the carried-through withholding/holidays | AC2, merge |
| `settings.test.ts (db) › save→read round trip`: feed the upsert's `rule_configs` back as the `getMarketRules` response, which gives lotSize 10 | AC4 |
| `server/settings/handlers.test.ts`: valid FormData → `saveAppSettings` called with a ppm `SettingsInput` and `{ ok: true }` returned. Invalid → `fieldErrors` with Vietnamese messages, `values` echoed as raw strings, repo not called. DataError → `formError.code === 'SAVE_FAILED'`. A non-DataError is rethrown | AC2 |
| `transactions/handlers.test.ts › lot size comes from stored rules`: `getMarketRules` → `{lotSize: 10, …}`, buy qty 50 without oddLot → createTransaction called. `getMarketRules` → lot 100, qty 50 → `fieldErrors.quantity.message` contains "bội số của 100". `getMarketRules` called with the db | AC4 |
| `check-ledger-change.test.ts › OVERSELL params carry settlementDays` (settings with settlementDays 3 → `params.settlementDays === 3`) | AC4 |
| `messages-vi.test.ts › OVERSELL_SELF uses settlementDays` (3 gives "T+3", and does not contain "T+2"). New codes are in `CODES` | AC2, AC4 |
| `settings.test.tsx › renders every field` with Vietnamese labels and both radios | AC1 |
| `settings.test.tsx › renders default values and banner` (values `"0,1"`, `"7"`, `"10"`, `"15"`, `"2"`, `"100"`; "Đang dùng giá trị mặc định"; fee "Chưa cấu hình"; concentration placeholder "20") | AC1, AC3 |
| `settings.test.tsx › renders field errors with aria-invalid/aria-describedby` and the saved banner when `saved` | AC1, AC2 |
| `no-hardcoded-rules.test.ts › no rule literals or default imports in web/worker source` | AC4 |
| `no-hardcoded-rules.test.ts › scanner flags known-bad samples` (each pattern matches a sample string such as `lotSize: 100`, `DEFAULT_TRADING_RULES`, `"T+2"`, `HOSE: 7`) | AC4 (the scan is not vacuous) |
| Existing `no-calc-in-ui.test.ts` stays green. The new form and page must contain no arithmetic. | R1 |

## Approach
1. **Core percent parsing (R2).** `parseRatePercentInput(text, { maxPpm })` in `entry/parse-input.ts`:
   - Trim. Empty gives REQUIRED. A leading `-` gives NEGATIVE.
   - Must match `^\d+([.,]\d+)?$`, else INVALID.
   - More than 4 fraction digits gives TOO_PRECISE (never rounded).
   - `ppm = BigInt(int) * 10000n + BigInt(frac.padEnd(4,'0'))`. If `> BigInt(maxPpm)`, the result is TOO_LARGE. Then convert with `Number()`.
   - Both `,` and `.` are decimal separators. Percent fields never use thousands grouping.
   - `formatRatePercentInput(ppm)` uses BigInt `/` and `%` by 10000n, trims trailing zeros, and joins with `,`. It asserts a non-negative safe integer. (It is a separate function from `formatPercent`, which rounds to hundredths and would lose fee precision.)
2. **Core market rules (R5).** `settings/market-rules.ts` as listed. The JSON shape in `rule_configs` is namespaced:
   `{ "market": { "lotSize": 100, "priceLimitPpm": { "HOSE": 70000, "HNX": 100000, "UPCOM": 150000 } } }`.
   - `parseMarketRules` validates each key: lotSize must be a safe integer ≥ 1, each limit a safe integer ≥ 1. Any other value falls back to the default **for that key only**.
   - `mergeRuleConfigs` spreads in this order: existing object, then `market` (existing market, then lotSize), then `priceLimitPpm` (existing limits, then the three values). Every other key survives.
   - `entry/rules.ts` derives `DEFAULT_TRADING_RULES` from `DEFAULT_MARKET_RULES`. Watch for a circular import: `market-rules.ts` imports only the `TradingRules` *type* from `rules.ts`.
3. **Core validation (R1, AC2).** `settings/validate-settings.ts`.
   - `SettingsFormRaw` holds strings: `feeRate, sellTaxRate, priceLimitHOSE, priceLimitHNX, priceLimitUPCOM, settlementDays, lotSize, concentrationThreshold, cashDividendTreatment`.
   - `SETTINGS_BOUNDS` holds validation bounds (not market rules):

     | Field | Bounds (ppm) | As percent / units |
     |---|---|---|
     | fee | 0..50 000 | 0..5% |
     | tax | 0..50 000 | 0..5% |
     | priceLimit | 10 000..300 000 | 1..30% |
     | concentration | 10 000..1 000 000 | 1..100% |
     | settlementDays | 0..5 | days |
     | lotSize | 1..10 000 | shares |

   - Percent fields use `parseRatePercentInput`. NEGATIVE, TOO_LARGE, and below-min map to `OUT_OF_RANGE`, with `params.min/max` built from the bounds through `formatRatePercentInput` + `'%'`.
   - Integer fields use `parseIntegerInput` (max = bound max). `NOT_INTEGER` maps to `OUT_OF_RANGE` when the text starts with `-`, otherwise `WHOLE_NUMBER_INVALID`. Out of range or TOO_LARGE maps to `OUT_OF_RANGE` with `formatQuantity` bounds.
   - Fee blank gives `null` (A2). Concentration blank gives `null` (A3). All other fields are REQUIRED.
   - Treatment must be one of `CASH_DIVIDEND_TREATMENTS`.
   - All errors are collected and returned together, as in `validateAssetInput`.
   - `SettingsInput = { feeRatePpm: number|null; sellTaxRatePpm; settlementDays; lotSize; priceLimitPpm; concentrationThresholdPpm: number|null; cashDividendTreatment }`.
   - `AppSettings` = the ledger fields (fee nullable) + `concentrationThresholdPpm` + `marketRules`.
   - `settingsToFormValues(AppSettings)`: null gives `''`, percents go through `formatRatePercentInput`, integers through `String`.
   - `concentrationDefaultText()` returns `formatRatePercentInput(DEFAULT_CONCENTRATION_THRESHOLD_PPM)`.
   - Messages (Vietnamese, in `messages-vi.ts`):
     - `PERCENT_INVALID`: "Nhập phần trăm, ví dụ 0,15."
     - `PERCENT_TOO_PRECISE`: "Tối đa 4 chữ số sau dấu phẩy."
     - `OUT_OF_RANGE`: `Giá trị phải từ ${min} đến ${max}.`
     - `WHOLE_NUMBER_INVALID`: "Nhập số nguyên, ví dụ 100."
     - `TREATMENT_INVALID`: "Chọn cách xử lý cổ tức tiền mặt."
4. **Settlement days in messages (AC4).** `check-ledger-change` adds `settlementDays` to the OVERSELL params. The `OVERSELL_SELF` text changes to "Cổ phiếu mua về sau T+{settlementDays} mới bán được."
5. **Mapping and repo (R3, merge).**
   - `appSettingsFromRow(null)` = `{ ...DEFAULT_MARKET_SETTINGS, feeRatePpm: null, concentrationThresholdPpm: null, marketRules: DEFAULT_MARKET_RULES }`.
   - With a row, it uses `toSafeInt` per column (fee nullable), the treatment/cost-method checks as in `settingsFromRow`, and `parseMarketRules(row.rule_configs)`.
   - `saveAppSettings`:
     1. `select(FULL_COLS).eq('id',1).maybeSingle()`
     2. `settingsInputToRow(input, row)`
     3. `upsert(…, { onConflict: 'id' }).select(FULL_COLS).single()`
     4. `appSettingsFromRow`

     The read-modify-write is not atomic. That is accepted for one user (same stance as STK-008 A9). An atomic `jsonb ||` SQL function is a follow-up.
   - `getMarketRules` selects `'rule_configs'` only. Nothing in packages/db or web adds new defaults outside core.
6. **Web (R1, R3; R6 suspended).**
   - Handler pattern as in `server/assets/handlers.ts`. The action in `app/(app)/settings/actions.ts` has the R6 comment and **no auth code**.
   - The page reads `getAppSettings(getDb())` and passes:
     - `initial = { ok: false, fieldErrors: {}, values: settingsToFormValues(settings) }`
     - `feeConfigured = settings.feeRatePpm !== null`
     - `isDefault = source === 'default'`
     - `saved = searchParams.saved === '1'`
     - `concentrationDefault = concentrationDefaultText()`
   - `SettingsForm` (client) uses `useActionState`, with `onSubmit` + `startTransition` as in `asset-form.tsx`. It reuses `Field`/`TextField`/`FormBanner`/class helpers from `components/transactions/form-fields`. Layout is `max-w-2xl`, single column, with labels above inputs:
     - **Card "Phí & thuế"**:
       - "Phí giao dịch (%)", with help "Kiểm tra lại biểu phí TCBS hiện tại". Shows "Chưa cấu hình" when `!feeConfigured`.
       - "Thuế bán (%)".
     - **Card "Quy tắc thị trường"**, with help "Cấu hình — xác minh với quy định sàn hiện hành":
       - One "Biên độ {EXCHANGE_LABELS[x]} (%)" field per `EXCHANGES`, in a `sm:grid-cols-3` row.
       - "Số ngày thanh toán (T+)", with help "Cổ phiếu mua được bán từ T+N; thay đổi áp dụng cho toàn bộ sổ giao dịch".
       - "Lô giao dịch (cổ phiếu)".
     - **Card "Danh mục"**:
       - "Ngưỡng cảnh báo tỷ trọng (%)", with placeholder `concentrationDefault` and help "Để trống = mặc định {concentrationDefault}%".
       - Radios from `CASH_DIVIDEND_TREATMENTS` (label + explanation), with a warning that changing it recalculates P&L for the whole history.
     - Percent inputs use `inputMode="decimal"`, integers `inputMode="numeric"`.
     - Inline errors carry `aria-invalid`/`aria-describedby`. A `FormBanner` shows form errors, and a top status shows "Đã lưu cài đặt." when `saved`. A defaults banner "Đang dùng giá trị mặc định — chưa lưu" shows when `isDefault`.
     - Sticky footer (`sticky bottom-0`, safe-area padding, form `pb-24`) has "Lưu thay đổi" (disabled while pending) and "Hủy" (`type="reset"`). Touch targets are ≥ 44px.
     - No arithmetic in the component, so `no-calc-in-ui` stays green.
7. **Wiring (AC4).** `transactions/handlers.ts` runs `const [{ settings, feeRateConfigured }, rules] = await Promise.all([getEntrySettings(db), getMarketRules(db)])` and passes `rules` to `validateTransactionInput`. The edit page does the same for `transactionToFormValues`.
   - Other rules are already read from stored settings and stay as they are:
     - fee, tax, settlement days, holidays, treatment: `getEntrySettings`/`getSettings` feeding the ledger, and the worker `store.ts`;
     - concentration: `getConcentrationThreshold` + `resolveConcentrationThreshold` in `load-dashboard.ts`.
8. **Source scan (AC4).** `apps/web/test/no-hardcoded-rules.test.ts`, modelled on `no-calc-in-ui.test.ts`.
   - **What it scans:** non-test `.ts`/`.tsx` under `apps/web/{app,components,server,lib}` and `apps/worker/src` (resolved via `path.resolve(__dirname, '../../worker/src')`). It skips `*.test.*`, `.next` and `node_modules`.
   - **Forbidden identifiers:** `DEFAULT_TRADING_RULES`, `DEFAULT_MARKET_SETTINGS`, `DEFAULT_MARKET_RULES`, `DEFAULT_CONCENTRATION_THRESHOLD_PPM`.
   - **Forbidden literals:**
     - `/lotSize\s*[:=]\s*\d/`
     - `/settlementDays\s*[:=]\s*\d/`
     - `/(Rate|Threshold)Ppm\s*[:=]\s*\d/`
     - `/\b(HOSE|HNX|UPCOM|UPCoM)\b['"]?\s*[:=]\s*\d/`
     - `/T\+\d/`
     - `/bội số của \d/`
     - `/\b0[.,]1\s*%/`
   - **Allowlist:** an `ALLOWLIST: { file, pattern, reason }[]` constant at the top, starting empty. A comment records that `DEFAULT_PRICE_CUTOFF_MINUTES_VN` (`load-dashboard.ts`, `eod-sync.ts`) and `DEFAULT_PRICE_SANITY` (`tcbs.ts`) are deliberately not forbidden: they are not settings in this ticket's form (follow-up F4).
   - **Self-check:** a second test runs every pattern against a list of bad samples.
   - Fallbacks for a missing row live in `packages/db`/`packages/core` only, which the scan does not cover. That is intended: those are the loaders.
9. **Checks.** `pnpm typecheck`, `pnpm lint`, `pnpm test` green (R8). No migration, env or auth changes, so the security auditor is not triggered by those paths.

Suggested commit split (same branch): (1) core + db + wiring + scan; (2) web handler, action, page, form, component tests.

## Specialist input used
From `consult-data-visualization-engineer.md`:
- **Adopted:**
  - §1 layout (three cards, sticky footer, 375px rules, a11y).
  - §2 BigInt percent parser with `,`/`.`, TOO_PRECISE, and the round-trip test.
  - §3 namespaced `rule_configs.market` and merge-not-replace.
  - §4 `DEFAULT_TRADING_RULES` derived from the single default, plus a stored-rules loader (named `getMarketRules` here; it returns `MarketRules`, which satisfies `TradingRules`).
  - §5–§7 field behaviour and the warnings.
  - §8 never-throwing loader with `source`, defaults as real values, fee blank.
  - §9 source scan with an import check, a literal check, an allowlist, and behavioural wiring tests.
  - §10 test list.
- **Changed:**
  - `loadSettingsForm` moves into `packages/db` as `getAppSettings`, so no web/worker code imports a default and the scan allowlist can start empty.
  - Error codes are consolidated: one `OUT_OF_RANGE` with params instead of per-field codes, which keeps the text and the bounds from the same constant.
  - "1.000" in a percent field is accepted as 1% (`.` is a decimal separator there), not rejected: the range check catches any misreading, and the result is never a silent large value.
  - The "disabled until dirty" save button is dropped. Instead "Lưu" is disabled while pending and "Hủy" is a form reset. This is a UI simplification Ming delegated (A7).
  - One scan file covers both web and worker, instead of two.
- **Verify items, resolved:**
  - `messages-vi.ts` `QTY_NOT_LOT` already interpolates `lotSize` (fine). `OVERSELL_SELF` **hard-codes "T+2"**; it is fixed here (Approach §4).
  - `settingsToRow` writes ledger columns only, and an existing test asserts it omits `rule_configs`/`concentration_threshold_ppm`. It stays unchanged; the new `settingsInputToRow` writes the full row with a merged `rule_configs`.
  - `build-ledger.ts`: lots are derived on every replay and there is no stored derived state (no `lots` table), so changing the treatment or settlement days just changes the next replay.
  - There is no exchange column anywhere in the DB or core, so the key spelling is free: `UPCOM`.
  - `LotStatusBadge` has no non-test callers today, so there is nothing to wire.
- **Not adopted:** a dividend-withholding field and a holidays editor (outside the AC; A1).

## Assumptions
- A1 **Withholding and holidays:** they are not on the form. `saveAppSettings` carries the stored `dividend_withholding_rate_ppm`, `holidays` and `cost_method` through unchanged; on first save it uses `DEFAULT_MARKET_SETTINGS`. Follow-up F1.
- A2 **Fee blank:** Ming may save while the fee is blank. It is stored as NULL, entry keeps asking for manual fees (`feeRateConfigured: false`), and the form shows "Chưa cấu hình". A typed "0" is a real 0% fee.
- A3 **Concentration blank = default:** stored as NULL, resolved by the existing `resolveConcentrationThreshold`. The placeholder and help show the default from core. The range is 1–100%; 0 is rejected. A legacy stored 0 (the DB allows it) shows as "0" and must be changed on the next save.
- A4 **Exchange keys:** the internal key is `UPCOM` (ASCII, matching the brief's `priceLimits: { HOSE, HNX, UPCOM }`). The display label "UPCoM" comes from the core `EXCHANGE_LABELS`. No DB/asset column holds an exchange today.
- A5 **Lot size is one global value**, `rule_configs.market.lotSize`, used for all exchanges. Odd-lot behaviour is unchanged.
- A6 **Price limits are stored and shown only.** No new consumer in this ticket (R7). Follow-up F2.
- A7 **UI defaults (delegated by Ming):**
  - card names and labels as in Approach §6;
  - after a successful save, a redirect to `/settings?saved=1` shows the confirmation;
  - there is no dirty tracking;
  - validation bounds: fee and tax 0–5%, price limits 1–30%, settlement 0–5 days, lot 1–10 000.
- A8 **The read-modify-write merge is not atomic.** That is acceptable for a single user. Follow-up F3 makes it atomic.
- A9 **R6 suspended:** no auth code. `getDb()` is called only from server code, so restoring auth later means adding a `requireUser()` call to `saveSettingsAction` and the page.
- A10 **Lot size changes do not rewrite history.** Editing an old transaction re-derives `oddLot` with the new lot size (existing `transactionToFormValues` behaviour).

**Follow-ups** (not in the diff):
- F1: UI for withholding rate and the holiday list.
- F2: entry validation and signals (limit-hit flag, spec §2.1) read `priceLimitPpm`.
- F3: atomic `rule_configs` merge via a SQL function.
- F4: decide whether `DEFAULT_PRICE_CUTOFF_MINUTES_VN` and `DEFAULT_PRICE_SANITY` become settings.
- F5: per-exchange lot size, if ever needed.

## Blocking questions
None.

## Split proposal
Estimated diff: about 550 lines of production code plus about 600 lines of tests. That is above the ~400 guide, but it is a single spec feature. Most of the volume is tests, and the AC are tightly coupled (AC4 wiring needs the AC2/AC3 core types). This plan covers the whole ticket in one cycle.

**Named split point**, if the orchestrator or reviewer wants two cycles:
- **Slice A** (core + db + wiring + scan): everything above except the files under `apps/web/server/settings/`, `apps/web/app/(app)/settings/` and `apps/web/components/settings/`. It delivers AC3 (core/repo level), AC4 and AC5, plus the AC2 core validation and messages.
- **Slice B** (web): the handler, action, page, form and component tests. It delivers AC1 and the AC2 server action.

The implementer should commit along this boundary either way.

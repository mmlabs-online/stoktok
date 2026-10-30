STK-033 consult: layout of the "Quy tắc tín hiệu (trung hạn)" settings card

I read the STK-033 ticket, the STK-010 plan (§6 and A7), the STK-015 plan (config, bounds, split proposal) and Prompt 6 in docs/figma-make-prompts.md. I did not read the STK-010 implementation, so component names below come from its plan.

## Findings

1. STK-010 patterns to reuse
- The form is single column, max-w-2xl, with cards, labels above inputs and sm:grid-cols-N rows.
- It uses Field/TextField/FormBanner from components/transactions/form-fields.
- Percent inputs use inputMode="decimal", integers use "numeric", and both accept "," or ".".
- Errors carry aria-invalid and aria-describedby.
- The sticky footer is shared: "Lưu thay đổi" and "Hủy" (type="reset").
- The "Đã lưu cài đặt." status, the defaults banner and source: 'default' all come from getAppSettings.
- The form has no dirty tracking (STK-010 A7), so the card must not add its own.

2. The brief differs from STK-015's real parameters
- Prompt 6 lists generic short-term examples: MA 20/50, RSI, volume multiplier.
- STK-015 defines the real medium parameters, and these win.
- The brief's "grouped by horizon" does not apply, because the card is medium-only.
- A per-rule enable Switch with its params beneath it still fits.

3. Parameters by rule (defaults from STK-015 DEFAULT_SIGNAL_RULES; bounds from SIGNAL_RULE_BOUNDS)
- P/E vs ngành (peVsSector) and P/B vs ngành (pbVsSector, same shape):
  - minPeers: default 5, bounds 3-50, integer.
  - discountPpm: default 200000, bounds 0-100%, percent input shows 20.
  - premiumPpm: default 200000, bounds 0-100%, percent input shows 20.
- Tăng trưởng lợi nhuận (earningsGrowth):
  - comparisons: default 4, bounds 1-8, integer.
  - minConsecutive: default 2, bounds 1..comparisons, integer.
  - growthThresholdPpm: default 100000, bounds 0-100%, percent input shows 10.
  - minBasePpmOfRevenue: default 10000, bounds 0-100%, percent input shows 1.
- Giá so với MA (priceVsMa):
  - shortDays: default 50, bounds 5-250, integer.
  - longDays: default 200, bounds 5-250, integer.
  - neutralBandPpm: default 20000, bounds 0-20%, percent input shows 2.
- Độ mới dữ liệu (freshness):
  - financialsMaxFetchAgeDays: default 7, bounds 1-90, integer.
- Every enabled flag defaults to true.
- The short < long pair is the MA cross-field rule.
- minConsecutive <= comparisons is the other cross-field rule.

## Recommendations

A. Card structure (first acceptance criterion)
- Use one card, titled "Quy tắc tín hiệu (trung hạn)". Card help text: "Tham số của tín hiệu trung hạn (1–6 tháng). Tín hiệu chỉ là hướng, không phải khuyến nghị mua/bán." This is R9/R10 wording.
- Put each rule in a sub-section with a <fieldset> and <legend>, a divider between them, and the enable toggle in the legend row. Order:
  1. "P/E so với ngành"
  2. "P/B so với ngành"
  3. "Tăng trưởng lợi nhuận"
  4. "Giá so với đường MA"
  5. "Độ mới của dữ liệu tài chính"
- P/E and P/B share a shape, so render them from one array to keep the labels identical.

B. Vietnamese labels, units and help text
Put every string in core, not in the form (R1; it keeps text and bounds from drifting, as STK-010 did with OUT_OF_RANGE).
- P/E and P/B:
  - "Số mã cùng ngành tối thiểu" (mã). Help: "Dưới mức này tín hiệu bị ẩn."
  - "Ngưỡng rẻ hơn ngành (%)". Help: "Bị coi là rẻ khi P/E thấp hơn trung vị ngành từ mức này."
  - "Ngưỡng đắt hơn ngành (%)". Help: "Bị coi là đắt khi P/E cao hơn trung vị ngành từ mức này."
  - Use "P/B" in the P/B rule's help text.
  - Put the P/E EPS-basis note under the P/E legend, as STK-015 asks: "P/E bị ẩn cho đến khi xác minh cơ sở EPS của nguồn dữ liệu." Show it as static text, not as a field error.
- Tăng trưởng lợi nhuận:
  - "Số quý so sánh" (quý).
  - "Số quý liên tiếp tối thiểu" (quý). Help: "Không vượt quá số quý so sánh."
  - "Ngưỡng tăng trưởng (%)", compared year on year.
  - "Nền tối thiểu (% doanh thu)". Help: "Lợi nhuận nền thấp hơn mức này chỉ cho biết chiều hướng, không tính %."
- Giá so với MA:
  - "MA ngắn (ngày)" and "MA dài (ngày)". Help: "MA ngắn phải nhỏ hơn MA dài."
  - "Biên trung tính quanh MA (%)".
- Độ mới:
  - "Tuổi tối đa của dữ liệu tài chính (ngày)".
- Put the unit in the label in parentheses, as STK-010 does. Do not use a suffix adornment, so 375px stays clean.
- The enable toggle label is "Bật" or "Đang bật". Use a visually labelled checkbox or switch, not hue alone.

C. ppm and percent display (R2, STK-010 pattern)
- Display and parse through formatRatePercentInput and parseRatePercentInput, with BigInt, a comma decimal and at most 4 fraction digits. The DB and core keep ppm integers.
- Reuse parseRatePercentInput(text, { maxPpm }). Do not write a second percent parser.
- Defaults render as "20", "10", "1" and "2". Never show raw ppm to the user.
- The bounds text uses OUT_OF_RANGE with min and max built from SIGNAL_RULE_BOUNDS through the same formatter.
- Put bounds in inputmode hints or help text only where they are non-obvious (3-50 peers, 5-250 MA days).

D. Layout details
- Use sm:grid-cols-2 for pairs: discount and premium; short MA and long MA. Stay single column at 375px.
- Integer params get a narrower input (w-28). Percent params get the standard width.
- Do not disable params when the rule is off. Disabled inputs are dropped from FormData, so the value would silently reset to the default on save. Dim them and keep them editable, with an "Đang tắt" note.
- An unchecked checkbox is absent from FormData. Use a hidden "0" input before the checkbox, or read presence as "1".
  - Keep one flat naming scheme in SettingsFormRaw, for example signal.peVsSector.enabled.
  - The handler test should cover an unchecked box giving enabled: false, not a default.
- Keep the page order: Phí & thuế, Quy tắc thị trường, Danh mục, then this card. The brief's "Tài sản khác" is not part of STK-010 or STK-033.
- Show the defaults banner and the saved status once at the top. They already exist.

E. Errors and validation (second acceptance criterion)
- validateSignalRulesInput runs inside the same validateSettingsInput pass, and all errors are reported together.
- Attach cross-field errors to a specific field:
  - minConsecutive > comparisons goes on minConsecutive.
  - shortDays >= longDays goes on shortDays, with longDays also marked invalid.
- Add Vietnamese messages for the two cross-field codes in messages-vi.ts, for example "Không được lớn hơn số quý so sánh." and "MA ngắn phải nhỏ hơn MA dài."
- Reuse OUT_OF_RANGE, WHOLE_NUMBER_INVALID, PERCENT_INVALID and PERCENT_TOO_PRECISE. No new generic codes.
- Nothing is written when any field is invalid, and values echoes the raw strings.

F. Saving (third acceptance criterion)
- Extend settingsInputToRow and saveAppSettings to write both market and signals.medium in the one read-modify-write.
  - mergeSignalRules(existing, rules) spreads existing signals, then medium, then the new values. It keeps unknown keys, like mergeRuleConfigs.
  - The merge has two directions to test. Saving signals must keep market. Saving market must keep signals. STK-010's market-rules.test.ts "preserves unknown keys" is the model.
- Keep signalRules in AppSettings. settingsToFormValues fills in defaults when unset, so the card shows defaults before any save.
- Wiring test: save, feed the upserted rule_configs back to getSignalRules, and check the STK-015 job's store returns the saved values.

G. R1 and R5
- The component contains no arithmetic and no default literals. All defaults, bounds and labels come from core.
- The no-hardcoded-rules scan should still pass.
- The scan's /\b0[.,]1\s*%/ pattern could trip on help-text strings that contain a percentage, so keep such text in core and leave the scan unmodified.

H. Component tests (follow STK-010's settings.test.tsx)
- Check that every field name and Vietnamese label is present.
- Check the default values: "5", "20", "20", "4", "2", "10", "1", "50", "200", "2", "7".
- Check the field errors and the accessibility attributes.
- Check the toggle submit behaviour from section D.

## Risks
- Disabled inputs dropping values. If implemented as disabled, a disabled rule's params reset on save. D avoids this.
- Percent unit mix-ups. Minimum base (1%), neutral band (2%) and the thresholds all look similar. A parsing mistake could be 100 times off. The round-trip test (parse(format(p)) === p) over the real defaults is the guard.
- Two rules sharing a shape. If the P/E and P/B shapes later diverge, a shared renderer will need splitting. That is fine for v1.
- Cross-field errors only show after submit. On a mobile screen with 11+ fields, the card is long and an error may be off-screen. Make FormBanner list the failing field labels, as STK-010 does, or scroll to the first invalid field.
- STK-015 bounds must be final. If the STK-015 bounds change after its review, the card and tests must read from SIGNAL_RULE_BOUNDS, not copies. Only the form tests with literal defaults need updating.
- Misread as advice. The card help text and the labels must keep the "direction, not action" wording (R9/R10). Avoid "mua" and "bán" in the labels.

## Open questions
1. Should each rule get its own enable toggle on this card, as the brief and STK-015's enabled flags imply? I assumed yes. The alternative is hiding the toggles for v1.
2. Should the P/E EPS-basis note be visible, or should the card also show a "Tạm ẩn" badge while TCBS_FINANCIALS_EPS_BASIS is 'unverified'? That badge would need the basis constant exported from core, and its text must not be a UI-side decision (R1).
3. Does Ming want the freshness setting (financialsMaxFetchAgeDays) on the card? It is part of "every medium signal parameter" in the first acceptance criterion, so I included it. It could go under a collapsed "Nâng cao" <details> if the card feels long.
4. Do the P/E and P/B discount and premium thresholds each get their own input, or should the pair be linked into a symmetric "± %" field? The plan stores them separately, so I kept two inputs.

Files read:
- /home/user/stoktok/work/tickets/STK-033/ticket.md
- /home/user/stoktok/work/tickets/STK-010/plan.md
- /home/user/stoktok/work/tickets/STK-015/plan.md
- /home/user/stoktok/docs/figma-make-prompts.md

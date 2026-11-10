STK-073 UI consult delta (read-only; builds on work/tickets/STK-070/consult-data-visualization-engineer.md). Most of the earlier design stands. Only the new or changed points are listed.

FINDINGS
- Open questions 2 and 3 from STK-070 are settled:
  - Month spend: `AiClient.budgetStatus()` in `packages/ai/src/client.ts:88` returns core `budgetStatus(await ledger.monthSpend(aiBudgetWindow(clock())), cfg)`. The web card gets it through `server/ai.ts` `getAiBudgetStatus()`. No separate ledger read is needed, and the card helper must not import `@stoktok/ai`.
  - "Configured" flag: none exists. `AiClient` keeps `providers` private, and `buildProviders` returns only providers whose key is present. `server/ai.ts` does not exist yet.
- Open question 4 is settled: `Card` and `cardClass` are still private to `settings-form.tsx` (lines 21-25). `HolidayCalendarCard` is already a separate sibling file, so there is precedent for a standalone card file.
- The page (`settings/page.tsx`) is `force-dynamic` and already has `requireUser()` plus `getDb()`. The card can be a sibling of `<SettingsForm>` inside the existing `div.space-y-4`, with no form coupling.
- Real numbers differ from my earlier examples: cap is 5 USD (`5_000_000`), `warnPpm` is 800_000, and `timeZone` is VN. So the warn mark is at 4,00 USD and the cap is "5,00 USD".
- `BudgetStatus` has no warn threshold and no month label. The percent position of the mark is derivable from config without UI arithmetic only if core exports it.
- `formatUsdMicro` uses `toLocaleString('vi-VN')` and `Math.ceil` to cents. Spent is shown rounded up to a cent, as noted before.
- `aiMessage('budget_warn')` reads `percent`, `spentMicroUsd` and `capMicroUsd` params. Pass the `BudgetStatus` fields as given.

RECOMMENDATIONS
1. Data flow (AC "no false zero", R1). `page.tsx` calls `getAiBudgetStatus()` inside try/catch (or a small helper returning a discriminated `{ ok: true; status } | { ok: false }`). Pass that to a pure server component `AiUsageCard`. On failure render the error state ("Không tải được chi phí AI tháng này. Thử tải lại trang.", `AlertTriangle`, `role="status"`) and still render the form. Never default spent to 0. This also covers the "errors propagate" behaviour of `client.budgetStatus`.
2. Threshold mark (R5). Export one small core helper, for example `budgetWarnPercent(cfg)` or a `warnPercent` field on `BudgetStatus`, computed as `warnPpm / 10_000`. Add a core test (R8). The card then draws the tick at that value. The alternative of reading `AI_CONFIG.budget.warnPpm` in the component means a division in UI, which is borderline R1, so prefer the helper. The warn percent here is a round 80, so integer ppm / 10_000 is exact.
3. Month label. Derive it from core, not `new Date()` in the component. Either `vnDateOf(now)` from the calendar (via `todayVn()` in `server/clock`, as `page.tsx` already does) or a tiny core helper. Show "Tháng MM/YYYY". Do not parse `aiBudgetWindow.fromTs` (a UTC instant) in the component, because the VN month start `...-01T00:00:00+07:00` becomes the previous day in UTC and gives the wrong month.
4. "Not configured" line. Skip it in STK-073 unless it is cheap. If included, `server/ai.ts` exposes `aiProvidersConfigured(): boolean` read from env presence only, with no key values. Do not read env in the card. The default is to show spend plus budget state only. `provider_unavailable` text is the existing wording, and showing it is optional polish.
5. Card extraction (R7). Duplicate the one-line `cardClass` string in `ai-usage-card.tsx`, or extract a shared `card.tsx`. Either is acceptable. Duplication touches no existing file, which is the safer choice under R7.
6. Placement. Put the card above the form, which still holds because of the sticky save bar (`pb-24`). It sits outside `SettingsForm`, which returns null when `state.ok`.
7. Visual and a11y design is unchanged from STK-070: single 0-to-cap bar, `role="meter"` with `aria-valuetext`, level icon plus text plus fill, a tick at the warn position, and no animation. Over-cap shows the real spent amount with the bar clamped. Both the clamp to 100 and the tick position should come from core outputs.
8. Tests via `renderToStaticMarkup`, with fixtures from `budgetStatus` at 0, 3,99, 4,00 (warn), 5,00 (exhausted) and over-cap (6,00), plus the error state. The assertions are text, icon, `aria-valuenow`, the tick position and that no "0,00" appears in the error case.

RISKS
- Spent can be 3,999,999 µUSD, displayed as "4,00 USD" while the level is still `ok` (ceil to cent). The percent label (floor 79) and the tick disambiguate. Keep both visible.
- `percent` can exceed 100 (e.g. 120). `aria-valuenow` must be clamped to `aria-valuemax`. Clamping is presentational, but a core `meterFill` helper (or a clamped `fillPercent`) keeps R1 clean.
- `toLocaleString('vi-VN')` needs full ICU in the Node runtime and image. Check the output "1,00 USD" in a test, since small-icu would give a different separator.
- A Postgres error such as `22023` (via `pgCode`) must not leak into the card text. Show the generic error string only.
- If `server/ai.ts` throws at import (e.g. a missing key), the whole Settings page breaks. This is why it must build lazily and work with no keys (already in the AC). The page-level try/catch should wrap both the `getAi()` construction and the `budgetStatus()` call.

OPEN QUESTIONS (new or remaining)
1. Is a core `warnPercent` / `meterFill` helper acceptable in STK-073 scope, or should the card read `AI_CONFIG.budget.warnPpm` directly? I recommend the helper.
2. Is the "provider not configured" line in scope for STK-073? I recommend no, and a follow-up if wanted.
3. Ming should still confirm the amber and red scheme (the old Q5), since the figma-make brief has no AI card.

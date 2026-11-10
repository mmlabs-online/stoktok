STK-070 UI consult: "Chi phí AI tháng này" card on /settings

FINDINGS
- /settings page is `/home/user/stoktok/apps/web/app/(app)/settings/page.tsx`, a server component. It calls `requireUser()`, then `getAppSettings(getDb())`, then renders `<SettingsForm>`. The form is `'use client'` (`/home/user/stoktok/apps/web/components/settings/settings-form.tsx`). It has a local `Card` (section.bg-surface.border-border.rounded-lg.border.p-4, h2 title, optional `text-fg-muted text-xs` note), which is not exported.
- Trap: `SettingsForm` returns `null` when `state.ok` is true. A card nested inside it would vanish after a save. The card is also read-only and has no form fields, so it must not live inside the `<form>`.
- Core already provides everything needed:
  - `aiBudgetWindow(now)` gives the calendar month in VN time.
  - `budgetStatus(spentMicroUsd)` returns `{spentMicroUsd, capMicroUsd, remainingMicroUsd, percent (floored), level: 'ok'|'warn'|'exhausted'}`.
  - `formatUsdMicro` gives "4,00 USD" (vi-VN, rounded up to whole cents).
  - `aiMessage('budget_warn' | 'budget_exhausted', params)` gives ready Vietnamese text.
- Tokens in `apps/web/app/globals.css` (light and dark): `bg-surface`, `border-border`, `text-fg`, `text-fg-muted`, `text-accent`, `text-warn` (#8c6a1b, AA-darkened), and `price-up/down/ref/ceiling/floor` plus `-bg` variants.
- Existing alert pattern: `AlertTriangle` from lucide-react, `text-warn font-semibold`, text always beside the icon (`data-freshness-badge.tsx`, `price-refresh-bar.tsx`). No progress or meter component exists anywhere in apps/web. There is no shared Card component.

RECOMMENDATIONS
1. Placement (AC3)
   - Render a new server component `apps/web/components/settings/ai-usage-card.tsx` in `page.tsx`, as a sibling after `<SettingsForm>`. It uses `max-w-2xl` to match the form width, and the same card classes (`bg-surface border-border space-y-4 rounded-lg border p-4`).
   - Preferably put the card above the form, or at least outside it, so the sticky save bar (`pb-24`) doesn't cover it.
   - Prefer extracting `Card` and `cardClass` into a small shared `settings/card.tsx`, so the new card and `SettingsForm` use the same component. This is a tiny refactor. If the ticket plan forbids it (R7), duplicate the one-line class string instead.
2. Data flow and R1
   - `page.tsx` or a server helper in `apps/web/server/ai-usage.ts` reads the month's spent micro-USD from the ledger, using `aiBudgetWindow(new Date())`. The helper must not import `@stoktok/ai`. That package may only be imported from `server/ai.ts`, per the carry-over.
   - The helper calls core's `budgetStatus` and passes a plain `BudgetStatus` object to the card. The card only formats, using `formatUsdMicro`, `aiMessage`, and `status.percent` and `status.level` as given.
   - Do not compute percent, remaining, level, or a bar width from raw numbers in the component. The CSS width is `status.percent` clamped to 0–100, and `percent` is already a core output. Clamping in the UI is presentational, but a tiny core helper such as `meterFill` would remove any doubt. The floor of `percent` at 99.99% shows 99%, and `level` is still correct because it comes from the exact BigInt compare.
   - Spent can exceed the cap (reserve and settle drift). Show the real spent amount ("4,20 / 4,00 USD") and clamp only the bar.
3. Presentation (per Perceptual Honesty and CVD)
   - Use a single horizontal bar on a 0-to-cap scale. The track is `bg-border`, the fill is solid, and the baseline is zero. No pie or donut.
   - Headline: `formatUsdMicro(spent)` large with `num` (tabular), plus `/ {formatUsdMicro(cap)}` in `text-fg-muted`. Next to it, a `{percent}%` label. Below the bar, "Còn lại {formatUsdMicro(remaining)}" and "Tháng MM/YYYY (đặt lại ngày 1)". The month label comes from the core window or `todayVn`, not `new Date()` in the component.
   - Accessibility:
     - Use `role="meter"` with `aria-valuenow={percent}`, `aria-valuemin={0}`, `aria-valuemax={100}`, and `aria-valuetext` set to e.g. "Đã dùng 3,20 / 4,00 USD (80%)". Give it an `aria-labelledby` pointing at the card h2.
     - Use `role="status"` on the state message, not `role="alert"` (the page loads statically).
   - Level styling. Colour is never the only carrier: each level has a different icon, a text label, and a different fill pattern. The colours match what exists.

   | Level | Fill | Icon | Text and cue |
   |---|---|---|---|
   | ok | `bg-accent` (green, same family as price-up) | none or `CheckCircle2` | "Bình thường" |
   | warn | `bg-warn` (amber, same as freshness warnings) | `AlertTriangle` | Bold `aiMessage('budget_warn')` in `text-warn`, with border-t or a `price-ref-bg` strip |
   | exhausted | `bg-price-down` (brick red) | `Ban` or `XCircle` | `aiMessage('budget_exhausted')` in `text-price-down`, with a `price-down-bg` strip and a thicker or solid border |

   - Add a tick mark at 80% (`border-l` on the track) so the threshold is visible and the warn state reads as a position, not a hue. That 80% position comes from the config's `warnPpm`, passed as a prop from core. Do not hard-code 80 in the UI (R5).
   - Light/dark are covered because every colour is a token. Check that the text and bar contrast against `bg-surface` are at least 3:1 for the bar and 4.5:1 for text. `--color-warn` already meets AA.
   - Don't reuse ceiling purple or floor cyan. They mean price-board states.
   - Respect `prefers-reduced-motion`: no animated fill.
4. Vietnamese labels
   - Title: "Chi phí AI tháng này". Note: "Chỉ đọc — hạn mức tính theo tháng (giờ Việt Nam)".
   - Labels: "Đã dùng", "Hạn mức", "Còn lại".
   - Status text for ok: "Trong hạn mức".
   - Reuse `aiMessage` for warn and exhausted. Don't write new strings in the component; if more are needed, add them to `messages-vi.ts` with tests, in the same style as `aiMessage`.
5. Empty and error states
   - DB unreachable or query failure: the ledger read must not break the rest of the page. Catch it in the server helper and render the card with "Không tải được chi phí AI tháng này. Thử tải lại trang." in `text-warn` with `AlertTriangle`. The settings form still renders. Do not show "0,00 USD", because a false zero looks like a healthy budget. Fail closed in the display too.
   - No keys configured: this is the `provider_unavailable` state, a separate fact from spend. Show spent 0 with the bar when the ledger is readable, and add a muted line `aiMessage('provider_unavailable')`. This needs a boolean "configured" input from `server/ai.ts`, not env reads in the component. If the ticket plan doesn't provide that yet, put it in the open questions.
   - No spend yet (new month): show "0,00 USD / 4,00 USD", an empty bar, and "Trong hạn mức". This is not an empty-state illustration.
   - Cap of 0 or an invalid config: `budgetStatus` divides by cap. `validateAiConfig` should guarantee cap > 0; keep that guarantee instead of guarding in the UI.
6. Tests (R8)
   - Test the pure card with `renderToStaticMarkup`, as in `components.test.tsx`, with fixtures from `budgetStatus` at 0, 79%, 80%, 100%, and over-cap. Check that the text, icon, and `aria-valuenow` appear.
   - Add or extend a core test only if any new core helper is added.

RISKS
- Putting the card inside `SettingsForm` makes it disappear when `state.ok` is true, and it also couples read-only UI to a form.
- Computing percent or level in the component breaks R1. Hard-coding 80 breaks R5.
- `percent` is floored, so 99.9% reads as 99% while `level` is exhausted at ≥100% only. The bar and label are consistent; the level text is the source of truth.
- `formatUsdMicro` rounds up to whole cents, so the displayed spent may be up to 1 cent above the true value. Tiny, but a displayed "4,00 / 4,00 USD" can occur just under the cap, while the level is still warn. The text of warn then reads as 100%. Consider showing the `percent` label alongside.
- Reading month spend runs through the ledger with `getDb()` (service role). It stays server-only (R3), and `requireUser()` already guards the page (R6).
- A false-zero display on DB failure is the main honesty risk; see 5.
- The `@stoktok/ai` import rule: any helper in `apps/web/server/` must import only `@stoktok/core` types, or the r3-guard check for `server/ai.ts` could fail.

OPEN QUESTIONS
1. Should the card sit above or below the form? I recommend above or outside, because of the sticky save bar.
2. Does the ledger expose a "spent this month" read (and which table or RPC) that this card can use? That comes from STK-071/072 and wasn't checked here.
3. Is a "configured" indicator (any provider key present) available from `server/ai.ts` for the no-keys state, or should this card just show spend plus the budget status?
4. May `Card` be extracted into a shared file within this ticket (R7), or should the card duplicate the class string?
5. Does the Figma-derived brief (`docs/figma-make-prompts.md` Prompt 6) need updating? It has no AI card, so the UI here is designed in code. Ming should confirm the amber and red scheme.

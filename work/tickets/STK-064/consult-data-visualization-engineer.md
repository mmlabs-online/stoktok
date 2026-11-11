## STK-064 UI consult: AI summary card (Tài sản + symbol screens)

### Findings
- Tài sản is `apps/web/app/(app)/page.tsx`. Order today: h1 + PriceRefreshBar, then PortfolioSummary, then EmptyState or HoldingsTable. It has a `ledgerError` early return and an empty-portfolio branch.
- The symbol screen is `apps/web/app/(app)/symbols/[symbol]/page.tsx`. Order today: SymbolHeader, PriceChart, SignalsSection, then a 2-column grid of position/lots and transactions. It uses `loadSymbol` from `server/symbols/load-symbol`.
- Existing shared pieces to reuse:
  - `DisclaimerNote` and `DISCLAIMER_TEXT` ("Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư").
  - `EmptyState`.
  - `DataFreshnessBadge`. Presentational only; the caller decides freshness.
  - The SignalsSection pattern: a view-model (VM) with `kind` = list / empty / hidden, and `InputVM` details rows showing source and fetched_at.
  - lucide icons, `bg-surface border-border rounded-lg border p-4`, and `min-h-11` touch targets.
- There is no news UI anywhere under `apps/web` yet (STK-062 has not shipped one). No `target="_blank"` or external link helper exists. The only `dangerouslySetInnerHTML` is the theme-init script in `app/layout.tsx`.
- `apps/web/test/no-calc-in-ui.test.ts` forbids `reduce(`, `Math.`, `new Date(`, `Date.now(`, `toFixed` and similar in `components/` and `app/` `.tsx` files. Staleness ("is it today?") must therefore be computed outside the TSX.
- `docs/figma-make-prompts.md` has nothing on AI summaries, so the design is up to us (CLAUDE.md says the UI is designed in code).

### Recommendations

**1. Where the card goes (AC4)**
- Tài sản: right after PortfolioSummary and before HoldingsTable. Heading "Tóm tắt AI hôm nay" (h2, `aria-labelledby`). Show it only when `hasTransactions` and `portfolio.rows.length > 0`. Hide it in the `ledgerError` and empty-portfolio branches, because a summary of nothing is noise.
- Symbol screen: after PriceChart and before SignalsSection. It reads as a digest of the chart and signals below it, and the citations jump to the signals section.
- One component, `components/ai/summary-card.tsx`, takes `vm: AiSummaryCardVM` and a `scope: 'portfolio' | 'symbol'`.
- Data loading: add a `server/ai-summary/load-ai-summary.ts` (service role, read-only select from `ai_summaries`) that returns the VM. Call it from both pages inside `Promise.all` or a Suspense boundary. A failed or slow summary load must never break the page. On error, return the `unavailable` state.

**2. VM built in core/server (R1)**
- The core builder `buildAiSummaryVM(row, now, validators)` does all of the following; the TSX only maps over the result:
  - Re-validates the stored JSON with the schema.
  - Formats dates in Vietnam time and labels the citation chips.
  - Computes `stale`, and builds the hrefs.
  - Applies the URL allow-list.
- Suggested VM shape:
  - `{kind: 'ready', dateText, stale: boolean, staleText?, model/provider text, sentences: [{text, citations: CitationVM[]}], missing: string[]}`
  - `{kind: 'empty'}`, `{kind: 'ai_off'}`, `{kind: 'budget'}`, `{kind: 'no_data'}`, `{kind: 'unavailable'}`
- A citation chip is `{kind, label, href, external}`.

**3. Rendering sentences and citations**
- Use an `<ol>` or `<ul>`. Each `<li>` has the sentence as a plain JSX text node. React escapes it, and there is no `dangerouslySetInnerHTML` and no markdown. Do not render anything from the model other than `text`. Add a test that a sentence like `<img onerror>` appears literally as text.
- Chips come after the sentence, as small links with a visible numeric or short label, e.g. `[1]`, `Tín hiệu`, `Q3/2026`, `Bài viết · cafef.vn`. Each chip has a minimum 44px touch target (`min-h-11` is the repo convention; use padding so it does not bloat the layout). Do not use colour alone to distinguish the types: put an icon and a text label on each (Newspaper, Activity, FileText).
- Citation types and targets:
  - **Signal**: internal link to `/symbols/{SYM}#signals-heading` (give SignalsSection a stable id). On the portfolio screen, link to the symbol screen of that symbol.
  - **Financial period**: label like "BCTC Q3/2026" or "BCTC 2025". Internal link to a financials anchor on the symbol screen if one exists; otherwise render a non-link chip with `title`. Do not invent a link target.
  - **Price/period of the day**: internal link `#chart` anchor, labelled "Giá phiên dd/mm".
  - **Article**: external link to the stored article URL. The label is the source name plus a truncated title taken from the stored row, never from model text.
  - **Unresolvable ID** (row deleted): render a non-link chip "Nguồn không còn". Never drop the sentence silently in the UI; the worker already strips sentences that have no ID.
- Safe external links:
  - Resolve each article citation server-side from the stored `news.url`, never from a URL the model produced.
  - Allow only `https:` (optionally `http:`), with a parsed `URL` and no credentials. Optionally also allow-list hostnames to the configured news sources. Anything else renders as plain text, not a link.
  - Render with `target="_blank" rel="noopener noreferrer"`, and add `referrerPolicy="no-referrer"`. Add a visually hidden "(mở tab mới)" and an ExternalLink icon.
  - Put the allow-list function in core with unit tests: `javascript:`, `data:`, `//host`, userinfo, and an overlong URL.
- Alongside the card, a collapsible `<details>` "Nguồn đầu vào (n)" can reuse the SignalsSection `Inputs` pattern (kind, ref, source, fetched_at) for auditability (R4, R9).

**4. Date and staleness**
- Header line: "Tóm tắt ngày dd/mm/yyyy". If the summary date is not the latest trading day, or not today in VN time (the VM computes this with the core clock and trading calendar, not in TSX), show the DataFreshnessBadge-style warning "Tóm tắt cũ (ngày …)". Use the trading calendar so that a weekend does not flag Friday's summary as outdated. This is an open question; see below.
- Also show a small "Tạo lúc HH:mm" from `created_at`, and the provider/model in muted text.

**5. States (copy in Vietnamese; each state should be an inline panel, not a page error)**
- No summary yet: "Chưa có tóm tắt cho hôm nay. Tóm tắt được tạo sau khi đóng cửa phiên." Do not show an old summary as though it were current: show the latest one with the stale badge, or the empty state if none exists.
- AI off (no key): "Tính năng tóm tắt AI đang tắt" with a link to Cài đặt.
- Budget exhausted / skipped: "Đã hết ngân sách AI hôm nay, chưa tạo tóm tắt" (use `budget_unavailable` wording for "không đọc được ngân sách").
- Provider unavailable: "Tạm thời không tạo được tóm tắt".
- Missing inputs inside a ready summary: show a muted line per missing category, such as "Không có dữ liệu: tin tức mới / báo cáo tài chính mới nhất", rather than hiding the gap. Do not auto-fill from older data.
- Whole summary has no data: "Không có dữ liệu" (no sentences, just the reason).
- Where the worker writes a skip, store a status/reason (or write no row) so the UI can tell the cases apart. This is for STK-064's data model: add a `status` column or a reason in the JSON body. The UI must not infer the reason from a missing row alone, except for "chưa có".

**6. Disclaimer**
- Show `DisclaimerNote` inside the card, always (including on the stale and missing states), in the footer: "Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư". Add a second AI-specific line: "Do AI tạo từ dữ liệu đã lưu; không phải khuyến nghị." Test that every VM kind renders the disclaimer.

**7. Accessibility**
- `<section aria-labelledby>` with an h2. The sentence list is a semantic list. Chips are real `<a>` elements with an `aria-label` such as "Nguồn 1: bài viết, cafef.vn, mở trong tab mới".
- Status messages that appear without a user action are not announced, because the card is server-rendered. Use `role="status"` only if the card is later refreshed client-side.
- Contrast is covered by the existing `test/contrast.test.ts` token checks. Use existing tokens and avoid new colours.
- Focus styles are visible on chips, and the chips wrap on narrow screens (mobile). Staleness is shown as an icon plus text, not as colour only.
- Set `lang="vi"` where the page has not already. Truncate article titles with CSS and keep the full text in `title`.

**8. Tests to add (R8)**
- Component tests per VM kind (like `signals-section.test.tsx`).
- Escaping test (HTML in a sentence).
- External-link attributes test.
- URL allow-list tests in core.
- Citation-chip mapping tests in core.
- Stale and not-stale tests with an injected clock.
- A check that `no-calc-in-ui.test.ts` stays green.

### Risks
- A model-supplied URL or label leaking into an `href` is the main XSS/phishing vector. Resolve citations by stored ID only.
- Staleness computed in the component would break R1 and the lint test; compute it in core.
- Silent gaps: if a skipped job just leaves the old row, the UI could pass off yesterday's text as today's.
- A slow or failing `ai_summaries` query could block the dashboard; isolate it.
- The card above HoldingsTable pushes the table down on mobile. Make it collapsible, or clamp the text to ~3 lines with "Xem thêm", on the portfolio screen.
- The summary may read as a recommendation. Do not show trading verbs or price targets, and keep the disclaimer next to the text, not just in the page footer.
- Anchors to financials and news sections may not exist (STK-061/062 UI is not in the tree), so those chips may have to be non-link for now.

### Open questions
1. Does a news list or financials section exist, or is one planned, on the symbol screen? That decides the internal link targets for the "period" citation.
2. What is the staleness rule: "not today" literally (as the ticket says), or "not the latest trading day" (my suggestion)?
3. Should skipped runs write a row with a status, or leave no row? The UI needs to distinguish budget, AI off and failure from "chưa có".
4. Should article links be restricted to the configured news-source hostnames, or to any https?
5. Does the portfolio summary also appear when only watchlist symbols exist (no holdings)? The ticket says holdings and watchlist each get a summary, but the Tài sản empty-portfolio branch currently shows no holdings.

Files read: /home/user/stoktok/apps/web/app/(app)/page.tsx, /home/user/stoktok/apps/web/app/(app)/symbols/[symbol]/page.tsx, /home/user/stoktok/apps/web/components/symbol/signals-section.tsx, /home/user/stoktok/apps/web/components/disclaimer-note.tsx, /home/user/stoktok/apps/web/components/data-freshness-badge.tsx, /home/user/stoktok/apps/web/components/empty-state.tsx, /home/user/stoktok/apps/web/test/no-calc-in-ui.test.ts.

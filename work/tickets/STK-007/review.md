# Review — STK-007

## Attempt 1 — 2026-10-23
Verdict: PASS

### Checks (run by reviewer)
- typecheck: pass, all 4 projects (core, db, worker, web incl. `next typegen`).
- lint: pass, all 4 projects, no warnings.
- test: core 9 files / 82 passed; db 8 files / 33 passed + 1 todo; web 5 files / 44 passed. Matches impl-log.
- build: pass. Routes `/`, `/import`, `/settings`, `/symbols/[symbol]` (dynamic), `/transactions`, `/watchlist`, `/_not-found`.
- Greps: `"use client"` only in `components/shell/nav-links.tsx` and `components/shell/theme-toggle.tsx`; no 6-digit hex in any `.tsx` under `apps/web/components` or `apps/web/app`; no auth code.
- Visual check (reviewer, Chromium 141 / playwright-core 1.56.1 from a scratch install outside the repo, `next start` on the production build):
  - `/` and `/symbols/FPT` at 375px and 1280px, light and dark (theme set via `localStorage['stoktok-theme']`): all 200. `document.documentElement.scrollWidth === innerWidth` in every case (375/375, 1280/1280), so there is no horizontal page scroll.
  - 375px: sidebar hidden, bottom tab bar visible with 5 icons and short labels, active "Tổng quan" highlighted. 1280px: sidebar visible with full labels, active item has accent color plus a left border, tab bar hidden.
  - Text is readable in both themes. Body is `#f8fafc`/`#0f172a` in light and `#020617`/`#f1f5f9` in dark. Top bar shows "Stock Assistant", "Chưa có dữ liệu" and the toggle. The footer disclaimer is visible above the tab bar.
  - Toggle cycle: Sáng (light) → Tối (dark) → reload keeps dark and the "Tối" label → Hệ thống (light under a light system scheme). Works as specified.
  - `/symbols/fpt` → 200 with h1 "FPT". `/symbols/..%2Fx` → 404.

### Acceptance criteria
- [x] Shell: sidebar, top bar, light/dark toggle, freshness indicator, Vietnamese labels, phone width. Evidence: `components/shell/nav.test.ts` (5 items, labels, hrefs, `isNavActive`); `components.test.tsx › AppShell renders sidebar, top bar, toggle, freshness indicator`; the visual check above (375px has no horizontal scroll and the tab bar is visible).
- [x] 8 shared components in `apps/web/components/`, presentational, data via props, `"use client"` only where interactive. Evidence: files `price-change.tsx`, `money-text.tsx`, `data-freshness-badge.tsx`, `lot-status-badge.tsx`, `symbol-link.tsx`, `stat-card.tsx`, `empty-state.tsx`, `disclaimer-note.tsx`; each is rendered in `components.test.tsx`; the `"use client"` grep matches only the two shell files; `test/no-calc-in-ui.test.ts` passes.
- [x] Formatting helpers in core, integer VND, unit tests. Evidence: `packages/core/src/format.ts` (every formatter calls `assertVnd`; BigInt with `roundDiv`); `format.test.ts` covers VND, price, percent (ppm), quantity, date and datetime, including host-TZ independence and RangeError on floats, NaN, Infinity and 2**53.
- [x] VN price colors. Evidence: `apps/web/app/globals.css:16-46` defines up green, down red, ref yellow/amber, ceiling purple and floor cyan for both themes. `components/tone.ts` maps each tone to a glyph, a "Trần"/"Sàn" tag and an sr label. `test/contrast.test.ts` checks ≥4.5:1 on surface and bg in both themes (32 cases pass). `components.test.tsx › PriceChange renders each of five tones` passes.
- [x] Six routes as empty pages inside the shell, no auth. Evidence: build route list; `app/(app)/*/page.tsx`; visual check of `/` and `/symbols/FPT`; invalid symbol returns 404.
- [x] Tokens defined once, no `reduce(` or arithmetic in JSX. Evidence: all colors live in `globals.css` only (hex grep over `.tsx` is empty); `@theme inline` exposes the utilities; `no-calc-in-ui.test.ts` passes.

### Issues
#### Issue 1 — 🟡 should-fix — plan deviation (formatting)
- **Where**: `packages/core/src/format.ts:36` (`` `${text} ₫` ``) and the matching strings in `packages/core/src/format.test.ts`.
- **Expected**: Plan Assumption 3 says money shows as "1.234.567 ₫" with a **NBSP** (U+00A0) before ₫, so the currency symbol never wraps onto its own line in narrow table cells.
- **Actual**: The separator is an ASCII space (0x20). I confirmed this with `od -c`.
- **Fix instruction**: Use `' ₫'` in `formatVnd` and update the expected strings in `format.test.ts` to match, for example `` `1.234.567 ₫` ``. Does not block this PASS. Fold it into the next ticket that touches `format.ts`, or do it as a `/solo`.

### Rules R1–R10
No violations found.
- R1: tone decision (`priceTone`/`changeTone`) and all formatting are in core. Components only look up classes. The guard test enforces this.
- R2: `assertVnd` runs in every formatter.
- R3: no env or DB access in the new web code.
- R5: `settlementDays`, ceiling and floor are inputs. There are no T+2 or percentage literals in components.
- R6: suspended, and no auth code was added.
- R7: every changed code file is in the plan list. `work/backlog.md` and `ticket.md` are workflow state changes.
- R8: green checks, and the new core logic has tests.

### Nits (do not block)
- `format.ts` `formatDate` accepts impossible dates such as `2026-02-31` (only checks the 1–31 range). This matches the plan's spec, but a calendar-validity check would be stricter.
- `symbol-link.tsx:15` calls `normalizeSymbol` a second time. `symbolHref` already has the normalized value, so the function could return or reuse it.
- `components.test.tsx` AppShell assertion uses a fairly brittle regex over the SVG markup (`aria-current="page"[^>]*>(?:<svg…)`). Any lucide markup change would break it.
- `symbols/[symbol]/page.tsx` decodes `params.symbol` again. Next already decodes dynamic params, so the try/catch is defensive but harmless.

### Follow-ups (out of scope)
- Plan Assumption 12 list: compact money (tr/tỷ), table-scroll wrapper, PageHeader, shadcn install, wiring the top-bar freshness to real data, adding `requireUser()` in `(app)/layout.tsx` when R6 returns.
- Consider adding a Playwright e2e smoke test (375px no-horizontal-scroll + theme persistence) when the e2e setup ticket lands. The reviewer's check script was throwaway.

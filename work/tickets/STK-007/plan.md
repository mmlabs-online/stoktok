Status: READY

# Plan — STK-007: App shell and shared UI components

Builds on branch state from PR #5 (STK-006, `packages/db`, `apps/web/server/db.ts`). This ticket does not touch `server/db.ts` or `packages/db`.

## Spec summary
- docs/spec-v1.md §2.3 Legal posture: "The UI shows a persistent "reference only, not investment advice" notice on suggestion views."
- docs/spec-v1.md §3 F2: "Lot tracking with sellable date (T+2) and status: `pending` / `sellable`."
- docs/spec-v1.md §3 F3: "Price, change, volume, last update time, data-freshness badge."
- docs/spec-v1.md §2.1: "All values below are **configuration, not hard-coded**" (settlement days, price limits, lot size).
- docs/figma-make-prompts.md Prompt 0 (the written design brief):
  - "Left sidebar navigation (collapsible on mobile): Tổng quan, Sổ giao dịch, Nhập sao kê, Danh sách theo dõi, Cài đặt. Symbol detail opens from any symbol link (no sidebar item)."
  - "Top bar: app name placeholder "Stock Assistant", last data update time, a data-freshness indicator, light/dark toggle."
  - "Vietnamese market color convention: up = green, down = red, unchanged/reference = yellow, ceiling = purple, floor = cyan."
  - "Light and dark themes via Tailwind dark: classes." / "Desktop-first, usable down to 375px width (... page itself never scrolls sideways)." / "tabular (monospace) numbers, right-aligned numeric columns."
  - "SHARED COMPONENTS: PriceChange (value + percent with market colors), MoneyText (VND formatting), DataFreshnessBadge (shows "Dữ liệu cũ" warning when dataFresh = false), LotStatusBadge (pending / sellable with sellable date), SymbolLink, StatCard, EmptyState, DisclaimerNote ("Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư")."
  - Port table: `src/lib/format.ts` → `packages/core/src/format.ts`; screens → `apps/web/app/(app)/<route>/page.tsx`; routes `/`, `/transactions`, `/import`, `/watchlist`, `/settings`, `/symbols/[symbol]`.
- CLAUDE.md R1 (no calculation in UI), R2 (integer VND), R5 (market rules are configuration), price colors table. R6 suspended: no auth code.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Shell built: sidebar, top bar, light/dark toggle, data-freshness indicator; Vietnamese UI labels; works at phone width. | `apps/web/components/shell/nav.test.ts` (5 items, Vietnamese labels, hrefs, `isNavActive`); `components.test.tsx › AppShell renders sidebar, top bar, toggle, freshness indicator`. Manual: `pnpm --filter @stoktok/web dev`, at 375px light and dark: bottom tab bar visible, sidebar hidden, no horizontal page scroll (`document.documentElement.scrollWidth === innerWidth`); at ≥1024px sidebar visible. Toggle cycles Hệ thống → Sáng → Tối, persists across reload with no flash. |
| 2 | Shared components built in `apps/web/components/` (8 named), presentational, data via props, no calculations; `"use client"` only where interactive. | Files exist; `components.test.tsx` renders each via `renderToStaticMarkup`; `grep -l '"use client"' apps/web/components -r` lists only `shell/nav-links.tsx` and `shell/theme-toggle.tsx`; `no-calc-in-ui.test.ts` passes. |
| 3 | Formatting helpers (VND, percent, price, date) in `packages/core`, integer VND input (R2), unit tests. | `packages/core/src/format.test.ts` (all cases below, including "throws on non-integer"); `pnpm --filter @stoktok/core test`. |
| 4 | Price colors follow VN convention (up green, down red, ref yellow, ceiling purple, floor cyan). | `globals.css` defines `--price-up/down/ref/ceiling/floor` per theme; `tone.test.ts › every PriceTone has class, glyph and sr label`; `contrast.test.ts` (≥4.5:1 on surface, both themes); `components.test.tsx › PriceChange renders each of five tones` (class + glyph). Manual: hue check in both themes. |
| 5 | Routes `/`, `/transactions`, `/import`, `/watchlist`, `/settings`, `/symbols/[symbol]` exist as empty pages inside the shell (no auth). | `pnpm build` route list shows all six; manual: each URL renders inside the shell; `/symbols/fpt` shows "FPT"; `/symbols/..%2Fx` → 404. `grep -ri "requireUser\|auth" apps/web/app apps/web/components` finds nothing new. |
| 6 | Design tokens defined once and reused; no `reduce(` / arithmetic in JSX (R1). | All color/radius tokens only in `apps/web/app/globals.css` (`grep -rn "#[0-9a-fA-F]\{6\}" apps/web/components apps/web/app --include=*.tsx` → none); `no-calc-in-ui.test.ts` passes. |
| — | R8: checks green | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass; root `pnpm test` runs web tests (web now has a `test` script). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/format.ts` | create | AC3: `formatVnd`, `formatPrice`, `formatPercent`, `formatQuantity`, `formatDate`, `formatDateTime` |
| `packages/core/src/format.test.ts` | create | AC3, R8 |
| `packages/core/src/tone.ts` | create | `PriceTone`, `PRICE_TONES`, `priceTone`, `changeTone` — tone decision is a price comparison, so R1 puts it in core |
| `packages/core/src/tone.test.ts` | create | R8 |
| `packages/core/src/symbol.ts` | create | `normalizeSymbol` for SymbolLink and `/symbols/[symbol]` |
| `packages/core/src/symbol.test.ts` | create | R8 |
| `packages/core/src/index.ts` | modify | export the new functions and the `PriceTone` type (explicit export list) |
| `apps/web/package.json` | modify | add deps `tailwindcss`, `@tailwindcss/postcss`, `lucide-react`; devDep `vitest`; `"test": "vitest run"` script |
| `pnpm-lock.yaml` | modify | lockfile for the above |
| `apps/web/postcss.config.mjs` | create | Tailwind v4 PostCSS plugin |
| `apps/web/vitest.config.ts` | create | node env, automatic JSX runtime, include `**/*.test.{ts,tsx}` excluding `.next`/`node_modules` |
| `apps/web/app/globals.css` | create | AC6: the single token source (`@import "tailwindcss"`, `@custom-variant dark`, `:root`/`.dark` variables, `@theme inline`, `.num` utility) |
| `apps/web/app/layout.tsx` | modify | import `globals.css`, `metadata`, `suppressHydrationWarning` on `<html>`, inline theme script in `<head>`, body base classes |
| `apps/web/app/page.tsx` | delete | `/` moves into the `(app)` route group (two `page.tsx` for `/` would conflict) |
| `apps/web/app/(app)/layout.tsx` | create | renders `<AppShell>` around all six routes |
| `apps/web/app/(app)/page.tsx` | create | `/` Tổng quan placeholder |
| `apps/web/app/(app)/transactions/page.tsx` | create | `/transactions` placeholder |
| `apps/web/app/(app)/import/page.tsx` | create | `/import` placeholder |
| `apps/web/app/(app)/watchlist/page.tsx` | create | `/watchlist` placeholder |
| `apps/web/app/(app)/settings/page.tsx` | create | `/settings` placeholder |
| `apps/web/app/(app)/symbols/[symbol]/page.tsx` | create | `/symbols/[symbol]` placeholder; `normalizeSymbol` → `notFound()` if invalid |
| `apps/web/components/shell/nav.ts` | create | single nav-items array (href, label, shortLabel, icon) + pure `isNavActive(pathname, href)` |
| `apps/web/components/shell/nav.test.ts` | create | AC1 |
| `apps/web/components/shell/nav-links.tsx` | create | `"use client"`; `usePathname` active state; `variant: 'sidebar' \| 'tabbar'` |
| `apps/web/components/shell/theme.ts` | create | `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` string, tiny external store (`subscribe`/`getSnapshot`/`getServerSnapshot`/`setTheme`) |
| `apps/web/components/shell/theme-toggle.tsx` | create | `"use client"`; tri-state toggle via `useSyncExternalStore` |
| `apps/web/components/shell/app-shell.tsx` | create | server component: sidebar (lg+), top bar, main, bottom tab bar (<lg), footer with DisclaimerNote |
| `apps/web/components/tone.ts` | create | `TONE_STYLES: Record<PriceTone, { text, bg, glyph, tag?, srLabel }>` lookup (presentation only) |
| `apps/web/components/tone.test.ts` | create | AC4: completeness guard |
| `apps/web/components/price-change.tsx` | create | AC2 |
| `apps/web/components/money-text.tsx` | create | AC2 |
| `apps/web/components/data-freshness-badge.tsx` | create | AC2 |
| `apps/web/components/lot-status-badge.tsx` | create | AC2 |
| `apps/web/components/symbol-link.tsx` | create | AC2 (+ exported `symbolHref`) |
| `apps/web/components/stat-card.tsx` | create | AC2 |
| `apps/web/components/empty-state.tsx` | create | AC2 |
| `apps/web/components/disclaimer-note.tsx` | create | AC2 (+ exported `DISCLAIMER_TEXT` constant) |
| `apps/web/components/components.test.tsx` | create | AC1/2/4 SSR render tests |
| `apps/web/test/no-calc-in-ui.test.ts` | create | AC6/R1 grep guard |
| `apps/web/test/contrast.test.ts` | create | AC4 contrast regression, parses `globals.css` (no second copy of hex values) |

No other files. In particular: no `components/ui/*`, no shadcn, no recharts, no next-themes, no table-scroll wrapper, no PageHeader, no auth code.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `core/format.test.ts › formatVnd` | `0` → `"0 ₫"`; `1234567` → `"1.234.567 ₫"`; `-1234567` → `"-1.234.567 ₫"`; `{signed:true}` `1000` → `"+1.000 ₫"`, `0` → `"0 ₫"` (zero never signed); `{symbol:false}` `1234567` → `"1.234.567"`; `Number.MAX_SAFE_INTEGER` → `"9.007.199.254.740.991 ₫"`; `2_147_483_648` (>2^31) exact; throws `RangeError` on `1.5`, `NaN`, `Infinity`, `2**53` |
| `core/format.test.ts › formatPrice` | `125400` → `"125,40"`; `0` → `"0,00"`; `1_234_500` → `"1.234,50"`; `125405` → `"125,41"` (half-up to 10 VND via `roundDiv`); `4` → `"0,00"`, `5` → `"0,01"`; `{signed:true}` `1200` → `"+1,20"`, `-1200` → `"-1,20"`, `-1205` → `"-1,21"` (away from zero), `0` → `"0,00"`; throws on `125.4` |
| `core/format.test.ts › formatPercent` (input integer ppm; 1% = 10_000) | `12_345` → `"1,23%"`; `12_350` → `"1,24%"`; `-12_350` → `"-1,24%"`; `0` → `"0,00%"`; `1_000_000` → `"100,00%"`; `{signed:true}` `9_700` → `"+0,97%"`, `0` → `"0,00%"`; `123_456_789` → `"12.345,68%"`; throws on `0.5` |
| `core/format.test.ts › formatQuantity` | `0`→`"0"`, `100`→`"100"`, `1500`→`"1.500"`, `-1500`→`"-1.500"`, `1_000_000`→`"1.000.000"`; throws on `1.5` |
| `core/format.test.ts › formatDate` | `"2026-10-23"` → `"23/10/2026"`; `"2026-01-05"` → `"05/01/2026"`; throws on `"2026-13-01"`, `"2026-10-32"`, `"23/10/2026"`, `""`, `"2026-10-23T00:00:00Z"` (date-only input) |
| `core/format.test.ts › formatDateTime` | `"2026-10-23T02:05:00Z"` → `"09:05 23/10/2026"`; `"2026-10-22T18:30:00Z"` → `"01:30 23/10/2026"` (crosses VN midnight, proves host-TZ independence); `"2026-10-23T09:05:00+07:00"` → `"09:05 23/10/2026"`; `"2026-10-23T00:00:00Z"` → `"07:00 23/10/2026"` (no "24:00"); throws on `"not a date"` |
| `core/tone.test.ts › priceTone` | ref 100000, ceiling 107000, floor 93000: price 107000 → `ceiling`; 108000 (bad data above ceiling) → `ceiling`; 93000 → `floor`; 92000 → `floor`; 100000 → `ref`; 100100 → `up`; 99900 → `down`; 106900 → `up`; throws `RangeError` on non-integer input and when `floor > ref` or `ceiling < ref` |
| `core/tone.test.ts › changeTone` | `1` → `up`, `0` → `ref`, `-1` → `down`; throws on `0.5` |
| `core/tone.test.ts › PRICE_TONES` | equals `['up','down','ref','ceiling','floor']` |
| `core/symbol.test.ts › normalizeSymbol` | `" fpt "` → `"FPT"`; `"FUEVFVND"` → same; `"CFPT2301"` → same; `"FP"` → `null`; `"ABCDEFGHIJK"` (11) → `null`; `""` → `null`; `"FPT/../x"` → `null`; `"FPT%20"` → `null` |
| `web/components/tone.test.ts › every PriceTone has class, glyph and sr label` | iterate `PRICE_TONES`; non-empty `text`, `glyph`, `srLabel`; `ceiling.tag === 'Trần'`, `floor.tag === 'Sàn'` |
| `web/components/shell/nav.test.ts` | 5 items in order with labels Tổng quan, Sổ giao dịch, Nhập sao kê, Danh sách theo dõi, Cài đặt and hrefs `/`, `/transactions`, `/import`, `/watchlist`, `/settings`; `isNavActive('/', '/')` true, `('/transactions', '/')` false, `('/transactions/x', '/transactions')` true, `('/symbols/FPT', any)` false |
| `web/components/components.test.tsx › PriceChange` | for each of 5 tones: tone text class, glyph and sr label present; `change=1200, changePct=9700, tone='up'` contains `"+1,20"` and `"+0,97%"`; ceiling contains "Trần", floor contains "Sàn"; `changePct` omitted → no "%" |
| `… › MoneyText` | `vnd={null}` → `"—"`; `-1234567` → `"-1.234.567"`; has `num` class |
| `… › DataFreshnessBadge` | `fresh={false}` → "Dữ liệu cũ"; `fresh={true} updatedAt="2026-10-23T02:05:00Z"` → "Cập nhật 09:05 23/10/2026"; `fresh={true} hideWhenFresh` → empty markup; `fresh={null}` → "Chưa có dữ liệu" |
| `… › LotStatusBadge` | pending + `sellableFrom="2026-10-27"` → "Chưa về" and "27/10/2026"; with `settlementDays={2}` contains "(T+2)"; with `settlementDays={3}` contains "(T+3)"; without it → no "T+"; sellable → "Được bán" |
| `… › SymbolLink / symbolHref` | `symbolHref(' fpt ')` → `/symbols/FPT`; `symbolHref('bad/../x')` → `null`; render `symbol="fpt"` → `href="/symbols/FPT"` and text "FPT"; invalid symbol renders plain text, no `<a>` |
| `… › StatCard` | renders `dt` label and `dd` value node; `sub` rendered when given |
| `… › EmptyState` | title, description, action slot rendered |
| `… › DisclaimerNote` | contains `DISCLAIMER_TEXT` exactly ("Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư") |
| `… › AppShell renders sidebar, top bar, toggle, freshness indicator` | only if `next/navigation`'s `usePathname` works outside Next under SSR render; otherwise `vi.mock('next/navigation', …)` returning `'/'`. Asserts `<nav>` landmarks, "Stock Assistant", a `role="status"` freshness element, the toggle `aria-label`, footer disclaimer, and `aria-current="page"` on Tổng quan |
| `web/test/no-calc-in-ui.test.ts` | reads every `.tsx` under `apps/web/components` and `apps/web/app` (via `fs.readdirSync(dir, { recursive: true })`, skipping `*.test.tsx`) and fails on `/\breduce\(/`, `/\.toFixed\(/`, `/\bMath\./`, `/\bparseFloat\(/`, `/\bparseInt\(/`, `/[*\/]\s*100\b/`, `/\/\s*1000\b/`, `/Date\.now\(/`, `/new Date\(/`. Any allow-list entry must be explicit, with a reason comment |
| `web/test/contrast.test.ts` | parses the `:root{}` and `.dark{}` blocks of `globals.css`, reads `--color-surface`, `--color-bg`, `--color-fg`, `--color-fg-muted`, `--color-warn` and the five `--price-*` hex values; WCAG relative-luminance ratio ≥ 4.5 for each text token on `--color-surface` and on `--color-bg`, in both themes |

## Approach
1. **Core formatters (R2, R1).** `format.ts` builds strings by hand, not with `Intl.NumberFormat`. That keeps output byte-exact across Node ICU builds.
   - Every number input goes through `assertVnd` first, so floats throw.
   - Grouping: take `BigInt(abs).toString()`, then apply `/\B(?=(\d{3})+(?!\d))/g` → `.`. Decimal separator `,`. Negative sign is ASCII `-`. `+` only with `signed` and only for values > 0. Currency suffix is ` ₫`.
   - `formatPrice(vnd, {signed?})`: `q = roundDiv(BigInt(vnd), 10n)` gives tens of VND. Integer part is `q / 100n` (grouped), and the fraction is `abs(q % 100n)` padded to 2 digits.
   - `formatPercent(ppm, {signed?})`: `q = roundDiv(BigInt(ppm), 100n)` gives hundredths of a percent. Same split, then the `%` suffix.
   - `formatDate(isoDate)`: strict `^\d{4}-\d{2}-\d{2}$`, month 1–12 and day 1–31 range check. Pure string work, no `Date`.
   - `formatDateTime(iso)`: `Date.parse`, throw if NaN. Then use `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).formatToParts`, and assemble `HH:mm dd/MM/yyyy` from the parts. Only the numeric parts are used, so locale punctuation does not matter.
   - Export the time zone as a named constant `VN_TIME_ZONE` in `format.ts`. It is not a market rule under R5.
   - `tone.ts`: `PRICE_TONES` as a const tuple, `PriceTone` type, `priceTone({price, ref, ceiling, floor})`, `changeTone(change)`. Order: ≥ceiling → `ceiling`, ≤floor → `floor`, =ref → `ref`, >ref → `up`, else `down`.
     - Ceiling and floor are inputs. They come from configured limits in later tickets (R5). Nothing is hard-coded.
   - `symbol.ts`: `normalizeSymbol(raw): string | null`. Trim, uppercase, then `^[A-Z0-9]{3,10}$`.
   - Add all of them to `index.ts`.
2. **Web tooling.**
   - `pnpm --filter @stoktok/web add tailwindcss @tailwindcss/postcss lucide-react` and `add -D vitest`. Use the same vitest major as core (`^5`).
   - Add `postcss.config.mjs` (`{ plugins: { '@tailwindcss/postcss': {} } }`).
   - Add `vitest.config.ts` with `environment: 'node'` and the automatic JSX runtime. The web tsconfig has `jsx: preserve`, so set the transform explicitly (`oxc: { jsx: { runtime: 'automatic' } }` or `esbuild: { jsx: 'automatic' }`, whichever the installed Vite uses). Record the choice in impl-log.
   - Add the `test` script. Root `pnpm test` (`pnpm -r --if-present test`) then picks it up.
3. **Tokens (AC6).** `globals.css` is the only place colors live.
   - Semantic variables on `:root` (light) and `.dark`: `--color-bg`, `--color-surface`, `--color-border`, `--color-fg`, `--color-fg-muted`, `--color-accent`, `--color-warn`, `--radius`.
   - The five `--price-*` text colors, each with a `--price-*-bg` tint, using the consult's starting values as hex literals:
     - Light: up `#15803d`, down `#b91c1c`, ref `#a16207`, ceiling `#7e22ce`, floor `#0e7490`.
     - Dark (surface ≈ `#0f172a`): up `#4ade80`, down `#f87171`, ref `#facc15`, ceiling `#c084fc`, floor `#22d3ee`.
     - Adjust any value the contrast test rejects.
   - `@custom-variant dark (&:where(.dark, .dark *));` and `@theme inline { --color-price-up: var(--price-up); … }` so utilities like `text-price-up`, `bg-surface`, `text-fg-muted` exist.
   - A `.num` utility: `font-variant-numeric: tabular-nums`.
   - Typography is the system font stack, with a mono stack for symbols. Spacing is Tailwind's default scale. No webfont.
4. **Theme (no flash).** `theme.ts` exports the storage key `stoktok-theme`, which holds `'light'|'dark'` or is absent (absent means system).
   - `THEME_INIT_SCRIPT` is a small IIFE string. It reads the key and `matchMedia('(prefers-color-scheme: dark)')`, then toggles `.dark` on `documentElement` inside a try/catch.
   - Root layout renders `<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />` in `<head>` and puts `suppressHydrationWarning` on `<html lang="vi">`.
   - `ThemeToggle` uses `useSyncExternalStore`. The server snapshot is `'system'`, which avoids a hydration mismatch and the React 19 `set-state-in-effect` lint rule. It cycles Hệ thống → Sáng → Tối.
   - The toggle shows lucide `Monitor`/`Sun`/`Moon` icons, `aria-label="Giao diện: <mode>"`, a 44px tap target, and writes `localStorage` before re-applying the class.
5. **Shell.**
   - Root `app/layout.tsx` stays minimal. `app/(app)/layout.tsx` renders `<AppShell>{children}</AppShell>`.
   - `AppShell` is a server component.
     - Sidebar is `hidden lg:flex`, about 224px (`w-56`), holding `<NavLinks variant="sidebar">`.
     - Sticky top bar, h-14. Left: "Stock Assistant". Right: a freshness indicator (`<div role="status">` wrapping `DataFreshnessBadge fresh={null}`, until market-data tickets provide a value), then `ThemeToggle`.
     - `<main className="min-w-0 …">` with bottom padding `pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0`.
     - Footer with `<DisclaimerNote />`.
     - Below `lg`, a fixed bottom tab bar `<NavLinks variant="tabbar">`, 5 icons with `shortLabel`, each about 75px wide and ≥44px tall.
     - Use `min-h-dvh`. No `overflow-x-hidden` on body.
   - Nav items in `nav.ts`:
     - `/` Tổng quan (short "Tổng quan", `LayoutDashboard`)
     - `/transactions` Sổ giao dịch ("Giao dịch", `BookOpen`)
     - `/import` Nhập sao kê ("Nhập", `Upload`)
     - `/watchlist` Danh sách theo dõi ("Theo dõi", `Eye`)
     - `/settings` Cài đặt ("Cài đặt", `Settings`)
   - `isNavActive`: `/` matches exactly. Other items match exact or with a `/` prefix. `/symbols/*` highlights nothing. The active item gets `aria-current="page"` plus a style change (not color alone).
   - No user menu or sign-out placeholder (R6 suspended).
6. **Components** (server components unless noted; all data via props; formatting goes only through core formatters; no comparisons that decide meaning).
   - `MoneyText({ vnd: number|null|undefined; signed?; tone?: PriceTone; symbol?: boolean })`: `null` → "—"; uses class `num`; color from `TONE_STYLES` when `tone` is given.
   - `PriceChange({ change: number; changePct?: number /* ppm */; tone: PriceTone })` renders, in order:
     - the glyph (aria-hidden)
     - `formatPrice(change, {signed:true})`
     - optionally ` (formatPercent(changePct, {signed:true}))`
     - the tag "Trần"/"Sàn" for ceiling/floor
     - the `sr-only` label (tăng / giảm / đứng giá / giá trần / giá sàn)

     Tone comes from props and is never derived from `change`.
   - `DataFreshnessBadge({ fresh: boolean|null; updatedAt?: string|null; hideWhenFresh? })`:
     - `false` → warn style, `AlertTriangle` icon, "Dữ liệu cũ"
     - `true` → muted "Cập nhật {formatDateTime(updatedAt)}", or nothing when `hideWhenFresh` or when there is no `updatedAt`
     - `null` → muted "Chưa có dữ liệu"

     It never reads the clock (R4 logic stays with the caller).
   - `LotStatusBadge({ status: Lot['status']; sellableFrom: string; settlementDays?: number })`:
     - pending → `Clock` icon, "Chưa về", plus " (T+{settlementDays})" only when that prop is given (R5), then "· bán từ {formatDate(sellableFrom)}". Uses the warn/ref tint so it cannot be missed.
     - sellable → `CheckCircle2` icon, "Được bán".
   - `SymbolLink({ symbol; className? })` plus the exported `symbolHref(symbol): string|null` (`normalizeSymbol` → `/symbols/${encodeURIComponent(s)}`). Renders a `next/link` with mono, bold text and an underline on hover/focus. An invalid symbol renders plain text.
   - `StatCard({ label; value: ReactNode; sub?: ReactNode; icon?: ReactNode })`: `<dl>` with `<dt>`/`<dd>`, surface card.
   - `EmptyState({ title; description?; icon?; action?: ReactNode })`.
   - `DisclaimerNote({ className? })`: text from the exported `DISCLAIMER_TEXT` constant, not a prop. Uses an `Info` icon.
   - `tone.ts` (web): `TONE_STYLES` typed `satisfies Record<PriceTone, …>`. This is the only tone → class/glyph map.
7. **Pages.**
   - Each placeholder page shows an `<h1>` with the Vietnamese screen name and `<EmptyState title="Chưa có nội dung" description="Màn hình này sẽ được xây dựng ở ticket sau." />`.
   - `/symbols/[symbol]`: `const { symbol } = await params;` then `normalizeSymbol(decodeURIComponent(symbol))`. On `null`, call `notFound()`. Otherwise the h1 is the normalized symbol, under the label "Chi tiết mã".
   - No data access and no `getDb()` calls.
8. **Tests and checks.** Write the tests listed above, then run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm check:service-key` (R3 sanity). Do the manual 375px/1280px light/dark check and record it in impl-log.

Rules: R1 (tone, staleness, settlement wording, and all number formatting come from core or props; grep guard), R2 (`assertVnd` in every formatter; prices are integer VND), R3 (no DB or env access in any new web code), R5 (`settlementDays` and ceiling/floor are inputs; no "T+2", "7%" or "100" literals in components), R6 (no auth code), R7 (file list above), R8 (tests above; web gains a `test` script).

## Specialist input used
From `consult-data-visualization-engineer.md`:
- **Adopted §1:** Tailwind v4 + lucide-react, with no shadcn, recharts or next-themes. Flagged to Ming under Assumptions.
- **Adopted §2:**
  - semantic tokens in `globals.css` with `@theme inline` and a class-based dark variant
  - tri-state theme, inline no-flash script, `suppressHydrationWarning`
  - per-theme price colors (starting hex values) with `-bg` tints
  - glyph/tag/sign so color never carries meaning alone
- **Adopted §3:** component APIs, with two changes:
  - `DataFreshnessBadge.fresh` is `boolean | null` to give an explicit "no data yet" state (open question 5).
  - `PriceChange.price` is dropped as unused.
- **Adopted §4:** hand-built formatting, `priceTone`/`changeTone`/`normalizeSymbol` in core, the ppm unit for percent, and VN-timezone `formatDateTime`. **Rejected:** `formatVnd` `compact` (tr/tỷ). No AC needs it, and it has non-trivial rounding/promotion edge cases. It is deferred to the dashboard ticket (follow-up).
- **Adopted §5:**
  - `(app)` route group
  - bottom tab bar below `lg` with a sidebar at `lg+` (the recommended low-risk option)
  - `aria-current`, 44px targets, `min-h-dvh`, `min-w-0`, safe-area padding
- **Rejected §5:** the table-scroll wrapper and PageHeader. They are not in the AC, so they become follow-ups (R7).
- **Adopted §6:** `renderToStaticMarkup` tests in node env (no jsdom/Testing Library), the tone-table completeness test, the grep guard, and the contrast test. The contrast test parses `globals.css` instead of a separate data file, to keep tokens "defined once" (AC6). **Rejected:** a component gallery route or demo states on `/`, which would add mock data to a shipped page.
- **Risks list:** all mitigations above are incorporated (hydration, ICU, R1 leakage, R2 floats, R5 literals, yellow/cyan contrast, no auth placeholders).

## Assumptions
Ming confirms these after the fact. None blocks implementation.
1. **Styling stack:** Tailwind CSS v4 (+ `@tailwindcss/postcss`) and `lucide-react` are added to `apps/web`. shadcn/ui (Radix) is deferred to the first screen ticket that needs Sheet/Dialog/Tabs. recharts is deferred to the chart tickets. This is stack-adjacent (the brief names these libraries) and is flagged for Ming.
2. **Phone navigation:** a bottom tab bar with 5 short labels below 1024px, and a fixed sidebar at ≥1024px. This replaces the brief's "collapsible sidebar" drawer and avoids a focus-trapped drawer. Short labels are Tổng quan / Giao dịch / Nhập / Theo dõi / Cài đặt. Full labels appear in the sidebar.
3. **Number display:** Vietnamese convention, with dots for thousands and a comma for decimals. Prices show in thousand VND with 2 decimals ("125,40"). Money shows as "1.234.567 ₫" (NBSP before ₫). The minus sign is ASCII "-". If Ming prefers the TCBS dot-decimal style ("125.40"), the change is two separator constants in `format.ts` plus test strings.
4. **Percent unit:** `formatPercent` takes integer ppm (1% = 10_000), consistent with `feeRatePpm`. Later P&L/weight code in core must output ppm.
5. **Disclaimer placement:** `DisclaimerNote` renders in the shell footer on every page. This is a superset of spec §2.3 ("persistent … on suggestion views"), and it guarantees the notice cannot be missed when suggestion screens arrive.
6. **Freshness indicator:** there is no market-data source yet, so the top bar shows "Chưa có dữ liệu" (`fresh={null}`). It never shows a fabricated timestamp. Wiring is left to the market-data/watchlist tickets.
7. **Symbol detail nav:** `/symbols/*` highlights no nav item. Invalid symbols return 404.
8. **Placeholder pages** use `EmptyState` (heading + "Chưa có nội dung").
9. **App name** stays the brief's placeholder "Stock Assistant" (top bar and `<title>`) until Ming names it.
10. **Time display** uses `Asia/Ho_Chi_Minh` regardless of host TZ, in the format "HH:mm dd/MM/yyyy".
11. **Exact token hex values** are starting points. The implementer may adjust them only to pass the contrast test and must keep the hue family (green/red/yellow-amber/purple/cyan-teal).
12. **Follow-ups (not in this diff):** compact money (tr/tỷ), table-scroll wrapper, PageHeader, shadcn install, wiring the top-bar freshness to real data, restoring auth in `(app)/layout.tsx` when R6 returns.

## Blocking questions
None.

## Split proposal
None. Estimated diff is about 700–900 lines, above the ~400 guide. Roughly half of that is tests and CSS tokens, plus six near-identical placeholder pages and the lockfile (excluded from the count). It is one spec feature (the app shell), and splitting it would leave the ACs unverifiable in either half. If the implementer finds the diff growing beyond about 1,000 lines, stop after step 6 with the work committed, and split: slice A = core formatters/tone/symbol + tokens + 8 components (AC2, 3, 4, 6); slice B = shell + theme + routes (AC1, 5). Record the split in impl-log.

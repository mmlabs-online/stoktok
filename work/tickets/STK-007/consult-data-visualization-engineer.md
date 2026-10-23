# consult-data-visualization-engineer — STK-007

## Findings

**apps/web today**
- Bare scaffold. `app/layout.tsx` has `<html lang="vi">` and a bare body. `app/page.tsx` renders `describeCore()`. There is no CSS, no font, no lint or test script, and no `components/` directory.
- Dependencies are only next 16, react 19 and `@stoktok/core`/`@stoktok/db`. `package.json` has `typecheck` and `lint` but no `test` script. R8 requires `pnpm test`, so confirm the root script handles web.
- `packages/core` is consumed as TS source (`exports: ./src/index.ts`), has Vitest, and already has `money.ts` (BigInt `mulDiv`, `roundDiv`, `isVnd`, `assertVnd`). `index.ts` is an explicit named-export list, so new helpers must be added to it by hand.
- `core` has `Lot.status: 'pending'|'sellable'` and `Lot.sellableFrom` (ISO string). The brief's domain types (Holding, WatchItem and so on) are not in core yet. Components should take narrow structural props, not the brief's whole types.

**Brief vs repo conflicts**
- The brief says "prices in thousand VND with 2 decimals (125.40)". R2 stores integer VND (125400). Resolve this in the formatter: the stored integer is the source of truth, and "125,40" is only display (price / 1000 shown to 2 decimals). That is formatting, not a financial calculation, but it must be done with integer/string math in core, not `/ 1000` in JSX.
- The brief's callbacks and Server Action notes are for later screen tickets. STK-007 only needs props-only components.
- The brief says "no router library, in-app state". STK-007 AC says real routes, so use the Next router and `usePathname` for active nav.

**Price color facts**
- VN board: up green, down red, reference yellow, ceiling purple, floor cyan. These are the five colors in CLAUDE.md. Yellow and cyan on white fail 4.5:1 as text (yellow about 1.5–2:1, cyan about 1.8–2.5:1). A single hex per color will not work for both themes.
- Red and green carry meaning alone in the standard board. About 8% of men have CVD, so color-only encoding is a real accessibility defect.

## Recommendations

### 1. Styling approach (flag for Ming)
Recommend **Tailwind v4 (CSS-first, `@theme` tokens) plus lucide-react, and no shadcn/ui in STK-007**. The reasoning:
- The brief's Prompts 2–6 need Sheet, Dialog, AlertDialog, Tabs, Combobox and Switch. Those are the shadcn/Radix payload and belong to the screen tickets. Pulling in Radix, cva, clsx and tailwind-merge now adds supply-chain surface and `components/ui/*` churn for 8 simple presentational components that need none of it.
- Shadcn is copy-in source, so it can be added later with no rework. Tailwind classes compose with it.
- Tailwind over CSS modules:
  - The brief's `dark:` approach and shadcn's token model both assume Tailwind. Choosing modules now means a second styling system when a Dialog or Sheet arrives.
  - Dense tables and responsive utilities (`overflow-x-auto`, `md:` breakpoints) are cheaper in utilities.
  - Tokens defined once in `@theme` become both CSS variables and utilities, which satisfies the "defined once, reused" AC.
- CSS modules are the right call only if Ming wants zero build-time dependencies. The cost is hand-rolled dark mode, no utility reuse, and a likely migration later. Do not pick plain CSS to save a dependency.
- Add lucide-react (tree-shaken, per-icon imports). Recharts is out of scope for this ticket (charts belong to the dashboard and symbol tickets), so do not install it.
- Do not install a theming package such as next-themes. Implement the toggle yourself (see §2).

### 2. Design tokens and theming
- File: `apps/web/app/globals.css`, imported once in `layout.tsx`. Use semantic CSS variables (`--color-bg`, `--color-surface`, `--color-border`, `--color-fg`, `--color-fg-muted`, `--color-accent`, `--color-warn`) on `:root` and on `.dark`.
- Expose them with Tailwind `@theme inline`. Use `@custom-variant dark (&:where(.dark, .dark *))` so the toggle is class-based.
- Typography: system font stack. Use `font-variant-numeric: tabular-nums` through a `.num` utility, and a mono stack for number columns. No webfont, since the home server is behind a tunnel and CLS and latency matter.
- Spacing and radius: use Tailwind's default scale and add only `--radius`.
- Dark mode toggle:
  - Tri-state (system, light, dark), persisted in `localStorage`.
  - Add a small blocking inline script in `<head>` that sets the `.dark` class before paint, to avoid flash. Put `suppressHydrationWarning` on `<html>`.
  - The toggle button is the only `"use client"` piece in the top bar. Give it an `aria-label` in Vietnamese and `aria-pressed` or a visible state.
- **Five price colors** are tokens `--price-up|down|ref|ceiling|floor`, each defined per theme. They are text colors and must hit at least 4.5:1 on `--color-surface`. Starting values to verify with a contrast checker, not to trust blindly:

| Token | Light (on white) | Dark (on about #0f172a) |
|---|---|---|
| up | #15803d | #4ade80 |
| down | #b91c1c | #f87171 |
| ref | #a16207 (amber-700) | #facc15 |
| ceiling | #7e22ce | #c084fc |
| floor | #0e7490 (cyan-700) | #22d3ee |

  - In light mode, yellow and cyan only pass when darkened to amber-700 and cyan-700. They read as "dark gold" and "teal", which is acceptable because the position and the label disambiguate.
  - Also define a matching `-bg` tint token per color (about 10–15% alpha) for badges and row highlights, so the pair is verified together.
- **Do not carry meaning in hue alone** (rule 5). Always pair with a glyph: ▲ / ▼ / ■ (or "=") for up/down/ref, and a text tag "Trần" / "Sàn" for ceiling/floor. A sign (`+`/`−`) on the number is cheap and also works in grayscale. Red vs green can then be confused without loss of meaning.
- Put the semantic state (`'up'|'down'|'ref'|'ceiling'|'floor'`) in a `PriceTone` type and map tone to a class in one lookup table in the component file. Components must not compare prices to decide tone (that would be a calculation and breaks R1). Tone is computed in core and passed in (see §4).

### 3. Component APIs (all presentational, server components unless noted)
Use narrow props. Numbers arrive pre-computed. Strings for display come from core formatters called inside the component (formatting, not calculation).

- `MoneyText({ vnd: number; signed?: boolean; tone?: PriceTone; compact?: boolean })`
  - Calls `formatVnd`. The `.num` class, right-aligned by the parent cell.
  - `null` or `undefined` renders "—".
  - Set `title` to the full unabbreviated value when `compact`.
- `PriceChange({ change: number; changePct: number; tone: PriceTone; showPct?: boolean; price?: number })`
  - `change` is integer VND and `changePct` is the core's number (or integer basis points, see §4).
  - The glyph is chosen by `tone`, not by comparing `change` to 0. The text always includes the sign. Optionally add a visually hidden "tăng/giảm/đứng giá" for screen readers.
- `DataFreshnessBadge({ fresh: boolean; updatedAt?: string; label?: string })`
  - Stale: warning style, an icon plus the text "Dữ liệu cũ". Fresh: render a muted "Cập nhật HH:mm" or nothing (add a `hideWhenFresh` prop).
  - Accept a pre-formatted or ISO `updatedAt` and format it with the core formatter. The component must not compute staleness from `Date.now()`, because that is R4 logic and would make the render impure and break hydration. The caller or core supplies `fresh`.
  - Use `role="status"` only for the top-bar indicator, not per row.
- `LotStatusBadge({ status: 'pending'|'sellable'; sellableFrom: string })`
  - Pending: "Chưa về (T+2)" with the date. Per the brief's acceptance, it must be unmistakable. The wording must come from the `settlementDays` prop, not a hard-coded "T+2" (R5). Take `settlementDays?: number`, default to omitting the "(T+n)" suffix.
  - Sellable: "Được bán" with an icon.
  - Use the same `Lot['status']` type from core.
- `SymbolLink({ symbol: string; className? })`
  - Wraps `next/link` to `/symbols/${encodeURIComponent(symbol.toUpperCase())}`. Uppercase and validate the symbol (A-Z0-9, length 3–10) in a core `normalizeSymbol` helper to avoid a malformed path.
  - Mono, bold, and an underline on hover or focus.
- `StatCard({ label: string; value: ReactNode; sub?: ReactNode; tone?: PriceTone; icon?: ReactNode })`
  - The `value` is typically `<MoneyText>` or `<PriceChange>`, so the card stays free of formatting logic.
  - Use a `dl` / `dt` / `dd` structure for accessibility. Grid: `grid-cols-2 lg:grid-cols-3`.
- `EmptyState({ title: string; description?: string; icon?: ReactNode; action?: ReactNode })`
  - The action is a slot. The component is not client, and the screen supplies a `<Link>` or button.
- `DisclaimerNote({ className? })`
  - The text is a constant exported from one place ("Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư"), as it is legal posture (spec §2.3). Do not make it a prop, so it cannot drift per screen. Render it in the shell footer as well, or at least on every screen that shows signals. Ask the planner which.
- Shared types and conventions:
  - Export `PriceTone` from `components/tone.ts`, or from `core` if the tone derivation helper lives there.
  - Barrel `components/index.ts` is optional. Avoid it to keep client boundaries tree-shakeable.
  - No `reduce(`, `*`, `/` or `Math.` in JSX (a lint or grep check can enforce AC 6).

### 4. Which helpers belong in packages/core
New `packages/core/src/format.ts` (the brief's path) plus tests, exported through `index.ts`:
- `formatVnd(vnd: number, opts?)` → "1.234.567 ₫" or without symbol. Uses `vi-VN` grouping with a **fixed locale and explicit options**, not the host default. Node ICU differences are a real risk (full-icu is the default in modern Node, but pin it with tests). `assertVnd` first (R2), so a float throws. Handles negative numbers with a true minus (U+2212) or "-" (pick one and test). `compact` form (tr / tỷ) for stat cards must be exact integer math via BigInt, not floating division.
- `formatPrice(vnd: number)` → thousand-VND display "125,40" from integer VND, using integer division and remainder plus `padStart`. No float. Note HOSE tick sizes are 10 VND, so 2 decimals is exact, but keep rounding through `roundDiv` for odd inputs.
- `formatPercent(...)`: **decide the input unit**. Recommend accepting integer parts-per-million, which matches the existing `*Ppm` fields (`feeRatePpm`), or basis points. The caller is core's P&L, not the UI. Avoid taking a float, because it drifts toward UI-side division. Output "+1,23%" with the sign option.
- `formatQuantity(n: number)` → grouped integer.
- `formatDate(iso: string)` → "dd/MM/yyyy", pure string manipulation on `YYYY-MM-DD` with **no `Date` and no timezone**. `formatDateTime(iso)` → "HH:mm dd/MM" in `Asia/Ho_Chi_Minh`, using `Intl.DateTimeFormat` with the `timeZone` set explicitly. Test with a TZ other than VN to prove it is independent of the host. Server and browser must agree, or hydration warnings appear.
- `priceTone({ price, ref, ceiling, floor })` → `PriceTone`. This is a comparison with market meaning, so it is R1 logic and goes in core. It takes the same integer VND values and has tests for boundaries (price equal to ceiling is "ceiling", equal to ref is "ref"). Ceiling and floor come from configuration (R5), never hard-coded here. `changeTone(change)` is the simple sign form for rows without board data.
- `normalizeSymbol(raw)`.
- Do **not** put in core: tone-to-CSS-class mapping, glyph choice, Vietnamese UI label strings that are purely presentational (those stay in web). Keep `core` free of React and CSS.
- Unit tests (R8): table-driven in `format.test.ts`. Cover zero, negative, very large (above 2^31, near safe-int limits), non-integer input throws, and ICU independence (assert exact strings including the separator characters; watch for NBSP U+00A0 before "₫" in `Intl` output, so either normalize or build the string manually). Building by hand (group digits with a regex on the integer string) is more deterministic than `Intl.NumberFormat` and is recommended for money.

### 5. Shell layout at phone width (375px)
- Structure: `app/layout.tsx` stays minimal (html, body, theme script, globals.css). Put the shell in a route group `app/(app)/layout.tsx`, matching the brief's port table. All 6 routes sit inside it. The group also leaves room for a future `(auth)` or login group without moving files.
- Top bar: sticky, height about 48–56px. Left: hamburger (below `lg`) and the app name "Stock Assistant". Right: freshness indicator, then theme toggle. At 375px, show the freshness indicator as an icon plus a short text, and move the full "cập nhật lúc..." time into its `title` / the drawer.
- Sidebar:
  - At `lg` and up: fixed left column about 224px.
  - Below `lg`: an off-canvas drawer opened by the hamburger. This is the only substantial client state in the shell. Needs: focus trap or `inert` on the main content when open, Esc to close, close on route change, and `aria-expanded` / `aria-controls` on the button.
  - Cheaper alternative worth weighing: a **bottom tab bar** with the 5 items on phones (5 icons plus short labels fit 375px at about 75px each), with no drawer, no focus trap and no client state beyond `usePathname` for the active item. This is thumb-friendly and the lowest-risk way to meet "works at phone width". Recommend it if Ming agrees. Keep a sidebar on `lg+`. Both can render the same nav-items array (single source of truth in `components/shell/nav.ts`), and the labels are Vietnamese: Tổng quan, Sổ giao dịch, Nhập sao kê, Danh sách theo dõi, Cài đặt.
  - Reserve bottom padding on `main` (plus `env(safe-area-inset-bottom)`) so content is not hidden behind the bar.
- Active item: use `usePathname()` in a small client `NavLinks`. Mark with `aria-current="page"`, not color alone. Symbol detail (`/symbols/...`) highlights nothing, or highlights Tổng quan; ask the planner.
- Overflow: `body { overflow-x: hidden }` is a band-aid and hides bugs, so avoid it. Prefer `min-w-0` on flex and grid children and a `.table-scroll` wrapper (`overflow-x-auto` inside the card) for future tables. Provide that wrapper as a tiny shared piece now, because every screen ticket needs it (the brief's "table scrolls inside its card" requirement). It is not in the AC list, so the planner can decide whether it counts as in scope (R7).
- Tap targets: at least 44px height for nav and toggle on phones.
- Viewport: Next sets the meta viewport by default. Use `min-h-dvh`, not `100vh`, to avoid mobile browser-chrome jump.

### 6. Testing presentational components cheaply
- Start with the core: `format.ts` and `priceTone` carry most of the logic, and they are plain Vitest in `packages/core` with no DOM.
- For components, **avoid a jsdom plus Testing Library setup in this ticket** unless the planner wants it. Cheaper options:
  1. **`react-dom/server` `renderToStaticMarkup`** inside Vitest with the `node` environment. The components are server components or simple client components with no hooks at render, so this works with zero extra dependencies (react-dom is already installed). Assert on text, the tone class, the `aria-*` attributes and the glyph. Cases:
     - PriceChange for each of the five tones.
     - LotStatusBadge pending vs sellable, and the `settlementDays` suffix.
     - DataFreshnessBadge stale vs fresh.
     - MoneyText with null and with a negative value.
     - SymbolLink href encoding.
  2. A small **tone-table test**: iterate all `PriceTone` values and assert each has a class and a glyph, so adding a sixth value fails the build. This guards the "color is never alone" rule mechanically.
  3. A **grep guard** (a Vitest test that reads `apps/web/components/**/*.tsx` and `app/**` and fails on `reduce(`, `.toFixed(`, `Math.` or arithmetic in JSX). This enforces R1/AC 6 cheaply. Allow-list the few legitimate cases explicitly.
- Wiring: web needs a `vitest.config.ts` (the `@/` alias if used, jsx automatic via esbuild `jsx: 'automatic'`) and a `test` script. Ensure the root `pnpm test` runs it. Name this as an explicit plan step, since R8 depends on it.
- Contrast: put the token hex pairs in a data file and add a Vitest that computes the WCAG ratio (about 15 lines of pure code) and asserts at least 4.5 for text tokens in both themes. That turns the contrast requirement into a regression test and removes the need to eyeball it. It is a test helper, not UI logic.
- Skip Playwright (e2e is "later") and skip Storybook. Manual check list for the reviewer: 375px width in dark and light, no horizontal page scroll, keyboard focus order through the shell, and the CVD check (Chrome devtools rendering emulation: deuteranopia and protanopia) on the five-tone demo.
- Optional low-cost visual harness: a temporary dev-only `/` page, or the empty page for `/`, showing every component in every state. This is useful for the reviewer, but it should not ship as a route beyond what the AC lists. Prefer rendering the states inside the Tổng quan placeholder, or discard before merge.

## Risks
- **Tailwind choice is a stack-adjacent decision.** CLAUDE.md says do not change the stack without Ming. The brief names Tailwind, shadcn and lucide, and the ticket tells the planner to pick and flag. Treat it as flagged, not decided. Do not add shadcn or recharts silently.
- **Hydration mismatch** from dates and locale: any `new Date()` or host-timezone formatting in a server component that also renders in the client. Mitigate with string-based dates and the explicit `Asia/Ho_Chi_Minh` zone.
- **Theme flash and hydration warning** if the dark class is applied after paint, or without `suppressHydrationWarning` on `<html>`.
- **Locale-dependent output** (`Intl` NBSP, ICU data) breaking tests across machines or CI. Mitigated by hand-built money formatting and exact-string tests.
- **R1 leakage by convenience:** deciding tone (`price > ref`), staleness (`Date.now() - updatedAt`), or "T+2" inside components. All three have a tempting one-liner. The API in §3 deliberately removes those inputs.
- **R2:** the brief's "125.40 thousand VND" can lead an implementer to store or pass floats. Components must accept integer VND only, and `formatPrice` must reject non-integers via `assertVnd`.
- **R5:** hard-coded "T+2", "±7%", and "100" lot size in labels. Take these from settings props.
- **Yellow and cyan text** at insufficient contrast in light mode is the most likely accessibility failure. Mitigated by the darker light-theme values and the contrast test above.
- **Scope creep (R7):** the drawer, table-scroll wrapper, Radix dialogs, charts and a login-like layout group. Keep the ticket to the AC.
- **Missing web test script and lint config:** R8 cannot be satisfied for web components until they exist. A planning step, not a surprise during implementation.
- **R6 suspended:** the shell must contain no auth code. Keep the layout free of user menus or sign-out placeholders, which would imply auth.

## Open questions
1. Ming: approve Tailwind v4 plus lucide-react now and defer shadcn/Radix to the first screen ticket that needs a Sheet/Dialog (recommended), or install shadcn in STK-007?
2. Phone navigation: bottom tab bar (recommended, cheapest) or an off-canvas drawer as the brief's "collapsible" implies?
3. Percent input unit for `formatPercent`: ppm (consistent with `feeRatePpm`), basis points, or a decimal string produced by core's P&L code? The STK that builds P&L should agree on one.
4. Should `DisclaimerNote` appear in the shell footer on every page, or only on signal and recommendation screens (spec §2.3 wording decides)?
5. Does the freshness indicator in the top bar have a data source in this ticket? Likely a static prop or placeholder until the market-data tickets land. Confirm it renders from props with a "chưa có dữ liệu" state, not a fabricated timestamp.
6. Do the placeholder pages need `EmptyState` (nice demonstration of the component) or a plain heading? The AC says "empty pages inside the shell".
7. Is a `table-scroll` wrapper and a `PageHeader` component acceptable in scope, given they are not in the AC list but every screen ticket would otherwise reinvent them (R7)?
8. Is `vi-VN` decimal comma ("125,40") what Ming wants on screen, or the brief's dot form ("125.40")? Vietnamese convention is comma decimal and dot thousands, but a trading app may prefer the TCBS display style.

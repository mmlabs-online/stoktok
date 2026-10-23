# Impl log — STK-007

## Attempt 1 — 2026-10-23

### Files touched
| File | Required because |
|---|---|
| packages/core/src/format.ts, format.test.ts | AC3 formatters (integer VND/ppm, hand-built, VN time zone) |
| packages/core/src/tone.ts, tone.test.ts | tone decision is price logic (R1) |
| packages/core/src/symbol.ts, symbol.test.ts | `normalizeSymbol` for SymbolLink and symbol route |
| packages/core/src/index.ts | export new functions and `PriceTone` |
| apps/web/package.json, pnpm-lock.yaml | tailwindcss, @tailwindcss/postcss, lucide-react, vitest, `test` script |
| apps/web/postcss.config.mjs, vitest.config.ts | Tailwind plugin; node-env tests (JSX via `oxc: { jsx: { runtime: 'automatic' } }` because installed Vite 8 uses oxc, the esbuild option is ignored) |
| apps/web/app/globals.css | single token source |
| apps/web/app/layout.tsx | globals, metadata, no-flash theme script |
| apps/web/app/page.tsx | deleted; `/` moved into `(app)` group |
| apps/web/app/(app)/layout.tsx, page.tsx, transactions/, import/, watchlist/, settings/, symbols/[symbol]/page.tsx | six routes inside the shell (no auth) |
| apps/web/components/shell/{nav.ts,nav-links.tsx,theme.ts,theme-toggle.tsx,app-shell.tsx} | shell |
| apps/web/components/{tone.ts,price-change,money-text,data-freshness-badge,lot-status-badge,symbol-link,stat-card,empty-state,disclaimer-note}.ts(x) | 8 shared components + tone map |
| apps/web/components/{tone.test.ts,components.test.tsx}, shell/nav.test.ts, apps/web/test/{no-calc-in-ui,contrast}.test.ts | tests per plan |

### Tests added / changed
- core: format (VND, price, percent, quantity, date, datetime), tone (priceTone, changeTone, PRICE_TONES), symbol
- web: tone completeness, nav, components SSR (incl. AppShell with mocked `usePathname`), no-calc guard, contrast (both themes)

### Checks (actual output summary)
- pnpm install: ok (lockfile updated)
- typecheck: all 4 projects pass
- lint: all pass, no warnings
- test: core 82 passed, db 33 passed + 1 todo, web 44 passed
- build: success; routes `/`, `/transactions`, `/import`, `/watchlist`, `/settings`, `/symbols/[symbol]`
- check:service-key: OK, no service key material in client bundle
- Greps: no hex in tsx; `"use client"` only in nav-links.tsx and theme-toggle.tsx; no auth code.
- Manual 375px/1280px browser check: NOT performed (no browser in this environment). Tailwind utilities verified present in built CSS.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Those listed in plan Assumption 12.
- Manual visual check at 375px and 1280px, light and dark, still to be done by a human.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: roughly +1100 lines including tests and lockfile-excluded code; no split needed.

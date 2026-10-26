## Attempt 1 — 2026-10-26
Verdict: PASS

Scope: plan.md slice 1 only (AC1, AC3, AC5, AC6). AC2 → STK-034, AC4 → STK-035 (orchestrator). R6 waived (suspended).

### Checks (run by reviewer)
- typecheck: green (core, db, web incl. `next typegen`, worker)
- lint: green (all 4 workspaces)
- test: core 347/347, db 100 passed + 1 todo, worker 65/65, web 176/176 (20 files). Matches impl-log.md.

### Acceptance criteria
- [x] AC1 Header: last price, change, ref/ceiling/floor with VN colors, freshness badge — evidence: `load-symbol.test.ts › header comes from buildPriceBoardRow` (ref 120,000 / ceiling 128,400 / floor 111,600, `getRecentCloses(db, ['FPT'], 2)`), `› ex-date…`, `› stale close…`, `› UPCOM sets refEstimated`; `symbol-detail.test.tsx:61` (TC/Trần/Sàn tone classes, Phiên, source), `:73` (Dữ liệu cũ, flag reasons, "—" for null limits). Component reuses exported `LimitValue`/`Close`/`Status` (`symbol-header.tsx`).
- [x] AC3 Position card + lots table with pending/sellable and sellable date, values from core — evidence: loader tests `position equals core` (400 / sellable 300 / avg 100,000 / P&L 10,000,000), `lots… pending sellableFrom 2026-10-26`, `partial sell…multiple lots`, `stock dividend lot`, `cash dividend`, `fully sold → closed`, `watched-only → none`, `no stored price → missing`, `OVERSELL elsewhere → ledgerError`; `symbol-detail.test.tsx:110-137`. Loader only filters/selects (`load-symbol.ts:87-110`); `no-calc-in-ui.test.ts` green.
- [x] AC5 Transactions for this symbol, linking to ledger — evidence: loader test `transactions are this symbol only, newest first, capped, with ledgerHref` (10 of 12, newest id 12, `/transactions?symbol=FPT`); page renders `<Link href={view.ledgerHref}>Xem sổ giao dịch</Link>` (`page.tsx`, transactions section). Ordering relies on `listTransactions` trade_date/seq asc (pinned in `packages/db/src/repos/transactions.test.ts:30`).
- [x] AC6 Unknown symbol → not-found; server-side load — evidence: loader tests `returns null…` and five `each single source makes the symbol known` cases; `page.tsx` invalid format → `notFound()`, `null` view → `notFound()`; `export const dynamic = 'force-dynamic'`; loader is server-only with the `requireUser()` TODO comment. "Behind auth" waived (R6 suspended).

### Issues
None.

### Rules R1–R10
No violations found. R1: no arithmetic in new `.tsx`; numbers from `buildPriceBoardRow`/`buildLedger`/`buildPortfolio`. R2: integer VND, core formatters. R3: `getDb()` only in server page/loader. R4: header and price show source/fetchedAt and stale badge. R5: limits, settlement days, holidays from rules/settings; threshold via `resolveConcentrationThreshold`. R6: suspended, no auth code added (correct). R7: all changed files are in the plan's file list; work/ files are workflow artifacts (STK-034/035 tickets created by orchestrator).

### Nits (do not block)
- `symbol-detail.test.tsx:147` test is named "links to /transactions?symbol=FPT" but asserts `/symbols/FPT` on `TransactionList`; the ledger link itself is only pinned via the loader's `ledgerHref`. Rename the test, or extract the section so the link is rendered under test. (Disclosed in impl-log.)
- `position-card.tsx` OVERSELL message prints `e.date` as raw ISO (`2026-10-20`); `formatDate(e.date)` would match the rest of the page. Non-OVERSELL codes show `e.message` (likely English).
- `load-symbol.ts` `row as PortfolioRow` cast hides the possibly-undefined `rows[0]`; an explicit guard would be clearer.
- `load-symbol.test.ts › cash dividend` asserts only `> 0`; an exact expected value would be stronger.

### Follow-ups (out of scope)
- Carried from plan: UPCoM reference = previous average price; special price-limit cases; ex-dates for watched-only symbols; watch/unwatch toggle.
- Before STK-018 go-live: this page exposes portfolio data with no auth (R6 suspended) — Ming decides (restore R6 or Cloudflare Access).

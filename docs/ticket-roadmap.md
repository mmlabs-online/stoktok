# stoktok — Ticket Roadmap (v1)

> Source: [spec-v1.md](spec-v1.md) §3 Features, §4 Architecture, §7 Deployment, §10 Roadmap.
> Created: 2026-10-22. Existing tickets: STK-001 … STK-005. New IDs below are **expected** — `/ticket` assigns the real next ID.

## How to use

- **Create one phase at a time.** Tickets for later phases go stale as the code changes; create v1.1 only when v1.0 is close to done.
- Either paste the **batch prompt** for a phase into Claude Code (creates every ticket in that phase), or paste the single `/ticket` lines one by one.
- Tickets marked **⛔ needs input** will stop at PLAN (`BLOCKED`) until Ming supplies what is listed. Create them anyway so they are on the board, or hold them back — both are fine.

## Decisions / inputs still needed

| Input | Needed by | Spec |
|---|---|---|
| How Authen hands over and signs the token | STK-004 | §9 Q1 |
| Sample TCInvest statement export (CSV) | Statement import, TCBS reconciliation | §9 Q2, Q3 |
| Primary/fallback market data source after license check | STK-005, financials, intraday | §9 Q4 |
| UI from Figma Make (link to the Make file) | All UI tickets | `docs/figma-make-prompts.md` |
| News sources list | News ingestion | §9 Q5 |
| LLM provider | AI tickets | §9 Q6 |
| Subdomain for the app | Deployment | §9 Q7 |

---

## Phase v1.0 — Ledger, portfolio, EOD data, medium-term signals

Already on the board: STK-001 (done), STK-002 (done), STK-003 schema, STK-004 auth, STK-005 EOD prices.

| Expected ID | Ticket | Prio | Depends on | Input needed |
|---|---|---|---|---|
| STK-006 | Server data layer for ledger, assets, settings | P1 | 003, 004 | — |
| STK-007 | App shell and shared UI components from Figma Make | P1 | 001 | ⛔ Figma Make link |
| STK-008 | Transactions ledger screen | P1 | 006, 007 | — |
| STK-009 | Portfolio dashboard and other assets | P1 | 006, 007, 005 | — |
| STK-010 | Settings screen | P2 | 006, 007 | — |
| STK-011 | Watchlist screen | P2 | 005, 006, 007 | — |
| STK-012 | Statement CSV import and reconciliation | P2 | 006, 008 | ⛔ sample statement |
| STK-013 | Reconcile ledger defaults with a real TCBS statement | P2 | 012 | ⛔ sample statement |
| STK-014 | Quarterly financials adapter | P2 | 003, 005 | ⛔ data source |
| STK-015 | Medium-term signal rules and job | P2 | 005, 014 | — |
| STK-016 | Symbol detail screen | P2 | 009, 015 | — |
| STK-017 | Docker images and CI build | P2 | 001 | — |
| STK-018 | Deployment to the WSL server | P2 | 017 | ⛔ subdomain |

### Batch prompt — v1.0

```
Create the following tickets using the /ticket procedure in .claude/commands/ticket.md, one ticket per item, in this order. Use the title as given, derive acceptance criteria from docs/spec-v1.md and the notes, set the given priority and areas, and add the "Depends on" and "Input needed" notes to each ticket's "Notes / answers from Ming" section. Do not merge items. When all are created, commit work/ as "Add v1.0 tickets" and push to main.

1. Server data layer for ledger, assets, settings — P1 — areas: db, security
   Server-only repositories (service role, R3) for transactions, corporate_actions, assets, settings, watchlist using the row↔core mappers from STK-003. Every entry point calls the STK-004 auth helper (R6). Ledger reads feed packages/core buildLedger; no calculation outside core (R1). Depends on: STK-003, STK-004.

2. App shell and shared UI components from Figma Make — P1 — areas: ui
   Port the Figma Make shell (sidebar, top bar, light/dark, freshness indicator) and shared components (PriceChange, MoneyText, DataFreshnessBadge, LotStatusBadge, SymbolLink, StatCard, EmptyState, DisclaimerNote) into apps/web per docs/figma-make-prompts.md "Export & port checklist". Formatting helpers live in packages/core. Routes exist as empty pages. Input needed: Figma Make file link.

3. Transactions ledger screen — P1 — areas: ui, finance
   Spec §3 F1 (manual entry part). List with filters and pagination; add/edit/delete transaction; add corporate action; validation (lot size with odd-lot option, price > 0, sell ≤ sellable quantity from core). Server actions only. Depends on: data layer, app shell.

4. Portfolio dashboard and other assets — P1 — areas: ui, finance
   Spec §3 F2. Holdings from core with latest daily prices, unrealized/realized P&L, weights and concentration warning, net worth with cash and other assets (CRUD for assets). Stale prices flagged (R4). Depends on: data layer, app shell, STK-005.

5. Settings screen — P2 — areas: ui
   Fee rate, sell tax, price limits per exchange, settlement days, lot size, concentration threshold, cash dividend treatment; values stored in settings and used by core (R5). Signal rule parameters section is added by the signals ticket. Depends on: data layer, app shell.

6. Watchlist screen — P2 — areas: ui, data
   Spec §3 F3. Groups Holdings (auto) and Watching (manual add/remove); price board with ref/ceiling/floor colors from daily data; last update time and freshness badge. Depends on: STK-005, data layer, app shell.

7. Statement CSV import and reconciliation — P2 — areas: data, finance, ui
   Spec §3 F1 import + reconciliation. Parse a TCInvest statement export, preview rows as new/duplicate/error, import new rows as transactions with source=import and a batch id, then show quantity differences per symbol vs the statement. Input needed: a real sample statement (account number masked).

8. Reconcile ledger defaults with a real TCBS statement — P2 — areas: finance
   Using the sample statement, verify the four STK-002 defaults: weighted-average cost incl. buy fee, cash dividend treatment (reduceCost vs income), rounding mode, bonus shares sellable from listing date. Adjust settings defaults and CLAUDE.md wording to match; add regression tests from real rows. Depends on: statement import. Input needed: sample statement.

9. Quarterly financials adapter — P2 — areas: data, db
   FinancialsSource interface + one implementation (EPS, BVPS, revenue, net income per quarter) and a sector mapping per symbol; migration for financials; worker job with source and fetched_at (R4); fixture-based tests only. Input needed: data source after license check.

10. Medium-term signal rules and job — P2 — areas: finance, db
    Spec §3 F4 medium-term rules in packages/core (P/E and P/B vs sector, earnings growth trend, price vs 50/200-day MA), configurable parameters (R5), suppressed on stale or gapped data, inputs snapshot stored; signals table migration; worker job after EOD; rule params section on the Settings screen. Depends on: STK-005, financials.

11. Symbol detail screen — P2 — areas: ui, finance
    Header with price and ref/ceiling/floor, price + volume chart with range tabs and gap markers, position card, lots with T+2 status, medium-term signals (hidden when data is stale), transactions for the symbol. Depends on: dashboard, signals.

12. Docker images and CI build — P2 — areas: architecture, security
    Dockerfiles for apps/web (Next.js standalone) and apps/worker; GitHub Actions on hosted runners runs typecheck/lint/test, builds and pushes images to the Docker Hub account used by other mmlabs apps on main. No secrets in images or the repo.

13. Deployment to the WSL server — P2 — areas: architecture, security
    Compose service definitions (web, worker) to add to the shared mmlabs deploy repo, Cloudflare Tunnel route for the app subdomain, env variable list, and a short runbook (deploy, rollback, logs). Worker restarts are safe (idempotent jobs). Input needed: subdomain.
```

### Single `/ticket` lines — v1.0

```
/ticket "Server data layer (service role, server-only) for transactions, corporate actions, assets, settings, watchlist; uses STK-003 mappers and STK-004 auth helper; depends on STK-003, STK-004" P1
/ticket "App shell and shared UI components ported from Figma Make into apps/web; needs Figma Make link" P1
/ticket "Transactions ledger screen: list, filters, add/edit/delete transaction and corporate action via server actions, validation from core; spec F1" P1
/ticket "Portfolio dashboard: holdings and P&L from core with daily prices, weights and concentration warning, net worth with cash and other assets CRUD; spec F2" P1
/ticket "Settings screen: fees, tax, price limits, settlement days, lot size, concentration threshold, cash dividend treatment (R5)" P2
/ticket "Watchlist screen: holdings and watching groups, price board with VN colors and freshness badge; spec F3" P2
/ticket "TCInvest statement CSV import with preview (new/duplicate/error) and reconciliation; needs sample statement; spec F1" P2
/ticket "Reconcile STK-002 ledger defaults (avg cost incl. fee, cash dividend treatment, rounding, bonus share sellable date) with a real TCBS statement; needs sample statement" P2
/ticket "Quarterly financials adapter (EPS, BVPS, revenue, net income) and sector mapping, with source and fetched_at; needs data source decision" P2
/ticket "Medium-term signal rules in core (P/E, P/B vs sector, earnings growth, price vs MA50/MA200), stale-data suppression, signals table and EOD job; spec F4" P2
/ticket "Symbol detail screen: price chart with gaps, position, lots with T+2 status, medium-term signals, symbol transactions" P2
/ticket "Dockerfiles for web (Next.js standalone) and worker, GitHub Actions CI and image push to Docker Hub" P2
/ticket "Deployment: compose services for the mmlabs deploy repo, Cloudflare Tunnel route, env list and runbook; needs subdomain" P2
```

---

## Phase v1.1 — Intraday data and short-term signals

Create when v1.0 is close to done.

| Expected ID | Ticket | Prio | Depends on | Input needed |
|---|---|---|---|---|
| STK-019 | Trading calendar and exchange holidays | P1 | v1.0 | ⛔ holiday data source |
| STK-020 | Intraday price polling during trading sessions | P1 | 019 | — |
| STK-021 | Gap detection across intraday and daily data | P1 | 020 | — |
| STK-022 | Short-term signal rules and job | P1 | 020, 021 | — |
| STK-023 | Per-holding stop-loss thresholds | P2 | 022 | — |

### Batch prompt — v1.1

```
Create the following tickets using the /ticket procedure in .claude/commands/ticket.md, one per item, in order, deriving acceptance criteria from docs/spec-v1.md (§2.2, §3 F4, §4.4) and the notes. Put dependencies and needed inputs in "Notes / answers from Ming". Commit work/ as "Add v1.1 tickets" and push to main.

1. Trading calendar and exchange holidays — P1 — areas: data
   Configurable trading sessions (continuous, ATO/ATC) and exchange holiday list with a documented data source; core helpers for "is trading day / session open" used by jobs and settlement dates. Input needed: holiday data source.

2. Intraday price polling during trading sessions — P1 — areas: data, db
   prices_intraday migration; worker polls watchlist symbols every few minutes only while a session is open; source and fetched_at on every row (R4); polling interval in settings; fixture-based tests.

3. Gap detection across intraday and daily data — P1 — areas: data, db
   Detect missing polls and missing trading days (using the trading calendar), write data_gaps, expose freshness per symbol to the UI; signals must check it.

4. Short-term signal rules and job — P1 — areas: finance, db
   Spec §3 F4 short-term rules in packages/core: MA crossovers, RSI extremes, volume spike vs N-day average, foreign net flow, breakout/breakdown; configurable params (R5); suppressed on stale/gapped data; computed after each intraday poll; shown on symbol detail and dashboard.

5. Per-holding stop-loss thresholds — P2 — areas: finance, ui
   Stop-loss price or % per holding, edited on symbol detail; a "stop-loss hit" short-term signal; respects T+2 sellability when shown.
```

---

## Phase v1.2 — News, AI summaries, suggestions, scorecard

Create when v1.1 is close to done. All AI tickets must satisfy R9.

| Expected ID | Ticket | Prio | Depends on | Input needed |
|---|---|---|---|---|
| STK-024 | News ingestion with source credibility | P1 | v1.1 | ⛔ news sources |
| STK-025 | LLM gateway with citations and schema validation | P1 | — | ⛔ LLM provider |
| STK-026 | Daily AI news summaries | P1 | 024, 025 | — |
| STK-027 | Suggestion engine in core | P1 | 015, 022 | — |
| STK-028 | AI explanations and suggestions screen | P1 | 025, 027 | — |
| STK-029 | Suggestion scorecard | P1 | 027 | — |

### Batch prompt — v1.2

```
Create the following tickets using the /ticket procedure in .claude/commands/ticket.md, one per item, in order, deriving acceptance criteria from docs/spec-v1.md (§3 F5–F7, §6) and the notes. Every AI-related ticket must state rule R9 in its acceptance criteria. Put dependencies and needed inputs in "Notes / answers from Ming". Commit work/ as "Add v1.2 tickets" and push to main.

1. News ingestion with source credibility — P1 — areas: data, db
   NewsSource interface + RSS implementation(s); news migration; hourly job on trading days for watchlist symbols; symbol matching; credibility tag (official disclosure > established outlet; social excluded by default); dedupe; fixture-based tests. Input needed: list of news sources and their terms.

2. LLM gateway with citations and schema validation — P1 — areas: architecture, security
   One server/worker-side module that calls the chosen LLM provider with stored inputs only, requires every factual claim to cite an input ID, validates JSON output against a schema, rejects or strips uncited claims, and logs prompts/outputs for audit. No API key in client code (R3). Input needed: LLM provider.

3. Daily AI news summaries — P1 — areas: data, ui
   After EOD, summarize news per watchlist symbol and for the portfolio through the LLM gateway; each claim links to a stored article; "data unavailable" when inputs are missing; shown on dashboard and symbol detail with DisclaimerNote.

4. Suggestion engine in core — P1 — areas: finance
   Spec §3 F6: deterministic rules turn signals + portfolio context (cash, weights, cost basis, T+2 sellability) into actions (consider buy / consider trim / hold / review stop-loss) with horizon and quantity rounded to lots and capped by cash; suggestions migration with price_at and index_at; no AI in this ticket.

5. AI explanations and suggestions screen — P1 — areas: ui, finance
   LLM gateway writes the rationale for each suggestion from its signals and cited news (it never changes the action, R9); suggestions screen with filters by horizon and a persistent "reference only, not investment advice" notice.

6. Suggestion scorecard — P1 — areas: finance, db, ui
   Spec §3 F7 and §6.3: score every suggestion at 5 and 20 sessions (short term) and 3 and 6 months (medium term) vs price and VN-Index; suggestion_scores migration; daily scoring job; scorecard screen with hit rate, average return vs index, and per-rule performance.
```

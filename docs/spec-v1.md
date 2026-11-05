# Stock Investment Assistant — Spec v1

> Working name: **stock investment assistant** (placeholder — final app name TBD by Ming)
> Owner: Ming · Status: Draft v1 · Date: 2026-10-21
> Ecosystem: mmlabs (auth via Authen) · Stack: Next.js · Hosting: WSL home server

---

## 1. Overview

### 1.1 Goal
A personal app that tracks Vietnamese stock prices and news, keeps Ming's own portfolio and asset records, generates rule-based signals for short- and medium-term trading, uses AI to summarize news and explain signals, and **measures whether its own suggestions turn out right over time**.

### 1.2 Users
- **v1: Ming only.** Login via Authen (shared mmlabs SSO), restricted by an allowlist.
- Not listed in the mmlabs gallery.

### 1.3 Non-goals (v1)
- No login to TCBS or any brokerage account; no use of TCBS iFlash OpenAPI.
- No order placement of any kind (this includes Vietlott tickets: F8 only records tickets bought elsewhere).
- No public or multi-user access to investment suggestions.
- No guaranteed real-time data; no tick-level / scalping use cases.
- AI never decides; it explains rule-based signals. Final decisions are Ming's.

### 1.4 Success criteria
- Portfolio P&L in the app matches the TCBS statement after reconciliation (fees, tax and corporate actions included).
- Every suggestion is logged with price-at-time and scored automatically at its evaluation horizons.
- Every AI statement about a stock either cites a stored source or says data is unavailable.

---

## 2. Context & Constraints

### 2.1 Vietnamese market rules the app must model
All values below are **configuration, not hard-coded**, and must be verified against current exchange and TCBS rules before go-live.

| Rule | Working assumption | Why it matters |
|---|---|---|
| Settlement | T+2: bought shares can be sold from T+2 | Never suggest selling a lot that is not yet sellable |
| Daily price limits | HOSE ±7%, HNX ±10%, UPCoM ±15% | Ceiling/floor distort technical signals; flag limit-hit sessions |
| Board lot | 100 shares (odd lots handled separately) | Suggested quantities rounded to valid lots |
| Trading sessions | Morning + afternoon continuous, ATO/ATC auctions | Intraday polling only during sessions |
| Selling tax | 0.1% of sale value | Realized P&L |
| Brokerage fee | Ming's actual TCBS fee rate (user setting) | Cost basis and P&L |
| Corporate actions | Cash dividends, stock dividends, rights issues | Cost basis adjustment; most common source of P&L drift |

### 2.2 Data constraints
- No official authenticated data feed. Public sources (e.g. the open-source `vnstock` library wrapping public endpoints) are **unofficial and can change or break without notice**. Check each source's license and terms for personal use.
- Intraday data may be delayed. Every price carries a `fetched_at` timestamp and a source.
- The worker runs on Ming's PC. Gaps happen (sleep, Windows Update, network). Gaps must be detected, not silently interpolated.

### 2.3 Legal posture
- Personal use only. Opening suggestions to other users would move the app toward investment advisory activity, which is regulated in Vietnam. Any future public version drops suggestions and keeps tracking + summaries only (decision deferred to Ming).
- The UI shows a persistent "reference only, not investment advice" notice on suggestion views.

---

## 3. Features (v1)

### F1. Transaction ledger
- Manual entry per transaction: date, symbol, side (buy/sell), quantity, price, fee, tax.
- Corporate action entry: cash dividend, stock dividend, rights issue.
- CSV import from a TCBS/TCInvest statement export (format to be confirmed from a real export file).
- Reconciliation view: compare app holdings vs imported statement; highlight differences.

### F2. Portfolio & assets
- Holdings derived from the ledger (never edited directly): quantity, average cost, market value, unrealized/realized P&L.
- Lot tracking with sellable date (T+2) and status: `pending` / `sellable`.
- Cash balance and other assets entered manually; total net worth view.
- Concentration view: weight of each holding; warning above a user-set threshold.

### F3. Watchlist
- Two groups: **Holdings** (auto from portfolio) and **Watching** (manual).
- Price, change, volume, last update time, data-freshness badge.

### F4. Signals (rule-based, computed in code)

| Horizon | Example rules (configurable) | Data |
|---|---|---|
| Short term (days–weeks) | MA crossovers, RSI extremes, volume spike vs N-day average, foreign net flow, breakout/breakdown, stop-loss hit | Intraday + daily OHLCV |
| Medium term (1–6 months) | P/E and P/B vs sector, earnings growth trend, plan completion vs annual target, price vs 50/200-day MA | Daily OHLCV, quarterly financials |

- Signals are suppressed if the underlying data is stale or has gaps.
- Each signal stores its inputs (snapshot) so it can be audited later.

### F5. News summaries
- Collect news for watchlist symbols from configured sources (RSS where available).
- Daily AI summary per symbol and per portfolio, **each claim linked to a stored article**.
- Source credibility tag (official disclosure > established outlet > forum/social, social excluded by default).

### F6. Suggestions
- Generated from signals + portfolio context (cash, weights, cost basis, lot sellability).
- Output: action (`consider buy` / `consider trim` / `hold` / `review stop-loss`), horizon, rationale, triggering signals, cited sources, suggested quantity rounded to lots and capped by available cash.
- AI writes the explanation only; the action comes from rules.

### F7. Suggestion scorecard
- Every suggestion logged with symbol, action, horizon, price at time, VN-Index at time.
- Auto-scored at evaluation points: **short term after 5 and 20 sessions; medium term after 3 and 6 months**.
- Metrics: hit rate, average return vs VN-Index, per-rule performance.
- Purpose: decide which rules to keep or drop based on evidence.

### F8. Vietlott tracker (after v1.2 — Ming, 2026-11-05)
Personal record of Vietlott tickets Ming buys elsewhere (Vietlott SMS, MoMo). **Games: Mega 6/45 and Power 6/55 only**; Max 3D, Lotto 5/35 and Keno are out of scope.
- **Ticket ledger**: game, draw number, numbers (regular and system/"bao" tickets), cost, purchase channel (`sms` / `momo`), purchased_at, status (`pending` / `lost` / `won` + prize tier). Entry by pasting the Vietlott SMS confirmation (parsed) or quick manual entry (MoMo has no API).
- **Results and checking**: the worker fetches each draw's result (with `source` and `fetched_at`, R4), checks pending tickets, and the app shows wins in-app (no push).
- **History per game**: total spent, total won, net, with personal income tax on prizes (10% of the part of a prize above 10,000,000 VND); opportunity cost vs the same money put into VN-Index on the purchase date.
- **Suggestions** (honest by design): draws are random and independent, so no feature claims to predict numbers. Suggestions are random picks that avoid popular combinations (all numbers ≤ 31, runs, arithmetic patterns, previously drawn sets) to lower the chance of **sharing a jackpot**, with optional fixed numbers chosen by Ming.
- **Statistics with a strategy check**: frequency, draws since last seen, common pairs; plus a historical check that compares "hot numbers", "overdue numbers" and "random" strategies and shows the result as-is.
- Prize tables, ticket price, draw days and tax threshold are configuration (R5). Money in integer VND (R2). All calculation in `packages/core` (R1).

### Deferred to v2
- Push alerts (Telegram / Zalo).
- Backtesting rules on historical data.
- Reading TCBS account via iFlash OpenAPI (read-only).

---

## 4. Architecture

```
                 Authen (Supabase Cloud — shared auth only)
                          │  JWT
                          ▼
 Browser ──HTTPS── Cloudflare Tunnel ── web (Next.js) ──┐
                                                        │
                                   worker (scheduler) ──┤
                                    │                   ▼
                     ┌──────────────┼───────── App DB (Supabase project — dedicated, RLS on)
                     ▼              ▼
          Market data adapters   News adapters ──► LLM provider (summaries / explanations)
```

### 4.1 Services (Docker Compose on WSL, same network as cloudflared)
| Service | Responsibility |
|---|---|
| `web` | Next.js UI and API routes; reads/writes app DB; verifies Authen JWT + allowlist |
| `worker` | Scheduled jobs: price polling, EOD sync, financials, news fetch, signal computation, AI summaries, suggestion scoring |

### 4.2 Auth integration
- Login through Authen; `web` validates the shared JWT.
- Allowlist check (Ming's user ID) on every request — v1 rejects all other authenticated mmlabs users.
- App data lives in a **separate Supabase project**; it never stores data in the shared auth project.
- Open question: how the app DB's RLS trusts the Authen JWT (shared JWT secret vs server-side service role with app-level checks). See §9.

### 4.3 Data source adapters
- One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable.
- Primary + fallback source per data type where possible.
- Every record stores `source` and `fetched_at`.

### 4.4 Job schedule (initial)
| Job | When |
|---|---|
| Intraday price poll (watchlist only) | Every few minutes during trading sessions |
| EOD OHLCV sync | After market close |
| Financials sync | Daily check, quarterly updates |
| News fetch | Hourly on trading days |
| Signal computation | After each intraday poll (short term) and after EOD (medium term) |
| Daily AI summary | After EOD |
| Suggestion scoring | Daily after EOD |
| Gap detection | After each poll and at EOD |

---

## 5. Data Model (initial)

| Table | Key fields |
|---|---|
| `transactions` | id, date, symbol, side, quantity, price, fee, tax, source (`manual`/`import`), import_batch_id |
| `corporate_actions` | id, symbol, type, record_date, ratio/amount, applied |
| `lots` | id, symbol, buy_transaction_id, quantity_remaining, cost_per_share, sellable_from |
| `assets` | id, type (`cash`/`other`), name, value, as_of |
| `watchlist` | symbol, group, added_at |
| `prices_intraday` | symbol, ts, price, volume, source, fetched_at |
| `prices_daily` | symbol, date, open, high, low, close, volume, foreign_net, source |
| `financials` | symbol, period, eps, bvps, revenue, net_income, source |
| `news` | id, symbol, title, url, source, published_at, credibility |
| `signals` | id, symbol, rule_id, horizon, value, inputs_snapshot, data_fresh, created_at |
| `suggestions` | id, symbol, action, horizon, quantity, rationale, signal_ids, news_ids, price_at, index_at, created_at |
| `suggestion_scores` | suggestion_id, checkpoint, price_at_checkpoint, return_pct, vs_index_pct, outcome |
| `data_gaps` | symbol, from_ts, to_ts, detected_at |
| `settings` | fee_rate, tax_rate, concentration_threshold, rule configs |

Holdings and P&L are **derived** from `transactions` + `corporate_actions` + `lots`, never stored as editable balances.

---

## 6. Signal & AI Design

### 6.1 Separation of concerns
1. **Rules (code)** produce signals from data. Deterministic, testable.
2. **Suggestion engine (code)** turns signals + portfolio context into an action and quantity.
3. **LLM** writes the summary and explanation from the stored inputs only.

### 6.2 Anti-hallucination rules for prompts
- The LLM receives only stored data (prices, signals, articles) as context; no open-ended "what do you think of X".
- Every factual sentence must reference an input ID (article, signal, price). Unreferenced claims are stripped or the output is rejected.
- If inputs are missing or stale, the output says so instead of filling the gap.
- No price targets or return promises.
- Output is structured JSON validated against a schema before display.

### 6.3 Scoring method
- Outcome per checkpoint: return since suggestion, and return relative to VN-Index.
- `consider buy` is correct if return > 0 and beats the index; `consider trim` is correct if the price falls or underperforms the index; thresholds are configurable.
- Per-rule hit rate drives rule tuning; rules with consistently poor results get disabled.

---

## 7. Deployment

- Follows the existing mmlabs pattern:
  - App repo (private): CI and image build on GitHub-hosted runners, images pushed to the Docker Hub account used by other mmlabs apps.
  - Shared deploy repo: Compose definitions + env; deploy jobs on the self-hosted runner on the home server.
- Subdomain under mmlabs.online, exposed via the existing Cloudflare Tunnel.
- Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo.
- `worker` must tolerate restarts: jobs are idempotent and resume from last successful run.
- Operational note: the PC must be on during trading hours for intraday data; gaps are recorded in `data_gaps`.

---

## 8. Agent Setup (from `agency-agents`)

Copy into the app repo's `.claude/agents/`:

| Source path | Role in this project |
|---|---|
| `finance/finance-investment-researcher.md` | Signal logic, valuation rules, portfolio analysis |
| `research/research-synthesist.md` | News summarization with source weighting |
| `engineering/engineering-data-engineer.md` | Data adapters, worker pipelines, gap handling |
| `engineering/engineering-prompt-engineer.md` | Prompts, citation enforcement, output schemas |
| `specialized/specialized-model-qa.md` | Suggestion scorecard design and evaluation |
| `engineering/engineering-data-visualization-engineer.md` | Dashboards |
| `engineering/engineering-database-optimizer.md` | Schema, time-series queries, RLS |
| `testing/testing-reality-checker.md` | Release gate |

Adaptation before use:
- Add `tools:` (read-only for reviewer/QA roles) and `model:` to each file's frontmatter.
- Trim persona/backstory sections.
- Put project context (Next.js, Supabase, VN market rules from §2.1, data constraints from §2.2) in the repo's `CLAUDE.md`, not inside each agent.

---

## 9. Risks & Open Questions

### Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Unofficial data source breaks or changes | No prices/signals | Adapter layer, fallback source, freshness badges, signal suppression |
| PC off / asleep during trading hours | Data gaps, missed signals | Gap detection, no signals on gaps; consider keeping the PC awake during sessions |
| Manual ledger drifts from reality | Wrong P&L and wrong suggestions | Transaction-level entry, corporate actions, periodic statement import and reconciliation |
| LLM fabricates facts | Misleading suggestions | Rules decide, LLM explains; mandatory citations; schema validation |
| Short-term suggestions are often wrong | Overtrust | Scorecard with visible hit rate; reference-only notice |
| App later opened to other users | Regulatory exposure | v1 allowlist; any public version drops suggestions |
| Supabase Free plan limits/pausing | App DB unavailable | Monitor; upgrade plan or migrate if it becomes an issue |

### Open questions
1. JWT trust between Authen and the app's separate Supabase project (shared secret vs server-side checks).
2. Exact CSV format of the TCInvest statement export (needs a sample file).
3. Ming's actual TCBS fee rate and any tiered fee rules.
4. Primary and fallback data sources after license/terms check.
5. News sources list and whether each allows fetching.
6. LLM provider (e.g. reuse the provider already used in Ricotdin, or another).
7. App name and subdomain.
8. F8: source and terms for Vietlott draw results (no official API), and the exact Vietlott SMS confirmation format (needs a sample message).

---

## 10. Roadmap

| Phase | Scope |
|---|---|
| **v1.0** | F1 ledger + import, F2 portfolio & assets, F3 watchlist, EOD data only, medium-term signals |
| **v1.1** | Intraday polling, short-term signals, gap detection |
| **v1.2** | F5 news summaries, F6 suggestions, F7 scorecard |
| **v1.3** | F8 Vietlott tracker (Mega 6/45, Power 6/55) |
| **v2** | Alerts (Telegram/Zalo), backtesting, optional read-only TCBS OpenAPI |

Rationale: ledger and portfolio correctness first (everything else depends on it); EOD before intraday (simpler, more reliable); suggestions only after the data and signals underneath are trustworthy.

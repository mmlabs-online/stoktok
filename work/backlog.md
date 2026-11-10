# Backlog

States: BACKLOG → PLANNING → IN_PROGRESS → REVIEW → DONE · plus REWORK, BLOCKED, ESCALATED.
Priority: P1 (next) > P2 > P3. `/run` with no ID picks the top BACKLOG ticket.

| ID | Title | State | Priority | Areas | Attempts | Updated |
|---|---|---|---|---|---|---|
| STK-001 | Scaffold pnpm workspace and tooling | DONE | P1 | architecture | 1 | 2026-10-22 |
| STK-002 | Core ledger: transactions → lots → holdings with P&L | DONE | P1 | finance, db | 2 | 2026-10-22 |
| STK-003 | Supabase schema and migrations for v1.0 data | DONE | P1 | db, security | 1 | 2026-10-23 |
| STK-004 | Authen login and allowlist on the Next.js server | DONE | P1 | architecture, security | 2 | 2026-10-23 |
| STK-005 | End-of-day price adapter and sync job | DONE | P2 | data, db | 1 | 2026-10-24 |
| STK-006 | Server data layer for ledger, assets, settings | DONE | P1 | db, security | 1 | 2026-10-23 |
| STK-007 | App shell and shared UI components | DONE | P1 | ui | 1 | 2026-10-23 |
| STK-008 | Transactions ledger screen | DONE | P1 | ui, finance | 3 | 2026-10-23 |
| STK-009 | Portfolio dashboard and other assets | DONE | P1 | ui, finance | 2 | 2026-10-23 |
| STK-010 | Settings screen | DONE | P2 | ui | 1 | 2026-10-25 |
| STK-011 | Watchlist screen | DONE | P2 | ui, data, db | 1 | 2026-10-25 |
| STK-012 | Statement CSV import and reconciliation | BLOCKED | P2 | data, finance, ui | 0 | 2026-10-25 |
| STK-013 | Reconcile ledger defaults with a real TCBS statement | BLOCKED | P2 | finance | 0 | 2026-10-25 |
| STK-014 | Quarterly financials adapter | DONE | P2 | data, db | 1 | 2026-10-25 |
| STK-015 | Medium-term signal rules and job | DONE | P2 | finance, db | 1 | 2026-10-26 |
| STK-016 | Symbol detail screen | DONE | P2 | ui, finance | 1 | 2026-10-26 |
| STK-017 | Docker images and CI build | DONE | P2 | architecture, security | 2 | 2026-10-28 |
| STK-018 | Deployment to the WSL server | DONE | P2 | architecture, security | 2 | 2026-10-30 |
| STK-030 | Cash and other assets management | DONE | P1 | ui, finance | 1 | 2026-10-24 |
| STK-031 | Daily price gap detection | DONE | P2 | data, db | 1 | 2026-10-29 |
| STK-032 | Historical daily price backfill | DONE | P2 | data | 1 | 2026-10-30 |
| STK-033 | Signal-rules section on the Settings screen | DONE | P2 | ui, finance | 1 | 2026-10-30 |
| STK-034 | Price and volume chart on the symbol screen | DONE | P2 | ui, finance | 1 | 2026-10-30 |
| STK-035 | Medium-term signals on the symbol screen | DONE | P2 | ui, finance | 1 | 2026-10-31 |
| STK-036 | Raw-price guards for MA signal rules | DONE | P2 | finance, data | 1 | 2026-10-30 |
| STK-037 | Release workflow and deployment-repo integration | DONE | P1 | architecture, security | 2 | 2026-10-30 |
| STK-038 | VietCap (VCI) public endpoint as end-of-day price source | DONE | P1 | data, architecture | 1 | 2026-11-01 |
| STK-039 | Replace the quarterly financials source | DONE | P2 | data, finance | 2 | 2026-11-01 |
| STK-040 | Reject adjusted-price history in VCI responses | DONE | P2 | data | 1 | 2026-11-01 |
| STK-041 | Financials run health: count only in-window rejects, skip unsupported company types | DONE | P1 | data | 1 | 2026-11-01 |
| STK-042 | Financials for banks, securities firms and insurers (VietCap IQ) | DONE | P2 | data, finance | 1 | 2026-11-04 |
| STK-043 | Deploy secrets from the deployment repo's GitHub Secrets | DONE | P1 | architecture, security | 1 | 2026-11-03 |
| STK-044 | Run deploy and worker jobs as the runner's real user (mingming) | DONE | P1 | architecture, security | 1 | 2026-11-03 |
| STK-045 | Self-install the Mac-side setup from deploy-stoktok | DONE | P1 | architecture, security | 1 | 2026-11-03 |
| STK-046 | Seed the Vietnamese exchange holiday calendar and resolve false price gaps | DONE | P1 | data, finance, db | 0 | 2026-11-05 |
| STK-047 | Holiday calendar editor on the Settings screen | DONE | P2 | ui | 1 | 2026-11-05 |
| STK-048 | Authen = Supabase Auth of stoktok's own project (docs and comments) | DONE | P1 | security | 1 | 2026-11-05 |
| STK-049 | Intraday prices, slice 1 — source adapter, storage and session rule | DONE | P1 | data, architecture, db, ui | 1 | 2026-11-05 |
| STK-050 | Intraday prices, slice 2 — throttled refresh on the web server and merged prices | BLOCKED | P1 | data, architecture, finance | 0 | 2026-11-08 |
| STK-051 | Intraday prices, slice 3 — refresh bar, 30 s auto refresh and "Làm mới" | DONE | P1 | ui | 2 | 2026-11-05 |
| STK-052 | Vietlott core: game rules, ticket checking and net result | DONE | P3 | finance | 1 | 2026-11-05 |
| STK-053 | Vietlott schema and server data layer | DONE | P3 | db, security | 0 | 2026-11-06 |
| STK-054 | Vietlott draw results adapter, backfill and ticket checking job | BACKLOG | P3 | data, db | 0 | 2026-11-05 |
| STK-055 | Vietlott tickets screen: manual entry, history and in-app wins | BACKLOG | P3 | ui, finance | 0 | 2026-11-05 |
| STK-056 | Parse pasted Vietlott SMS confirmations into tickets | BLOCKED | P3 | data, ui | 0 | 2026-11-05 |
| STK-057 | Vietlott number suggestions that avoid popular combinations | BACKLOG | P3 | finance, ui | 0 | 2026-11-05 |
| STK-058 | Vietlott statistics and historical strategy check | BACKLOG | P3 | finance, ui | 0 | 2026-11-05 |
| STK-059 | Vietlott opportunity cost vs VN-Index | BACKLOG | P3 | finance, ui | 0 | 2026-11-05 |
| STK-060 | Remove the allowlist check; any verified Supabase Auth user can sign in | DONE | P2 | security, architecture | 1 | 2026-11-07 |
| STK-061 | Income statement and balance sheet lines for the AI layer | DONE | P2 | data, db, finance | 1 | 2026-11-08 |
| STK-062 | News adapters (CafeF, Vietstock, VnExpress) and news store | DONE | P2 | data, db, security | 1 | 2026-11-08 |
| STK-063 | AI budget and usage foundation (slice 1 of 3: config, cost, budget gate, ai_usage) | DONE | P2 | architecture, security, db | 2 | 2026-11-10 |
| STK-064 | Daily AI summaries per symbol and per portfolio (F5) | BACKLOG | P2 | data, ui, security | 0 | 2026-11-08 |
| STK-065 | Rule-based suggestions with AI explanation, and the suggestion scorecard (F6 + F7) | BACKLOG | P2 | finance, db, ui | 0 | 2026-11-08 |
| STK-066 | Free chat with a stock-analysis agent | BACKLOG | P2 | architecture, security, ui, finance | 0 | 2026-11-08 |
| STK-067 | Financial ratios derived in core (margins, D/E, ROE, ROA, YoY, P/E, P/B) | BACKLOG | P2 | finance, db | 0 | 2026-11-08 |
| STK-068 | Cash-flow statement lines and free cash flow | BLOCKED | P2 | data, finance | 0 | 2026-11-08 |
| STK-069 | Harden ai_reserve and db carry-overs (STK-063 slice 2a) | DONE | P2 | architecture, security | 1 | 2026-11-10 |
| STK-070 | Claude and Gemini adapters in packages/ai (STK-063 slice 3a) | DONE | P2 | architecture, security, ui | 3 | 2026-11-10 |
| STK-071 | AI client, untrusted blocks, tools and guards (STK-063 slice 2b-i) | DONE | P2 | architecture, security | 3 | 2026-11-10 |
| STK-072 | Optional AI secrets in deploy tooling (STK-063 slice 2b-ii) | DONE | P2 | architecture, security | 3 | 2026-11-10 |
| STK-073 | AI wiring and AI usage card (STK-063 slice 3b) | DONE | P2 | architecture, security, ui | 2 | 2026-11-10 |
| STK-074 | AI provider keys in Supabase Vault and key resolution (slice a) | DONE | P2 | security, db, architecture, ui | 3 | 2026-11-10 |
| STK-075 | Self-host the Nunito font so web builds need no network | DONE | P1 | ui | 1 | 2026-11-10 |
| STK-076 | Settings "Khóa AI" card and key save/delete actions (STK-074 slice b) | REVIEW | P2 | security, ui | 1 | 2026-11-10 |

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
| STK-050 | Intraday prices, slice 2 — throttled refresh on the web server and merged prices | BACKLOG | P1 | data, architecture, finance | 0 | 2026-11-05 |
| STK-051 | Intraday prices, slice 3 — refresh bar, 30 s auto refresh and "Làm mới" | DONE | P1 | ui | 2 | 2026-11-05 |

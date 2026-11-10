# stoktok

Personal stock-tracking and investment-assistant app for the Vietnamese market (Ming trades on TCBS).
Part of the mmlabs ecosystem (login via Authen). **v1 is single-user (public sign-ups disabled) and not listed in the mmlabs gallery.**

- Product spec: [docs/spec-v1.md](docs/spec-v1.md) — source of truth for scope. If this file and the spec disagree on scope, the spec wins; flag the conflict.
- UI design brief: [docs/figma-make-prompts.md](docs/figma-make-prompts.md) — no Figma file; UI is designed directly in code from this brief (Ming, 2026-10-23).
- Workflow (tickets, agents, commands): see **Workflow** below.

---

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js (App Router, TypeScript) in `apps/web` |
| Worker | Node.js + TypeScript in `apps/worker` (scheduled jobs: prices, news, signals, AI, scoring) |
| Domain logic | `packages/core` (TypeScript) — ledger, lots, holdings, P&L, fees/tax, signals. Shared by web and worker |
| DB | Supabase (dedicated project for stoktok, Postgres, RLS on). Migrations in `supabase/` |
| Auth | Authen = Supabase Auth of stoktok's own Supabase project (Ming, 2026-11-05, STK-048). stoktok's own `/login` signs in server-side; the server verifies via `getClaims()`; no allowlist, single user via disabled sign-ups (Ming, 2026-11-07, STK-060) |
| Package manager | pnpm workspaces |
| Tests | Vitest (unit), Playwright (e2e, later) |
| Runtime | Docker Compose on Ming's WSL2 home server behind Cloudflare Tunnel |
| CI/CD | GitHub Actions (hosted runners) build images → Docker Hub; deploy via the shared mmlabs deploy repo |

Current state: **repository scaffold only.** The workspace (`apps/`, `packages/`, `supabase/`) is created by ticket STK-001.
Standard scripts once scaffolded: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Do not change the stack without Ming's explicit decision.

---

## Architecture rules (reviewer enforces these)

| ID | Rule |
|---|---|
| R1 | **No financial calculation in UI.** Cost basis, P&L, weights, sellable quantity, fees, tax, signals live in `packages/core` only. Components format and display. |
| R2 | **Money and prices are integers in VND** (e.g. price 125.40 thousand VND is stored as `125400`). No floats for money. Rounding rules are defined once in `packages/core`. |
| R3 | **Service role key is server-only.** Used by Next.js server code and `apps/worker` only. Never in `NEXT_PUBLIC_*`, never in client bundles. The browser never talks to the DB directly. |
| R4 | **Every market-data record carries `source` and `fetched_at`.** Stale or gapped data never produces a signal; gaps are recorded. |
| R5 | **Market rules are configuration**, never hard-coded: fee rate, sell tax, price limits per exchange, settlement days, lot size. |
| R6 | **Every server route / server action verifies the Authen JWT** (`requireUser()`). Single-user access is enforced by disabled public sign-ups in the stoktok Supabase project, not an allowlist (Ming, 2026-11-07, STK-060). See note below. |
| R7 | **Stay inside the ticket's plan.** Anything else found goes to the follow-ups list, not into the diff. |
| R8 | **No PASS without green checks.** `typecheck`, `lint`, `test` must pass. New or changed `packages/core` logic must have unit tests. |
| R9 | **AI output (v1.2+)**: input is stored data only, every factual claim cites a stored input ID, output is schema-validated. AI explains rule-based signals; it never decides the action. |
| R10 | **Non-goals are hard limits**: no brokerage login, no order placement, no multi-user access to suggestions. |

> **R6 restored (Ming resumed STK-004, 2026-11-05).** Authen is Supabase Auth of stoktok's own Supabase project (STK-048). stoktok has its own `/login` (server action, httpOnly cookie on stoktok's host). `requireUser()` (`apps/web/server/auth`) runs in every page, route handler and server action; the public list is `/login` and `/healthz` (`apps/web/proxy.ts`). Any user in that project's Auth has full access; keep sign-ups disabled (STK-060). Cloudflare Access stays in front for now.

---

## Vietnamese market rules (configuration defaults — verify before go-live)

| Rule | Default |
|---|---|
| Settlement | T+2 (bought shares sellable from T+2) |
| Daily price limits | HOSE ±7%, HNX ±10%, UPCoM ±15% |
| Board lot | 100 shares (odd lots handled separately) |
| Selling tax | 0.1% of sale value |
| Brokerage fee | User setting (Ming's TCBS rate) |
| Corporate actions | Cash dividend, stock dividend, rights issue — all adjust cost basis |
| Price colors (UI) | up green, down red, reference yellow, ceiling purple, floor cyan |

---

## Workflow

One orchestrated loop per ticket. **The main session is the orchestrator** (subagents cannot dispatch other subagents), driven by `/run`.

```
/ticket "..."  →  BACKLOG
/run STK-xxx   →  CONSULT (optional specialists) → PLAN → IMPLEMENT → REVIEW ─PASS→ DONE → PR (Ming merges)
                                                      ^                  │
                                                      └──── REWORK ──────┘  max 2 reworks → ESCALATED (stop, ask Ming)
```

- No human gate between PLAN and IMPLEMENT (Ming's decision). The loop stops only when: the planner returns blocking questions (`BLOCKED`), reviews are exhausted (`ESCALATED`), or the ticket is `DONE`.
- Each ticket runs on branch `ticket/STK-xxx` (or the session's mandated branch in cloud sessions). The loop commits and pushes there; when the ticket is `DONE` it **opens a PR into `main`** automatically. **Ming approves and merges** — agents never merge.

### Commands (`.claude/commands/`)
| Command | Purpose |
|---|---|
| `/ticket <description>` | Create `work/tickets/STK-xxx/ticket.md` and a backlog row |
| `/run [STK-xxx]` | Run the full loop for a ticket (no ID = highest-priority BACKLOG ticket) |
| `/status` | Board summary from `work/backlog.md` |
| `/solo <description>` | Small direct change outside the loop (still must pass checks; logged) |

### Agents (`.claude/agents/`)
Workflow roles:
| Agent | Model | Writes | Based on (agency-agents) |
|---|---|---|---|
| `planner` | opus | `plan.md` only | `project-management/project-manager-senior.md` |
| `implementer` | sonnet | code + `impl-log.md` | `engineering/engineering-minimal-change-engineer.md` |
| `reviewer` | opus | `review.md` only | `engineering/engineering-code-reviewer.md` + `testing/testing-reality-checker.md` |

Specialists (consult-only, read-only; `/run` saves their output to the ticket folder):
| Agent | Consulted when ticket `areas` include |
|---|---|
| `finance-investment-researcher` | `finance` (signal rules, valuation, portfolio logic) |
| `software-architect` | `architecture` (auth, data model, worker, cross-cutting) |
| `database-optimizer` | `db` (schema, migrations, RLS, queries) |
| `data-engineer` | `data` (market/news adapters, jobs, gap handling) |
| `data-visualization-engineer` | `ui` (charts, dashboards) |
| `security-ai-generated-code-auditor` | `security`, or any diff touching auth, RLS, migrations, env/secrets — runs at REVIEW |

### Files (`work/`)
```
work/backlog.md                 board: one row per ticket
work/templates/                 ticket, plan, impl-log, review, escalation
work/tickets/STK-xxx/
  ticket.md                     goal, acceptance criteria, areas, state, attempts
  consult-<agent>.md            specialist notes (optional)
  plan.md                       planner output
  impl-log.md                   implementer output (appended per attempt)
  review.md                     reviewer verdict (appended per attempt)
  security-review.md            security auditor output (when triggered)
  escalation.md                 only when ESCALATED
```

Ticket states: `BACKLOG` → `PLANNING` → `IN_PROGRESS` → `REVIEW` → `DONE`, plus `REWORK`, `BLOCKED`, `ESCALATED`.

---

## Conventions

- Language: code, comments, docs, commit messages in English. UI labels in Vietnamese.
- Commits: `STK-xxx: <imperative summary>`.
- Secrets: only in `.env.local` (git-ignored), the deploy repo, and — for AI provider keys entered on Settings — Supabase Vault (ADR 0009). Keys are never returned to the browser or logged. `.env.example` lists keys with no values.
- Third-party agent definitions come from msitarzewski/agency-agents (MIT) — see `THIRD_PARTY_NOTICES.md`.

# STK-066: Free chat with a stock-analysis agent

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | architecture, security, ui, finance |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Add a chat screen where Ming can ask anything about the market, a symbol or his portfolio. An agent answers in Vietnamese. It reads stored prices, holdings, signals, financial statements and news through read-only tools, can add its own general knowledge, and may give investment ideas.

## Spec reference
docs/spec-v1.md §6 (changed by this ticket), §3 F5–F7, §1.3 non-goals. CLAUDE.md R3, R9, R10.

## Acceptance criteria
- [ ] Update the spec and rules to Ming's decision (2026-11-08): free chat is allowed. Update `docs/spec-v1.md` §6.2 and §1.3, and update CLAUDE.md R9 to say that chat may use model knowledge and give ideas, while scheduled summaries and rule suggestions keep the strict cited-only rules. The non-goals stay: no brokerage login, no order placement, single user.
- [ ] Add a `/chat` page behind `requireUser()` (R6). It is a server action or route that streams the answer, with no AI key in the browser (R3). The provider is chosen per conversation (Claude / Google AI), with the default from config.
- [ ] Agent tools are read-only and allowlisted: get quote/history, get holdings and P&L, get signals, get financial statements, search news, get AI summaries. Tool outputs are passed as untrusted data (STK-063 defence). No tool can write data except logging a suggestion.
- [ ] Answers separate sourced facts from model knowledge. A number or claim taken from stored data cites its record, and model-knowledge content is labelled "kiến thức chung, có thể đã cũ". The disclaimer stays visible on the chat screen.
- [ ] When the agent proposes a buy, sell or hold idea for a symbol, it records it through a tool into `suggestions` with `origin = chat` (STK-065), so it gets scored.
- [ ] Conversations and messages are stored (RLS on, service_role only, with a rollback file). Every turn goes through the 5 USD/month budget gate, and the screen shows usage this month.
- [ ] `typecheck`, `lint` and `test` are green. Add tests with a fake provider for the tool allowlist, the budget refusal, suggestion logging and citation rendering, and an auth test showing that an unauthenticated request is redirected.

## Notes / answers from Ming
- 2026-11-08: Chat is free ("tự do"), not cited-only. The model may use general knowledge and suggest investments. Providers are Claude API and Google AI API, with a budget of 5 USD/month.
- Planner default to confirm: no live web search in this ticket (the agent sees stored data plus model knowledge). Live web search can be a follow-up.
- 2026-11-10 (orchestrator): waits for STK-070 (the AI layer was split from STK-063 into STK-063, STK-069 and STK-070).
- 2026-11-10 (orchestrator): now waits for STK-073 (STK-070 was split into adapters and wiring + usage card).

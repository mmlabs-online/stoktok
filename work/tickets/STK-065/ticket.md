# STK-065: Rule-based suggestions with AI explanation, and the suggestion scorecard (F6 + F7)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | finance, db, ui |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Turn signals and portfolio context into investment suggestions using code rules. The AI writes only the explanation. Every suggestion is logged and scored automatically, so Ming can see over time whether the suggestions are right.

## Spec reference
docs/spec-v1.md §3 F6, F7, §5 `suggestions` / `suggestion_scores`, §6. CLAUDE.md R1, R2, R5, R9, R10.

## Acceptance criteria
- [ ] The suggestion engine in `packages/core` takes signals plus cash, weights, cost basis and lot sellability, and returns an action (`consider buy` / `consider trim` / `hold` / `review stop-loss`) with a horizon and a quantity. The quantity is rounded to board lots and capped by available cash. It never suggests selling a lot that is not yet sellable (T+2). Thresholds are config (R5).
- [ ] The AI explanation (STK-063) cites the triggering signal and news IDs. If the AI is unavailable or over budget, the suggestion is still shown with a rule-only explanation.
- [ ] A `suggestions` row logs symbol, action, horizon, quantity, rationale, signal_ids, news_ids, price_at, index_at, `origin` (`rules` or `chat`) and created_at.
- [ ] A scoring job writes `suggestion_scores` after 5 and 20 sessions (short term) and after 3 and 6 months (medium term): return since the suggestion and return vs VN-Index. Scoring math is in `packages/core` with tests.
- [ ] A scorecard screen shows hit rate, average return vs VN-Index, and per-rule and per-origin performance, with the disclaimer.
- [ ] Migrations have RLS on, service_role only, and rollback files. `typecheck`, `lint` and `test` are green.

## Notes / answers from Ming
- 2026-11-08: Ming wants free chat (STK-066). Suggestions that come from chat are also logged here with `origin = chat`, so they get scored like rule suggestions.
- 2026-11-10 (orchestrator): waits for STK-070 (the AI layer was split from STK-063 into STK-063, STK-069 and STK-070).

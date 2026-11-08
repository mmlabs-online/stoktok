# STK-064: Daily AI summaries per symbol and per portfolio (F5)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, ui, security |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
After EOD, generate a short Vietnamese summary for each holding and watchlist symbol, plus one for the whole portfolio. The summaries cover the day's price move, signals, new news and the latest financial statements. Every claim cites a stored input. Show them on the Tài sản screen and on the symbol screen.

## Spec reference
docs/spec-v1.md §3 F5, §6.2 anti-hallucination rules, §7 schedule (after EOD). CLAUDE.md R4, R9.

## Acceptance criteria
- [ ] A worker job runs after the EOD sync and builds inputs only from stored data: prices, signals, `news` (STK-062) and statements (STK-061). It calls the AI layer (STK-063) and is skipped cleanly when the budget is exhausted.
- [ ] Output is schema-validated JSON. Each sentence carries the input IDs it is based on, and sentences without an ID are dropped. Missing or stale inputs produce "không có dữ liệu" instead of a filled gap. There are no price targets and no return promises.
- [ ] An `ai_summaries` table stores symbol (or portfolio), date, provider, model, a JSON body, input IDs and created_at. Migration with RLS on, service_role only, and a rollback file.
- [ ] The UI shows the summary card with clickable citations (article link, signal, period) and the "reference only" disclaimer. It renders text only and never HTML from the model.
- [ ] Each summary is idempotent per symbol and date: a rerun replaces that row.
- [ ] `typecheck`, `lint` and `test` are green. Use a fake provider in tests, and include tests for citation stripping and for missing-data handling.

## Notes / answers from Ming

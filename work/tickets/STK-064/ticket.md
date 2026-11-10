# STK-064: Daily AI summaries per symbol and per portfolio (F5)

| Field | Value |
|---|---|
| State | PLANNING |
| Priority | P2 |
| Areas | data, db, ui, security |
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
- 2026-11-10 (orchestrator): waits for STK-070 (the AI layer was split from STK-063 into STK-063, STK-069 and STK-070).
- 2026-11-10 (orchestrator): now waits for STK-073 (STK-070 was split into adapters and wiring + usage card).
- 2026-11-10 (orchestrator): added `db` to areas (AC3 is a new `ai_summaries` migration). Carry-overs from STK-063…STK-076:
  - Use the merged AI layer: `apps/worker/src/ai.ts` (`createWorkerAi`, keys resolved per call: Settings/Vault key → env → off; a key-read error is `provider_unavailable`). Budget exhaustion and `budget_unavailable` / `provider_unavailable` must skip cleanly.
  - Stored articles/statements go only in untrusted data blocks, never in `system` or the caller's text (STK-071 security note). Any tool passed to the client must be genuinely read-only (R10).
  - First worker job to import the AI SDKs: add the worker-image SDK resolution probe to `scripts/check-image.sh` (STK-073 follow-up), and check `apps/worker` tsup externals.
  - Real provider behaviour (model IDs, prices, thinking, JSON mode) is still verify-before-go-live (see STK-070 impl-log).

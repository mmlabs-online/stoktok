# STK-077: AI summaries worker job and inputs (STK-064 slice b)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, security |
| Attempts | 0 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Build the daily per-symbol AI summary job on top of the STK-064 storage and validator: core input builders and the template body, the zod output schema, the `ai-summaries` worker job and CLI, budget/provider stop rules, and the worker-image SDK probe. Split from STK-064 (see work/tickets/STK-064/plan.md "Split proposal"; consults in work/tickets/STK-064/).

## Spec reference
docs/spec-v1.md §3 F5, §6.2, §7. CLAUDE.md R1, R4, R5, R9. Depends on STK-064.

## Acceptance criteria
- [ ] Core builds per-symbol inputs only from stored data (prices, signals, news, financial lines) with the STK-064 input-ID grammar and freshness rules; stale or missing inputs become `missing:` markers, never filled gaps (R4).
- [ ] Symbols with only price data get a deterministic template body with no AI call; others get one `AiClient.generate` call each, sequential, no tools, untrusted data blocks only, output validated with zod and `sanitizeSummaryOutput` (R9).
- [ ] Worker job `ai-summaries` (CLI, `--dry-run`, `--force`) runs for session date D, exits 0 with `eod_not_ready` if no symbol has a close on D, skips model rows that already exist unless `--force`, stops the run on `budget_exhausted` / `budget_unavailable` / `provider_unavailable`, skips a symbol on `provider_error` / `invalid_output`, and prints a JSON summary; logs contain codes, ids and counts only.
- [ ] `summary` output-token cap and per-run symbol cap are configuration (R5); `scripts/check-image.sh` gets a worker-image SDK resolution probe and tsup externals are checked.
- [ ] `typecheck`, `lint`, `test` green with a fake provider; tests cover the stop rules, template path, citation stripping and missing data.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-064 per its plan.md; defaults for Ming are listed there under Assumptions.
- Ming's manual step after merge: add `ai-summaries` to `run-schedule.sh` in the deployment repo after eod-prices → signals → financial-statements → news, plus a later retry slot.

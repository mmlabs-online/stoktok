## Attempt 1 — 2026-11-10 (slice 1: storage + core output contract)

### Files touched
| File | Required because |
|---|---|
| `supabase/migrations/20261110000300_ai_summaries.sql` | AC3 table, constraints, indexes, comments, RLS, service_role-only grants |
| `supabase/rollback/20261110000300_ai_summaries.down.sql` | AC3 rollback |
| `scripts/db-check/checks.sql` | `ai_summaries` in `tables_exist`; new cases columns / service_role rw / negatives / usage_fk / upsert_replaces |
| `packages/core/src/ai/summary/config.ts` | R5 limits, deny patterns, no-data text, topics |
| `packages/core/src/ai/summary/input-ids.ts` | input-ID grammar |
| `packages/core/src/ai/summary/body.ts` | body types, `noDataBody`/`noDataSection`, plain-text check, `parseStoredSummaryBody` |
| `packages/core/src/ai/summary/sanitize.ts` | post-call validator |
| `packages/core/src/ai/summary/index.ts` | barrel |
| `packages/core/src/ai/index.ts` | re-export the summary module |
| `packages/core/src/ai/summary/{input-ids,body,sanitize}.test.ts` | unit tests (R8) |
| `packages/db/src/rows.ts` | `AiSummaryRow`, `AiSummaryInsert` |
| `packages/db/src/mappers.ts` | `aiSummaryFromRow` / `AiSummaryRecord` |
| `packages/db/src/repos/ai-summaries.ts` | `upsertAiSummary`, `listAiSummariesForDate` |
| `packages/db/src/repos/ai-summaries.test.ts` | repo tests |
| `packages/db/src/index.ts` | export repo functions and types |

### Tests added / changed
- input-ids.test.ts: round-trip of all kinds; rejects bad ids; null on >64 chars
- body.test.ts: noDataBody coverage + invalid subject; parse accepts valid / drops unknown keys / rejects wrong version, empty sections, no ids, bad ids, long text, markup, oversize, deep junk
- sanitize.test.ts: malformed, bad_context, keep, no ids, unknown id, missing marker, missing topic (replace / claims dropped / empty), all stripped, deny-list and no false positives, markup/URL/bidi, whitespace/NFC, over_limit, topic handling, canonical order, citedIds/inputIds, maxBodyBytes, per-reason counts
- ai-summaries.test.ts: upsert columns and onConflict, id and DataError mapping, list explicit columns and body null on invalid
- checks.sql: tables_exist, ai_summaries_columns, service_role_can_read_write_ai_summaries, ai_summaries_negatives, ai_summaries_usage_fk, ai_summaries_upsert_replaces

### Checks (actual output summary)
- typecheck: clean (all workspaces, no errors)
- lint: clean (no errors or warnings)
- test: core 821 passed, db 195 passed (1 todo), ai 184, sources 35, worker 295, web 349; no failures
- db:check: `db:check OK` (throwaway local Postgres 16 via the script default, applied up, checks, rolled back to 0 tables, re-applied, re-checked)

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- `sanitize` returns `bad_context` (not in the plan) when `ctx.subject` is not an uppercase symbol or 'PORTFOLIO'; slice 2 should treat it as a programming error.
- `ctx.providedIds` is not capped to `maxInputIds` (200) in core; the SQL check would reject a longer `input_ids`. Slice 2 input builders must keep the block count under it.
- `parseStoredSummaryBody` does not check that a `missing:true` section cites only `missing:` markers.

### Scope self-check
- Could the diff be smaller? No; every file is in the plan list.
- Diff size: ~166 insertions / 4 deletions in tracked files plus ~805 lines in new files (migration, core summary module and tests, repo and test).

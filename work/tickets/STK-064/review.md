## Attempt 1 — 2026-11-10
Verdict: PASS

Scope reviewed: slice 1 only (storage + core output contract). The worker job, portfolio summary and UI are STK-077/078/079. Diff base `origin/main...HEAD` (c512b16).

### Checks (run by reviewer)
- typecheck: exit 0, all workspaces clean
- lint: exit 0, no errors or warnings
- test: exit 0. core 821 passed (69 files), db 195 passed + 1 todo, ai 184, sources 35, worker 295, web 349. These match impl-log.md.
- db:check: `db:check OK` (local Postgres: apply → checks → rollback → re-apply → checks)

### Acceptance criteria (plan table, slice 1)
- [x] 1 AC3 table/RLS/grants/rollback. Evidence: `supabase/migrations/20261110000300_ai_summaries.sql` has every planned column, the check constraints, `unique(scope,symbol,summary_date)`, both indexes, the comments, `enable row level security`, `revoke … from public, anon, authenticated` and `grant s/i/u/d … to service_role`. `supabase/rollback/20261110000300_ai_summaries.down.sql` has `drop table if exists`. db:check passes `tables_exist` (with ai_summaries), `ai_summaries_columns`, `service_role_can_read_write_ai_summaries`, `ai_summaries_negatives`, `ai_summaries_usage_fk`, the generic RLS and anon/authenticated loops, and the rollback to 0 tables.
- [x] 2 AC5 storage replace. Evidence: db:check `ai_summaries_upsert_replaces`. `ai-summaries.test.ts › upsertAiSummary upserts on scope,symbol,summary_date and sends every column…` asserts the onConflict value and all 11 keys.
- [x] 3 Citation stripping. Evidence: `sanitize.test.ts › keeps sentences whose ids are all provided`, `› drops sentences with no inputIds`, `› drops sentences citing an id that was not provided (even when another id is valid)`, `› drops sentences that cite a missing: marker`.
- [x] 4 Missing data → "Không có dữ liệu." Evidence: `› missing topic is replaced by the no-data sentence citing its marker`, `› model sentences for a missing topic are dropped and counted`, `› topic with no surviving sentence becomes no-data`, `› everything stripped gives an all-no-data body (ok:true)`, `body.test.ts › noDataBody covers every topic…`.
- [x] 5 No price targets or return promises. Evidence: the `› drops deny-listed sentences…` test covers 11 phrases. `› does not drop plain statement terms…` checks for false positives.
- [x] 6 Schema and plain text. Evidence: `› malformed output returns {ok:false, code:'malformed'}` and `› drops sentences with markup, URLs or control/bidi chars`. I checked the bytes: the test literals really contain U+202E and U+200B. `body.test.ts › rejects wrong version, empty sections, …` also passes.
- [x] 7 Green checks plus AC6 tests: see Checks. The fake-provider tests are deferred to STK-077, as the plan says.

### Issues
None.

### Code review notes
- `parseInputId` round-trips through `formatInputId`, so only canonical IDs parse. That rejects `news:012`, bad calendar dates, lowercase symbols and extra segments. Every ID it accepts satisfies the UntrustedBlock regex and the SQL check (≤64 chars, `[A-Za-z0-9_.:-]`).
- `sanitizeSummaryOutput` runs its per-sentence steps in the planned order: NFC, collapse, plain-text, deny-list, ids, provided set. A sentence citing an unknown ID is dropped even when its other IDs are valid. The model can never cite a `missing:` marker. A missing topic always ends up as the no-data section. The size trim never touches missing sections. The function is pure and deterministic, with no clock and no I/O.
- The repo uses an explicit column list. The read path re-validates the body and maps a bad one to `body: null`. bigint values go through `toSafeInt`. Errors map to `DataError` (VALIDATION / DB_ERROR).
- `bad_context` is an addition beyond the plan. It is justified: it guards a subject the marker grammar cannot encode.

### Rules R1–R10
No violations found. R1: all logic is in core. R2: no money in this slice. R3: the repo is server-only, the table is service_role only, and no anon or authenticated grants exist (db:check). R4: `missing:` markers. R5: `AI_SUMMARY_CONFIG`. R7: every code file is in the plan list. The other changed files are workflow files: consults, plan, ticket, backlog and the STK-077/078/079 split tickets. R8: green, with core tests. R9: ID check, plain-text body, and no prompt or article text stored. R10: no tools, no actions.

### Nits (do not block)
- `checks.sql` `ai_summaries_negatives` does not test `generator='template'` with only `usage_id` set. The plan says "with provider or usage_id". The constraint covers it, but there is no case for it.
- `AiSummaryInsert.provider` is `string | null`. It could be narrowed to the `'anthropic' | 'google'` provider union.

### Follow-ups (out of scope)
- From the implementer:
  - `bad_context`: STK-077 should treat it as a programming error.
  - `ctx.providedIds` has no 200 cap in core. Also, `sanitize` does not check that the provided IDs match the grammar, so a bad provided ID would only fail at the SQL check. STK-077 should cap and validate inputs before the call, or make sanitize return `bad_context` for them.
  - `parseStoredSummaryBody` does not check that a `missing:true` section cites only `missing:` markers, or that a non-missing section cites none.
- If `ctx.topics` is empty, sanitize returns an `ok:true` body with zero sections. `parseStoredSummaryBody` would reject that body, but SQL accepts it. STK-077 should always pass a non-empty topic list, or sanitize could return `bad_context`.
- The deny pattern `cam kết` is broad and may strip factual news sentences (for example "cam kết đầu tư" in a disclosure). Review the false-positive rate once real output exists (STK-077).
- `parseStoredSummaryBody` does not re-run the deny-list on read. Consider it for STK-079 as defence in depth if bodies could ever be written by a path other than sanitize.
- Retention or pruning of `ai_summaries` history (already noted in the plan).

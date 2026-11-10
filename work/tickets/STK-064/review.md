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

## Attempt 2 — 2026-11-10
Verdict: PASS

Scope of this attempt: commit 0e81c14 (plus e29d31b, workflow files only), reviewed as `git diff 49e4bb5..HEAD`. The work is Ming's 2026-11-10 request to apply security-review.md attempt 1: all four 🟡 and the two small 🟢 items.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exited 0.
- lint: `pnpm lint` exited 0.
- test: `pnpm test` passed everywhere: core 831/831, sources 35, ai 184, db 195 (+1 todo), worker 295, web 349. These counts match impl-log Attempt 2.
- db:check: not run. No SQL changed (`git diff 49e4bb5..HEAD -- supabase/` is empty).

### Requested fixes
- [x] **🟡1 Allow-list plain text, with NFKC and Default_Ignorable refusal, on both write and read.** `body.ts` `ALLOWED_TEXT_RE` and `IGNORABLE_RE`. `isPlainSummaryText` also requires `text === text.normalize('NFKC')`. Write (`sanitize.ts` check) and read (`parseStoredSummaryBody`) call the same function. Evidence:
  - `sanitize.test.ts › drops invisible and lookalike characters (U+00AD, U+E0041 tag, Cyrillic а, U+034F, variation selector)`: 6/6 stripped.
  - `body.test.ts › rejects deny-listed text … and invisible/lookalike characters`: covers `nê­n`, `a\u{E0041}b` and Cyrillic `muа` on read.
- [x] **🟡2 Deny-list ignores diacritics and covers the extra phrases and forecast pattern.** `isDenyListed` matches the NFKC-lowercased text, then matches again with diacritics stripped from both pattern and text (NFD, strip `\p{M}`, đ→d). `config.ts` adds every phrase from the finding plus `(sẽ|có thể) (tăng|giảm)( \p{L}+){0,2} ?[\d%]`. "cam kết" is unchanged, as Ming asked. Evidence: `sanitize.test.ts › deny-list also catches bypasses…` has one case per bypass (19 cases).
- [x] **🟡3 The parser re-runs the deny-list.** `body.ts` calls `isDenyListed(x.text, cfg)` inside `parseStoredSummaryBody`. Evidence: the `body.test.ts` case above covers `Nên mua ngay.`, `nen mua`, `Price target 80.` and `Giá sẽ tăng 20%.`.
- [x] **🟡4 Read-path self-consistency.**
  - The `missing` flag is checked both ways: a marker is allowed only when `missing:true`, and the marker topic must equal the section topic.
  - A `missing:true` section must hold exactly one sentence, equal to `noDataText`, with exactly one id.
  - Every cited id must be in the row's `input_ids`.
  - The marker subject must equal the row subject, and symbol-scoped ids must match the row symbol (symbol rows only).
  - `mappers.ts` passes `{ inputIds, subject }`.
  - Evidence: `body.test.ts › missing:true needs exactly the no-data sentence…` (5 cases), `› missing:false must not cite a missing: marker`, `› with row context…` (5 cases). `db repos/ai-summaries.test.ts` also has two new rows (id not in input_ids; VNM id in an FPT row), and both map to `body: null`.
- [x] **🟢 `providedIds` are validated.** `sanitize.ts` returns `bad_context` when an id fails `parseInputId` or starts with `missing:`. Evidence: `sanitize.test.ts › bad providedIds … return bad_context` (3 cases).
- [x] **🟢 `AiSummaryInsert.body: AiSummaryBody`.** See `rows.ts`. The db test body is now typed.

### Acceptance criteria (slice 1, re-checked)
All criteria that passed in attempt 1 still pass. The only edits to existing tests are justified:
- The ids `'a','b'` in the over_limit test became `news:3`/`news:4`, because invalid provided ids now return `bad_context`.
- The db fixture got a type annotation.

### Reviewer probes (scratch scripts run with tsx against the real core source; not committed)
- **Round trip.** The output of `sanitizeSummaryOutput` passes `parseStoredSummaryBody(body, cfg, { inputIds: result.inputIds, subject })` unchanged, for both a symbol body and a portfolio body. The test bodies included missing topics, a stripped sentence, typographic quotes and an en dash. The stricter read path does not reject anything the write path produces.
- **Vietnamese text with diacritics: no false positives on ordinary factual sentences.** 24 typical sentences passed both checks. Among them:
  - "Giá đóng cửa phiên 10/11 ở mức 70.000 ₫, tăng 1,5% so với tham chiếu."
  - "Khối ngoại bán ròng 12,3 tỷ đồng; …"
  - "RSI(14) ở mức 72, vùng quá mua theo quy tắc."
  - "Chỉ số VN-Index tăng 5,2 điểm lên 1.280 điểm."
  - "Do áp lực chốt lời nên giá giảm 2%."
  - "Cổ phiếu tầng 5 tăng 2%." (tầng→tang does not trigger a match)
  - "Ban lãnh đạo cho biết sẽ mở rộng nhà máy…"
  - "Không có dữ liệu."
- **Expected conservative denials** (future tense or promotional wording, so acceptable for an "explain, never decide" summary):
  - "…có tiềm năng tăng trưởng…"
  - "Ngân hàng sẽ tăng vốn lên 30.000 tỷ đồng theo kế hoạch…"
  - "Kế hoạch có thể giảm 10% chi phí…"
  - These are dropped and counted in `stripped.deny_listed`. Nothing unsafe gets through, so this does not block. See Follow-ups.
- **Typographic quotes ‘’“” and en/em dash in the allow-list: acceptable.**
  - NFKC leaves them unchanged.
  - They carry no markup meaning in a text-only renderer, and they cannot form a URL or a tag.
  - They are not Default_Ignorable or bidi characters.
  - Vietnamese news titles routinely use “…” and –, so refusing them would drop many valid sentences.
  - The security finding's own suggested class already included `–`. Adding `—` and the curly quotes stays within that intent.

### Issues
None.

### Rules R1–R10
No violations found. R1/R8: the logic is in `packages/core` and has unit tests. R5: phrases and limits live in `AI_SUMMARY_CONFIG`. R7: the changed code files are all existing slice-1 files, the change matches Ming's note exactly, and there is no SQL change. R9: write and read now apply the same text and deny checks, and the read path enforces citation consistency. R10: no tools and no actions.

### Nits (do not block)
- `ALLOWED_TEXT_RE` admits any `\p{N}`, but the forecast pattern uses `\d`, which is ASCII-only under `u`. As a result, "Giá sẽ tăng ٢٠ điểm." (Arabic-Indic digits) passes the deny check. A forecast written with `%` is still caught. Restricting the digit class to `0-9` would close this. The risk is low, and this is only a backstop.
- `&` is not allowed, so "Thương vụ M&A hoàn tất…" is dropped as `invalid_text`. That is a loss of a valid sentence, not a safety problem.
- The name `stripDiacritics` hides that the function also maps đ→d. Its JSDoc mentions the mapping, so this is fine.

### Follow-ups (out of scope)
- STK-077: measure the `deny_listed` false-positive rate on real output. In particular, the forecast pattern catches announced corporate plans ("sẽ tăng vốn lên 30.000 tỷ"), alongside the existing "cam kết" note. Tune `AI_SUMMARY_CONFIG.denyPatterns` if needed.
- STK-077: the read path requires that symbol rows cite only that symbol's symbol-scoped ids. If a symbol summary ever gets market-context inputs (for example `px:VNINDEX:…`), relax `parseStoredSummaryBody`'s subject check or scope those ids differently. Otherwise those rows will read back as `body: null`.
- Optional DB guards from the security review (`body::text !~ '[<>]'`, `body->>'version' = body_version`) were not added (no SQL in this attempt), as the impl-log records.

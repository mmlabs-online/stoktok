Status: READY

# Plan — STK-064: Daily AI summaries per symbol and per portfolio (F5) — slice 1 of 4: storage and output contract

This ticket is too big for one implement/review cycle (see `## Split proposal`). **This plan covers slice 1 only:**
the `ai_summaries` migration (with rollback and db:check cases), the `packages/db` repo for it, and the pure
`packages/core` output contract: input-ID grammar, the stored body shape, the post-call validator (citation
stripping, deny-list, missing-data fill) and the stored-body parser. There is no worker job, no AI call and no UI in this slice.

## Spec summary
- docs/spec-v1.md §3 F5: "Daily AI summary per symbol and per portfolio, **each claim linked to a stored article**."
- §4.4: "| Daily AI summary | After EOD |"
- §6.1.3: "**LLM** writes the summary and explanation from the stored inputs only."
- §6.2 Anti-hallucination rules:
  - "The LLM receives only stored data (prices, signals, articles) as context; no open-ended "what do you think of X"."
  - "Every factual sentence must reference an input ID (article, signal, price). Unreferenced claims are stripped or the output is rejected."
  - "If inputs are missing or stale, the output says so instead of filling the gap."
  - "No price targets or return promises."
  - "Output is structured JSON validated against a schema before display."
- CLAUDE.md R9: "AI output (v1.2+): input is stored data only, every factual claim cites a stored input ID, output is schema-validated."
- CLAUDE.md R4: "Stale or gapped data never produces a signal; gaps are recorded."
- Ticket AC3: "An `ai_summaries` table stores symbol (or portfolio), date, provider, model, a JSON body, input IDs and created_at. Migration with RLS on, service_role only, and a rollback file."
- Ticket AC5: "Each summary is idempotent per symbol and date: a rerun replaces that row."

## Acceptance criteria → verification
Slice 1 covers AC3 fully, plus the storage half of AC5, the validator half of AC2, and the AC6 tests for these parts. AC1, the input half of AC2, the rerun policy of AC5, and AC4 belong to later slices (see the split table).

| # | Criterion (slice 1 part) | How the reviewer verifies it |
|---|---|---|
| 1 | AC3: `ai_summaries` exists with scope/symbol, `summary_date`, provider, model, `body` jsonb, `input_ids`, `created_at`; RLS on; only service_role has grants; a rollback file exists | `pnpm db:check` passes (local Postgres, using `DB_CHECK_URL=postgresql://…@localhost/…` or `PG_BIN`; Docker is not available). Cases `tables_exist` (with `ai_summaries` added), `ai_summaries_columns`, `service_role_can_read_write_ai_summaries`, `ai_summaries_negatives`, `ai_summaries_usage_fk`, plus the existing generic RLS, anon/authenticated and rollback-leaves-0-tables checks. Read `supabase/rollback/20261110000300_ai_summaries.down.sql`. |
| 2 | AC5 (storage): one row per (scope, symbol, summary_date); writing again replaces the row | db:check `ai_summaries_upsert_replaces` (`insert … on conflict (scope,symbol,summary_date) do update` leaves 1 row with the new body). Test `ai-summaries.test.ts › upsertAiSummary upserts on scope,symbol,summary_date and sends every column`. |
| 3 | AC2 (validator): every stored sentence carries ≥1 known input ID; sentences without an ID, or with an unknown ID, are dropped | `sanitize.test.ts › drops sentences with no inputIds`, `› drops sentences citing an id that was not provided`, `› keeps sentences whose ids are all provided` |
| 4 | AC2: missing or stale inputs give "Không có dữ liệu." instead of a filled gap | `sanitize.test.ts › missing topic is replaced by the no-data sentence citing its marker`, `› model sentences for a missing topic are dropped`, `› topic with no surviving sentence becomes no-data`, `body.test.ts › noDataBody covers every topic` |
| 5 | AC2: no price targets or return promises | `sanitize.test.ts › drops deny-listed sentences (giá mục tiêu, kỳ vọng tăng, cam kết lợi nhuận, nên mua …)` and `› does not drop plain statement terms (lợi nhuận sau thuế, doanh thu)` |
| 6 | AC2 / AC4 groundwork: output is schema-checked; the stored body is plain text only | `sanitize.test.ts › malformed output returns {ok:false, code:'malformed'}`, `› drops sentences with markup, URLs or control/bidi chars`; `body.test.ts › parseStoredSummaryBody rejects wrong version / bad ids / oversize` |
| 7 | AC6: green checks, tests for citation stripping and missing data | `pnpm typecheck && pnpm lint && pnpm test` green; the tests above exist. (The fake-provider tests come with the job in slice 2. This slice makes no provider call.) |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261110000300_ai_summaries.sql` | create | AC3 table, constraints, indexes, comments, RLS and grants |
| `supabase/rollback/20261110000300_ai_summaries.down.sql` | create | AC3 rollback: `drop table if exists public.ai_summaries;` |
| `scripts/db-check/checks.sql` | modify | Add `ai_summaries` to the sorted `tables_exist` array (before `ai_usage`), plus the new check blocks listed under Tests |
| `packages/core/src/ai/summary/config.ts` | create | R5: limits, deny-list patterns, the no-data text and the body version, in one place |
| `packages/core/src/ai/summary/input-ids.ts` | create | Input-ID grammar: `formatInputId` / `parseInputId` |
| `packages/core/src/ai/summary/body.ts` | create | Body types, `noDataBody`, `parseStoredSummaryBody` |
| `packages/core/src/ai/summary/sanitize.ts` | create | `sanitizeSummaryOutput`: the post-call validator |
| `packages/core/src/ai/summary/index.ts` | create | Barrel |
| `packages/core/src/ai/index.ts` | modify | Re-export the summary module (core `index.ts` already does `export * from './ai'`) |
| `packages/core/src/ai/summary/input-ids.test.ts` | create | Unit tests |
| `packages/core/src/ai/summary/body.test.ts` | create | Unit tests |
| `packages/core/src/ai/summary/sanitize.test.ts` | create | Unit tests (AC6: citation stripping, missing data) |
| `packages/db/src/rows.ts` | modify | `AiSummaryRow`, `AiSummaryInsert` |
| `packages/db/src/mappers.ts` | modify | `aiSummaryFromRow` → `AiSummaryRecord` (bigint via `toSafeInt`; body re-validated with core `parseStoredSummaryBody`) |
| `packages/db/src/repos/ai-summaries.ts` | create | `upsertAiSummary`, `listAiSummariesForDate` |
| `packages/db/src/repos/ai-summaries.test.ts` | create | Repo tests using `test/fake-client.ts` |
| `packages/db/src/index.ts` | modify | Export the repo functions and types |

No other file is touched. This slice has no worker, web, `scripts/check-image.sh` or tsup changes.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `input-ids.test.ts › formats and parses px / sig / news / fin / hold / sum / missing ids (round-trip)` | ID grammar |
| `input-ids.test.ts › rejects ids over 64 chars, lowercase symbols, bad dates/periods, unknown kinds, commas` | IDs always match `^[A-Za-z0-9_.:-]{1,64}$` (the UntrustedBlock id rule) and the SQL check |
| `input-ids.test.ts › formatInputId returns null when the id would exceed 64 chars (long rule_id)` | `sig:` natural-key length edge case |
| `body.test.ts › noDataBody covers every topic in order, each citing missing:<SUBJ>:<topic>` | Missing data |
| `body.test.ts › parseStoredSummaryBody accepts a valid v1 body` | Read path (later used by the UI) |
| `body.test.ts › parseStoredSummaryBody rejects wrong version, empty sections, sentence without ids, bad id format, over-long text, oversize JSON, extra-deep junk` | Re-validating a stored body |
| `sanitize.test.ts › malformed output returns {ok:false, code:'malformed'}` (non-object, `sections` not an array, sentence not an object) | Schema check |
| `sanitize.test.ts › keeps sentences whose ids are all provided` | Happy path |
| `sanitize.test.ts › drops sentences with no inputIds` | Citation stripping (AC6) |
| `sanitize.test.ts › drops sentences citing an id that was not provided (even when another id is valid)` | Citation stripping (AC6) |
| `sanitize.test.ts › drops sentences that cite a missing: marker` | The model cannot "fill" a gap |
| `sanitize.test.ts › missing topic is replaced by the no-data sentence citing its marker` | Missing data (AC6) |
| `sanitize.test.ts › model sentences for a missing topic are dropped and counted` | Missing data (AC6) |
| `sanitize.test.ts › topic with no surviving sentence becomes no-data` | Missing data (AC6) |
| `sanitize.test.ts › everything stripped gives an all-no-data body (ok:true)` | No failure on an empty result |
| `sanitize.test.ts › drops deny-listed sentences (giá mục tiêu, mục tiêu giá, target price, kỳ vọng tăng, cam kết lợi nhuận, đảm bảo sinh lời, chắc chắn tăng, nên mua, nên bán, khuyến nghị mua)` | No price targets or return promises |
| `sanitize.test.ts › does not drop plain statement terms (lợi nhuận sau thuế, doanh thu, biên lợi nhuận)` | No false positives on statement vocabulary |
| `sanitize.test.ts › drops sentences with markup, URLs or control/bidi chars (<img onerror>, [x](y), https://, www., ‮)` | Plain text only (AC4 groundwork) |
| `sanitize.test.ts › trims/collapses whitespace, NFC-normalises; drops empty and over-long sentences` | Text hygiene |
| `sanitize.test.ts › caps sentences per section and ids per sentence (over_limit)` | Size bounds |
| `sanitize.test.ts › unknown topic and topic not in ctx.topics are dropped; duplicate topic keeps the first` | Shape |
| `sanitize.test.ts › sections come out in canonical topic order` | Determinism |
| `sanitize.test.ts › citedIds is the sorted unique union of surviving ids; inputIds = provided ∪ marker ids` | AC3 `input_ids` |
| `sanitize.test.ts › body stays within maxBodyBytes (trailing sentences trimmed)` | Matches the SQL cap |
| `sanitize.test.ts › stripped counts per reason` | Logging counts (slice 2) |
| `ai-summaries.test.ts › upsertAiSummary upserts on scope,symbol,summary_date and sends every column (usage_id/provider/model null for template rows, created_at set)` | AC5 replace; no stale column survives |
| `ai-summaries.test.ts › upsertAiSummary returns the id; DB error is mapped to DataError` | Repo |
| `ai-summaries.test.ts › listAiSummariesForDate selects explicit columns, maps bigint ids, returns body null for an invalid stored body` | Read path |
| `checks.sql › tables_exist` (updated array) | AC3 |
| `checks.sql › ai_summaries_columns` (`assert_col` for every column and its NOT NULL state) | AC3 |
| `checks.sql › service_role_can_read_write_ai_summaries` (insert, select, update, delete as service_role) | AC3 |
| `checks.sql › ai_summaries_negatives` (via `pg_temp.expect_fail`): bad scope 23514; scope='symbol' with symbol '' 23514; scope='portfolio' with a non-empty symbol 23514; lowercase symbol 23514; bad provider 23514; generator='model' without provider/model 23514; generator='template' with provider or usage_id 23514; body is an array / a string 23514; body without `sections` 23514; oversize body 23514; input_ids with a bad id / a null / >200 elements 23514; null body 23502; duplicate (scope,symbol,date) 23505; duplicate portfolio row for the same date 23505; nonexistent usage_id 23503 | AC3 constraints |
| `checks.sql › ai_summaries_usage_fk` (deleting the ai_usage row sets `usage_id` null and keeps the summary) | Usage link |
| `checks.sql › ai_summaries_upsert_replaces` | AC5 |

## Approach
1. **Migration** `20261110000300_ai_summaries.sql`. The header comment notes that RLS and grants are in this file (the pattern from news/ai_usage).
   ```
   id            bigint generated always as identity primary key
   scope         text not null check (scope in ('symbol','portfolio'))
   symbol        text not null default ''          -- '' for the single v1 portfolio (no portfolio_id: single-user)
   summary_date  date not null                      -- VN session date the summary is about, not the run date
   generator     text not null check (generator in ('model','template'))
   provider      text check (provider in ('anthropic','google'))
   model         text check (char_length(model) between 1 and 100)
   usage_id      bigint references public.ai_usage(id) on delete set null
   body_version  smallint not null default 1 check (body_version >= 1)
   body          jsonb not null
   input_ids     text[] not null default '{}'
   created_at    timestamptz not null default now()
   unique (scope, symbol, summary_date)
   check ((scope='symbol' and symbol ~ '^[A-Z0-9]{1,20}$') or (scope='portfolio' and symbol=''))
   check ((generator='model' and provider is not null and model is not null)
          or (generator='template' and provider is null and model is null and usage_id is null))
   check (jsonb_typeof(body)='object' and body ? 'sections' and jsonb_typeof(body->'sections')='array'
          and pg_column_size(body) <= 32768)
   check (cardinality(input_ids) <= 200 and array_position(input_ids, null) is null
          and (cardinality(input_ids)=0 or array_to_string(input_ids, ',') ~ '^[A-Za-z0-9_.:-]{1,64}(,[A-Za-z0-9_.:-]{1,64})*$'))
   ```
   - Indexes: `ai_summaries_date_idx on (summary_date desc)` and `ai_summaries_usage_id_idx on (usage_id)` (FK index). The unique index also serves "latest per symbol".
   - Comments:
     - table: no prompt or untrusted article text is stored here; a skipped or failed run writes no row.
     - `body`: MODEL OUTPUT after core validation; plain text only, never HTML (R9).
     - `input_ids`: provided IDs ∪ `missing:` markers (each sentence's own IDs are in `body`).
     - `created_at`: the time of the latest (re)generation, refreshed on replace.
     - `usage_id`: cost through ai_usage; no tokens or cost are copied here.
   - Then `enable row level security; revoke all … from public, anon, authenticated; grant select, insert, update, delete … to service_role;`.
   - Rollback: `drop table if exists public.ai_summaries;`. A reverse-sorted rollback drops it before ai_usage.
   - Check `tables_exist` and the generic anon/RLS loops in checks.sql still pass. Run `pnpm db:check` on local Postgres.
2. **Core `ai/summary/config.ts`** (R5):
   - `AI_SUMMARY_CONFIG = { bodyVersion: 1, maxSentenceChars: 280, maxSentencesPerSection: 4, maxIdsPerSentence: 6, maxSections: 5, maxBodyBytes: 32_768, maxInputIds: 200, noDataText: 'Không có dữ liệu.', denyPatterns: [...] }`.
   - Each deny pattern is a regex source string, matched case-insensitively on NFC-lowercased text. The list covers price targets, expected returns, guarantees, certainty, and buy/sell advice: `giá mục tiêu`, `mục tiêu giá`, `target price`, `kỳ vọng (tăng|giảm|sinh lời|lợi nhuận)`, `cam kết`, `đảm bảo (lợi nhuận|sinh lời|lãi)`, `chắc chắn (tăng|giảm|lãi)`, `lãi chắc`, `nên (mua|bán)`, `khuyến nghị (mua|bán)`, `sẽ (tăng|giảm) (lên|xuống|đến|tới)`.
   - The `budget.summary` output-token cap stays in `AI_CONFIG` and is not changed in this slice (see Split proposal, slice 2).
3. **Core `input-ids.ts`**: `type InputRef` covers:
   - `{kind:'px', symbol, date}` → `px:SYM:YYYY-MM-DD`
   - `{kind:'sig', symbol, ruleId, date}` → `sig:SYM:rule_id:YYYY-MM-DD`
   - `{kind:'news', id}` → `news:<positive int>`
   - `{kind:'fin', symbol, period}` → `fin:SYM:YYYYQn|YYYY`
   - `{kind:'hold', symbol, date}` → `hold:SYM:YYYY-MM-DD`
   - `{kind:'sum', symbol, date}` → `sum:SYM:YYYY-MM-DD`
   - `{kind:'missing', subject, topic}` → `missing:SYM|PORTFOLIO:topic`

   `formatInputId(ref): string | null` returns null when invalid or over 64 chars. `parseInputId(id): InputRef | null`. Natural keys are used because `StoredSignal` and `financial_lines` carry no row id. `news` uses its stable bigint id.
4. **Core `body.ts`**:
   - Types: `SummaryScope`; `SummaryTopic = 'price'|'signals'|'news'|'financials'|'portfolio'`; `SYMBOL_SUMMARY_TOPICS = ['price','signals','news','financials']`; `AiSummarySentence {text, inputIds}`; `AiSummarySection {topic, missing, sentences}`; `AiSummaryBody {version:1, sections, strippedCount}`.
   - `noDataBody(subject, topics)`.
   - `parseStoredSummaryBody(unknown): AiSummaryBody | null` is a hand-rolled structural check. Core has no zod and this slice adds no dependency. It requires every sentence to have ≥1 id passing `parseInputId`, and the text to pass the same plain-text checks as sanitize.
5. **Core `sanitize.ts`**: `sanitizeSummaryOutput(raw, ctx, cfg = AI_SUMMARY_CONFIG)` with `ctx = { subject, topics, providedIds, missingTopics }`.
   - Expected raw shape: `{sections:[{topic, sentences:[{text, inputIds}]}]}`. Extra keys are ignored. A wrong structure returns `{ok:false, code:'malformed'}`.
   - Per sentence, in order:
     1. NFC, trim, collapse whitespace.
     2. Drop if empty or longer than `maxSentenceChars`.
     3. Drop on markup or URL: `[<>\`*#|\[\]{}\\]`, `https?://`, `www.`, control or bidi/zero-width chars.
     4. Drop on a deny-list match.
     5. Drop if there are no ids or more than `maxIdsPerSentence`.
     6. Drop if any id is not in `providedIds`, or is a `missing:` marker.
   - Topics outside `ctx.topics` are dropped. A duplicate topic keeps the first. Sentences past `maxSentencesPerSection` are dropped as `over_limit`.
   - Every topic in `missingTopics`, and every topic left with no sentence, becomes `{missing:true, sentences:[{text:noDataText, inputIds:['missing:<subject>:<topic>']}]}`. Model sentences for a missing topic count as `missing_topic_claim`.
   - Sections come out in `ctx.topics` order. If the body exceeds `maxBodyBytes` (via `utf8ByteLength`), trailing non-missing sentences are trimmed.
   - Returns `{ok:true, body, citedIds, inputIds, stripped: Record<StripReason, number>}`.
   - Pure and deterministic, with no clock or I/O. R1: all of this logic is in core. R9: IDs are checked against the provided set.
6. **DB repo**:
   - `upsertAiSummary(db, row)` uses `db.from('ai_summaries').upsert(row, { onConflict: 'scope,symbol,summary_date' }).select('id')`. It always sends every column: `usage_id`, `provider` and `model` as null when absent, and `created_at` set by the caller, so the replace is complete. It returns the id via `toSafeInt`.
   - `listAiSummariesForDate(db, date)` uses an explicit column list and maps through `aiSummaryFromRow`. The record's `body` is null when `parseStoredSummaryBody` rejects it, so slice 2 can regenerate.
   - The repo validates no shape on write (core validates before the call).
7. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm db:check` (local Postgres).

Rules: R1 (logic in core), R2 (no money in this slice), R3 (repo is service-role and server-only; `r3-guard.test.ts` untouched), R4 (the missing-data markers are the R4 mechanism for the summary), R5 (config block), R7 (slice scope only), R8 (tests and checks), R9 (ID check, plain-text body, no prompt or article text stored), R10 (no tools, no actions).

## Specialist input used
- **data-engineer**:
  - Adopted:
    - The split itself, refined to 4 slices; reasons below.
    - The ID scheme `px:/sig:/news:/fin:/hold:/sum:/missing:`, matching the UntrustedBlock id regex.
    - The validator in core, and the drop rules (empty or unknown ids, markup, deny-list).
    - A no-data body instead of failing.
    - `input_ids` (provided) kept separate from cited ids (in `body`).
    - Skipped or failed runs write no row.
    - Per-symbol sequential calls, no tools, `summary_date = D`, `eod_not_ready` exit 0, `--force` and `--dry-run`. These are carried into the slice-2 defaults.
  - Not adopted:
    - The "not Vietnamese text" heuristic: language detection is unreliable. The markup, URL and length checks cover the injection risk.
- **database-optimizer**:
  - Adopted:
    - `scope` + `symbol not null default ''` sentinel with `unique(scope,symbol,summary_date)` (no PG15 `nulls not distinct`).
    - `summary_date date`.
    - Provider and model checks as in ai_usage.
    - `body_version`.
    - The coarse SQL body guard, with the deep shape in core.
    - `usage_id` FK `on delete set null`, indexed.
    - The `summary_date` index.
    - Full service_role grants (not the ai_keys pattern).
    - The db:check case list.
    - An explicit-column repo that re-validates the body on read.
  - Changed:
    - `input_ids` is namespaced `text[]`, not jsonb typed refs. The same string is the block id the model saw and cites, so one format runs end to end, and `parseInputId` gives the typed view.
    - Body cap of 32 KB, the same as signals.
    - No `generated_at`: `created_at` is refreshed on replace, the literal reading of "a rerun replaces that row".
    - Added a `generator` column (model or template) with provider and model nullable for template rows. A template or no-data body has no model call, so it cannot honestly carry a provider and model.
  - Deferred:
    - `getLatestAiSummary` to slice 4 (UI).
    - Prune/retention to follow-ups. History is unbounded in v1.
- **data-visualization-engineer**: everything here is for slice 4. The one input used now: the stored body is validated as plain text with ids only, and no URL ever comes from the model. Links are resolved from stored `news.url` by id in slice 4. Answer to its question 3: skipped runs write no row. The UI shows AI-off and budget states from the live key and budget status (STK-073), not from summary rows.

## Assumptions
Non-blocking defaults for Ming to confirm. Items marked (s2), (s3) or (s4) are recorded now so later slices plan against them.
1. A skipped run (budget exhausted or unavailable, provider unavailable, provider error, invalid output) writes **no row**. The reason appears only in the job's JSON summary and log (s2). The UI derives "AI tắt" and "hết ngân sách" from the live key and budget status (s4).
2. `summary_date` = session date `D = expectedPriceDate(now, holidays, cutoff)`, not the wall-clock date. If no symbol has a close on `D`, the job logs `eod_not_ready` and exits 0 (s2).
3. Rerun policy (s2): a `generator='model'` row for (symbol, D) is **skipped** unless `--force` is given, which replaces it. `template` rows are always rebuilt, which is cheap. At the storage level any write replaces the row, which is what AC5 needs.
4. Deterministic **template body, no AI call** (s2) when a symbol has no fresh signal on D, no news in the window and no fresh financials. The template is a price sentence citing `px:` plus no-data sections, which saves budget. If the price is also missing or gapped, it is an all-no-data body.
5. Per-symbol calls run sequentially and the portfolio call runs last. No tools are passed (R10 is trivially met). Stored articles go only in `blocks` (STK-071) (s2/s3).
6. Output-token cap (s2): `maxOutputTokensByTask.summary` is lowered from 1500 to 1000, plus a per-run symbol cap of 40 (config). If the watchlist plus holdings exceeds 40, the rest is summarised on the retry slot.
   - At gemini-2.5-flash prices that gives a reserve of about $0.004 per call and about $0.16 per day for 40 symbols. Ming to confirm the watchlist size.
7. News window is 2 trading days, at most 5 articles, `official_disclosure` ranked first, excerpt ≤ 600 bytes (s2).
8. Staleness (s4): a summary is "cũ" when `summary_date` < the latest expected trading session, not when it is not the calendar date. A weekend does not flag Friday's summary.
9. Portfolio summary (s3) also runs on a partial run, with `missing:<SYM>:summary`-style markers. It needs ≥1 symbol summary for D.
10. Rows for symbols later removed from the watchlist and holdings stay; there is no FK to symbols. Retention is unbounded in v1 (follow-up).
11. Known limit: the ID check cannot catch a real ID cited for a false claim. Mitigations: give only precomputed numbers and short excerpts, and show citations next to each sentence (s4).
12. Real provider behaviour (Gemini JSON mode against our zod schema, model IDs, prices) remains verify-before-go-live (STK-070).

## Blocking questions
None.

## Split proposal
| Slice | Scope | ACs | Depends on |
|---|---|---|---|
| **STK-064 (this plan)** — storage + output contract | Migration, rollback and db:check; db repo (`upsertAiSummary`, `listAiSummariesForDate`); core ID grammar, body types/parser, `sanitizeSummaryOutput` and config; unit tests | AC3; AC5 (storage); AC2 (validator, deny-list, no-data); AC6 (core tests) | — |
| **STK-064b** — per-symbol job | Core input builders (`px`/`sig`/`news`/`fin` blocks with precomputed integer figures, freshness → `missing:` markers, size caps, template body). Zod output schema mirroring the core contract, plus a test that zod-valid output passes `sanitizeSummaryOutput`. `apps/worker/src/jobs/ai-summaries.ts`, the CLI branch `ai-summaries [--dry-run] [--force]` and store wiring. Stop rules: budget/provider-off → stop the run, exit 0; provider_error → skip that symbol, stop after N in a row. `summary` output cap. The worker-image AI SDK resolution probe in `scripts/check-image.sh`. Check the `apps/worker/tsup.config.ts` externals (the SDKs are worker `dependencies` and stay external). Fake-provider tests. | AC1 (symbols); AC2 (inputs, stale → no-data); AC5 (rerun/`--force`); AC6 (fake provider) | STK-064 |
| **STK-064c** — portfolio summary | A `listHoldings`-style read (ledger via core); `hold:` inputs from core `buildPortfolio`; `sum:` inputs from stored symbol summaries; the portfolio call last in the job | AC1 (portfolio) | STK-064b |
| **STK-064d** — UI cards | `server/ai-summary` loader (service role, behind `requireUser()`); core VM builder (staleness, citation chips, href resolution from stored `news.url` with an https allow-list); `components/ai/summary-card.tsx` on Tài sản and the symbol screen; disclaimer; text-only rendering tests | AC4 | STK-064 (shows data once 064b runs) |

Reason for four slices instead of the data engineer's two: the first slice alone (migration, db:check cases, repo and the core validator with its tests) is already around 700–900 changed lines. Putting the inputs, the job and the portfolio call into the same slice would make one review of well over 1,500 lines across db, core, worker and CI. The security review of the migration also stays on a small diff.

**Ming's manual step (outside this repo, after STK-064b is merged):** add `ai-summaries` to the schedule chain in the mmlabs deploy repo (`run-schedule.sh`). Run it after eod-prices → signals → financial-statements → news, with a later retry slot. It needs a separate PR in that repo.

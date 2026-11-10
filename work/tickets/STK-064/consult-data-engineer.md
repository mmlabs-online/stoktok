STK-064 consult (data-engineer). Read-only; I read the ticket, spec §3 F5, §4.4, §6.2, §7, ADR 0003, apps/worker (cli.ts, ai.ts, medium-signals.ts), packages/ai (client.ts, types.ts, untrusted.ts), core/ai/config.ts and the news migration. I did not open packages/ai/src/tools.ts or the statements and signals migrations, so those column names are unconfirmed.

## Findings
- The worker has no in-process scheduler (ADR 0003). Jobs are one-shot CLI runs (`cli.ts <job>`), and launchd `run-schedule.sh` chains them under a `mkdir` lock. An `ai-summaries` job therefore needs a new CLI branch and a new entry in the schedule chain, which lives in the deploy repo, outside this repo's diff. `parseArgs` and `USAGE` are hand-rolled and already strained; add the job there.
- `createWorkerAi` already exists but "No job uses it yet". It resolves keys on every `generate()`. Failures come back as `{ok:false, reason}` with the `budget_exhausted | budget_unavailable | provider_unavailable | provider_error | invalid_output` codes. The budget is reserved per call at worst-case cost, using the actual input bytes plus `maxOutputTokensByTask.summary` (1500) and 1000 provider-overhead tokens. The cap is $5 per month. The default `summary` provider is Google (gemini-2.5-flash).
- Existing jobs compute dates in core: `expectedPriceDate(now, holidays, 18:00 VN cutoff)` and `resolveSignalDate(expected, newestCloses)`. `medium-signals.ts` shows the pattern: build the symbol set from watchlist plus held symbols, normalise it, sort it.
- `news` has `id`, `url`, `title`, `source`, `credibility`, `published_at`, `fetched_at`, a `symbols[]` array (GIN index) and an `excerpt` of up to 10k chars. `title` and `excerpt` are untrusted. `news` rows may not be deleted, so ids are stable.

## Recommendations

**1. Timing and "EOD done" detection (AC1)**
- The job does not trust the clock alone. Compute `D = expectedPriceDate(now, holidays, cutoff)`; on a holiday or weekend this is the previous session, as in `runMediumSignals`.
- Run for `D` only when the data is there. For each symbol the job needs a `prices_daily` row with `trade_date = D`. Treat a missing row, or an open prices gap for `D`, as "no data" for that symbol.
- Do not run at all if no symbol has a close on `D`. Log `eod_not_ready` and exit 0 (not a failure), so the next scheduled run retries.
- On a holiday nothing is new and `D` is the old session. Idempotency (below) makes the rerun a cheap skip, so no separate holiday logic is needed beyond `holidays` plus `expectedPriceDate`.
- Schedule: after eod-prices, financials and signals, and also after news. Suggested order is eod-prices, signals, financial-statements, news, then ai-summaries, with a later retry slot. The retry is safe because rows that already exist for `(symbol, D)` are skipped.
- The summary date is `D` (a session date), not the wall-clock date.

**2. Inputs per symbol, with stable IDs (AC2)**

Build the inputs in core as pure functions, for example `packages/core/src/ai/summary-inputs.ts`, so no logic sits in the worker (R1). Each input becomes one `UntrustedBlock` with an id matching `^[A-Za-z0-9_.:-]{1,64}$`. Proposed ids:
- `px:<SYM>:<D>`: close, change %, volume, and reference/ceiling/floor if stored. Include the previous close so the model does not calculate. Precompute the change in core as integers (R1, R2).
- `sig:<signal row id>`, or `sig:<SYM>:<rule_id>:<signal_date>`: only signals with `status=ok`, `data_fresh` true and `signal_date = D`. Suppressed signals are not given as claims; at most mention "không có dữ liệu".
- `news:<news.id>`: articles from the last N days (config, 2 trading days) that contain the symbol in `symbols[]`. Take at most K (config, around 5) newest, with `official_disclosure` ranked above `established_outlet`. Pass title, source, published_at and an excerpt truncated with `truncateUtf8` (around 600 bytes). Title and excerpt go in blocks only, never in `system` (STK-071).
- `fin:<SYM>:<period>`: the latest statement lines from `financial_lines` (STK-061), only if the period is not older than `latestExpectedPeriod` minus one quarter. The statement lines are numbers, so precompute derived figures such as growth in core.
- `hold:<SYM>:<D>` (portfolio only and held symbols): quantity, cost basis, P&L and weight, computed by core.

Freshness rules (R4):
- A price input older than `D`, or with an open gap, is not sent. Instead send a marker block `missing:<SYM>:price` so the model can cite "không có dữ liệu". Do the same for news (none in the window), financials (stale) and signals.
- Post-validation also fills any section the model omitted with a fixed "không có dữ liệu" sentence.
- Output schema (zod): `{ sections: [{ topic: 'price'|'signals'|'news'|'financials', sentences: [{ text, inputIds: string[] (min 1) }] }] }`.
- Validate in code after the call:
  - drop sentences whose `inputIds` are empty or not in the given id set;
  - drop sentences that are not Vietnamese text (length cap, no markup characters);
  - drop sentences that look like price targets or return promises (regex deny-list, "mục tiêu", "kỳ vọng sinh lời" and similar);
  - if nothing survives, store a "no data" body rather than failing.
- Put this validator in core. AC6 needs tests for citation stripping and for missing data.
- `inputIds` stored on the row is the union of ids the surviving sentences actually cited, plus the ids provided. Store both separately, as `input_ids` (provided) and the cited ids inside `body`.

Portfolio inputs: do not re-send raw news. Use the stored per-symbol summaries' structured bodies as inputs, or aggregate data (weights, day P&L from core, top movers). The citation ids are then `sum:<SYM>:<D>` for the symbol summaries plus `hold:*`. This keeps the portfolio call small and traceable. If a symbol summary is missing, send `missing:<SYM>:summary`.

**3. Size limits and budget**
- Cap per call: at most K news × 600-byte excerpts, ≤ 4 financial periods, ≤ about 8 signals, and an overall input cap in bytes, for example 12 KB, set in a config block (R5). Enforce it by dropping the oldest and lowest-credibility news first. Log a count of dropped inputs.
- Cost estimate: about 3–4k input tokens, plus 1000 overhead, plus a reserve at 1500 output tokens. On gemini-2.5-flash that is about $0.0045 per call at the reserve level (1500 × $2.5 per M ≈ $0.00375, plus ≈ $0.0015 input). With 30 symbols that is about $0.14 per day, around $3 per month at the reserve level. Actual cost is lower, but the reserve is what gates the cap.
- This would consume a large part of the $5 cap, shared with chat. Recommend lowering `maxOutputTokens` for this task to about 800, or adding a per-run symbol cap (config). Ask Ming about the expected watchlist size.
- Do not pass tools. All data is prefetched, which is simpler and satisfies R10 trivially.

**4. Run order and batching**
- One call per symbol, then one portfolio call last, because it depends on the symbol results. Batching all symbols in one call cuts overhead, but it mixes untrusted blocks across symbols (cross-contamination via injection), makes one failure lose everything, and makes the citation check harder. Use per-symbol calls, sequential (not parallel), which is also kinder to the provider rate limit.
- Symbols with no new data on any topic (no news, no signal, unchanged financials) still get a price sentence. Consider skipping the AI call when only price exists, storing a deterministic template body (no model call). That saves budget. Ask Ming (see open questions).

**5. Idempotency and partial failure (AC3, AC5)**
- Unique key `(scope, symbol_or_portfolio, summary_date)`. Use `symbol text null` with a `scope in ('symbol','portfolio')` check, and a unique index with `nulls not distinct` or two partial unique indexes. Upsert with `on conflict do update`, replacing the body, provider, model, input_ids and created_at (the ticket says "a rerun replaces that row").
- Default rerun behaviour: skip symbols that already have a row for `D` unless `--force` is passed. Without this, every retry slot spends budget again. Say so in the plan, because the AC reads as "replace on rerun"; `--force` gives that.
- Per-symbol failure is isolated: `invalid_output` and `provider_error` mean that symbol is skipped and logged, and the loop continues. After M consecutive provider errors (config, as in the eod job), stop the run.
- The portfolio summary runs only if at least one symbol summary exists for `D`. If some symbols failed, it runs with `missing:` markers, and its body should note the incomplete coverage.
- A failed attempt writes no row. Do not store a failed or empty row, so the retry slot picks it up.

**6. Budget and provider stops (AC1)**
- `budget_exhausted` and `budget_unavailable`: stop the whole run immediately (no further symbols or portfolio), exit 0, log `skipped_budget`. The rest of the symbols are summarised on a later run.
- `provider_unavailable` (no key, key read error, no provider selected): stop the whole run, exit 0 (the feature is off), log once. Do not loop over every symbol.
- `provider_error`: skip that symbol, count it, and apply the consecutive-failure stop.
- Exit code: 0 for budget/provider-off skips; 1 only for a DB failure or an unexpected error. Summary JSON printed like other jobs: `{ok, dryRun, date, planned, generated, skipped, failed, stopReason?}`. Support `--dry-run`, which builds the inputs and logs sizes without calling the model.

**7. Logging**
- Use the existing `log(message)` to stderr and the final summary JSON on stdout. Log only counts, symbol codes, input ids and reason codes. Never log prompts, article text or output (R9, `AiLog` contract).
- Log per symbol: `{symbol, date, status, inputCount, droppedInputs, strippedSentences, usageIds}`.

**8. Migration and security (AC3, AC4)**
- `ai_summaries`: id, scope, symbol, summary_date, provider, model, body jsonb, input_ids jsonb (or text[]), usage_ids optional, created_at. Add check constraints (symbol format as in `news`, scope/symbol consistency, body size limit).
- RLS on, `revoke all` from public/anon/authenticated, `grant` to service_role only, plus a rollback file. The web app reads via a server-only service-role query behind `requireUser()` (R3, R6).
- The UI renders plain text, with links to articles by `news.id` joined server-side, so the link href comes from the stored `news.url` (the `http(s)` check exists), never from model output. Signal and period citations resolve to in-app routes by id. Render the disclaimer "chỉ để tham khảo".

**9. Split (answer: split)**
This is too much for one implement/review cycle (migration, core inputs and validator, job, CLI, check-image probe, web cards on two screens, and security review). Suggest:
- **STK-064a (data/db/security):** migration plus rollback, core input builders and output validator with tests, the `ai-summaries` job and CLI, the `scripts/check-image.sh` SDK probe, and tsup externals. All tests use the fake provider.
- **STK-064b (ui):** the summary card on the Tài sản screen and the symbol screen, the citation links, and the disclaimer. It depends on 064a.
This also keeps the security review (RLS, migration, secrets) on a small diff.

## Risks
- Budget: 30+ symbols at reserve-level cost can eat most of the $5 monthly cap and starve chat. Mitigate with the output cap, the no-news skip and a per-run cap.
- Stale or incomplete EOD: the job running before the EOD sync finished would summarise yesterday's data as "today". The per-symbol `D` check and the gap check prevent this.
- Prompt injection through news title/excerpt: blocks only, truncated, ids validated against the given set. Stored model text is rendered as plain text.
- Model cites a real id for a false claim: the id check cannot catch this. Mitigate by giving only precomputed numbers and the shortest excerpts, and by showing citations next to each sentence so Ming can check. State this limit in the plan.
- Model IDs, prices and JSON mode are verify-before-go-live (STK-070). Gemini structured output may differ from what the fakes assume.
- Gap markers: a symbol with an open price gap for `D` must never get a price sentence.

## Open questions
1. Is a skip with a deterministic template (no AI call) acceptable for symbols with only price data, to save budget?
2. Expected watchlist plus holdings count? It decides the per-run cap and the output token limit.
3. Is the default "skip if a row exists for (symbol, D), `--force` to replace" acceptable, instead of always replacing?
4. Should the portfolio summary also be produced on a partial run (some symbols missing), or only when all of them succeeded?
5. News window (2 trading days?) and K (5?): confirm. Should `credibility` be shown in the UI citations?
6. Agree to the 064a/064b split? The deploy-repo schedule change also needs a separate PR there.

Files: /home/user/stoktok/work/tickets/STK-064/ticket.md, /home/user/stoktok/apps/worker/src/ai.ts, /home/user/stoktok/apps/worker/src/cli.ts, /home/user/stoktok/apps/worker/src/jobs/medium-signals.ts, /home/user/stoktok/packages/ai/src/client.ts, /home/user/stoktok/packages/core/src/ai/config.ts, /home/user/stoktok/supabase/migrations/20261108000200_news.sql, /home/user/stoktok/docs/adr/0003-deploy-and-scheduling.md.

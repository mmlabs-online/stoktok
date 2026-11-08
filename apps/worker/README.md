# @stoktok/worker

## End-of-day price sync (`eod-prices`)

Fetches daily OHLCV for watchlist and held symbols from the VietCap (VCI) public endpoint (default, source `vci-public`) and upserts `prices_daily` (idempotent; `source` and `fetched_at` on every row). See `docs/adr/0004-vci-eod-price-source.md` and `docs/adr/0001-eod-price-source.md`.

`--source <vci-public|tcbs-public>` picks the source for one run; the default is `EOD_SYNC_CONFIG.priceSource` in `src/config.ts`. **First live run: `pnpm worker:eod --dry-run --source vci-public`** and work through the checklist in ADR 0004. An HTTP 403 means the source blocks us: the run fails, there is no bypass (only an honest User-Agent, Accept and Content-Type are sent).

```
pnpm worker:eod              # fetch and write
pnpm worker:eod --dry-run    # fetch and validate, write nothing
```

Env, in `apps/worker/.env.local` (git-ignored, loaded with `node --env-file-if-exists`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only (R3).

**First live run: use `--dry-run` and check that the closes look like VND** (VNM is tens of thousands, not tens). The unit, raw-vs-adjusted prices and the date encoding are unverified; wrong units are rejected by the plausibility guards (see `rejectedBySymbol` in the summary) instead of stored.

Output: one JSON summary line on stdout (logs go to stderr). Exit code: 0 ok; 1 partial or failed run (a symbol failed or was skipped, a bar was rejected, the ledger could not be read, or a fatal error); 2 usage error.

Tuning (lookback, delay, retries) is in `src/config.ts`.

### Scheduling (documented only, no scheduler code)

Use `TZ=Asia/Ho_Chi_Minh`. Run after the 18:00 price cutoff so the target date is today, plus a catch-up run:

```
TZ=Asia/Ho_Chi_Minh
30 18 * * 1-5 cd <repo> && pnpm worker:eod
0 21 * * 1-5 cd <repo> && pnpm worker:eod
```

Container form: `run-job.sh eod-prices` (drafted in `deploy/deployment-repo/apps/stoktok/`) runs `docker compose run --rm stoktok-worker eod-prices` (see `docs/deploy.md`).

A run on a non-trading day or before the cutoff re-syncs up to the previous trading day, which is harmless. The window is the last 20 trading days, so a missed day is picked up by the next run.

### Holidays

The effective calendar is the seeded HOSE/HNX/UPCoM calendar (`VN_MARKET_HOLIDAYS` in `packages/core/src/market/holiday-calendar.ts`, 2025-2027) united with the dates in `settings.holidays`. Empty or unset `settings.holidays` therefore means the seed; dates stored there are kept and added. The seed is never written to the DB.

- **Dates to be verified against the original notices on hsx.vn / hnx.vn before go-live.** The seed comes from secondary sources (news outlets and legal aggregators quoting the exchange notices).
- Entries with `provisional: true` (every 2027 date and 2026-11-24, Culture Day) are not yet announced by the exchanges. The app uses them like official dates; fix the seed in code if one turns out wrong.
- No 2024 dates are seeded: a `--backfill` reaching before 2025-01-02 (beyond about 455 trading days; the default 260 stays inside 2025) records false gaps on 2024 holidays.
- Dates are added in Cài đặt → "Lịch nghỉ giao dịch" (only dates you added can be removed there; seeded dates change only in code).
- Removing a date does not re-open gaps already resolved because of it. To re-open them for date `D` (manual until a `reopen-holiday-gaps` job exists, follow-up): `update public.data_gaps set resolved_at = null, resolved_reason = null where data_type = 'prices_daily' and resolved_reason = 'non_trading_day' and from_ts <= 'D 23:59:59+07:00' and to_ts >= 'D 00:00:00+07:00';`. The next EOD run re-resolves any gap whose bar is stored.
- Holidays only shift the target date and the fetch window; an incomplete list cannot corrupt prices.

#### Resolving false holiday gaps (`resolve-holiday-gaps`)

Open `prices_daily` gaps whose days are all weekends or holidays are resolved (never deleted) with `data_gaps.resolved_reason = 'non_trading_day'`. A gap that also covers a real trading day stays open (R4). The EOD gap step applies the same rule for synced symbols; this job also covers symbols no longer watched and market-wide gaps, needs no network and no price source.

**Apply the migration `20261105000100_data_gaps_resolved_reason.sql` before the image with this code runs**, otherwise the EOD gap step's update fails with an unknown-column error (prices are already upserted before that step).

First run: apply the migration, deploy, then

```
run-job.sh resolve-holiday-gaps --dry-run   # review the list of gaps
run-job.sh resolve-holiday-gaps             # resolve them
```

(`pnpm worker:holiday-gaps [--dry-run]` from the repo root.) The job is idempotent.

### Backfill (one-off, manual, not scheduled)

Fills about one year of history so the 50/200-day MA rules have enough data.

```
pnpm worker:eod --backfill --dry-run    # default window (260 trading days), write nothing
pnpm worker:eod --backfill 260          # real run
```

Run `--dry-run` first and check in the summary: `requestsPlanned` (symbols x chunks; the run aborts with `abortReason: request_cap_exceeded` above `maxBackfillRequests`), the closes in VND, and `missingDates`. If the same date is missing for every symbol, the calendar is incomplete: add it to `settings.holidays` (STK-047) or fix the seed before the real run. Requests go newest chunk first, with the usual delay, retries and circuit breaker. Re-running is idempotent (upsert on `symbol,trade_date`; nothing is deleted; rejected bars are not written and the stored row is kept). Window, chunk size and caps are in `src/config.ts`.

After a backfill, MA rows whose window crosses a stored stock dividend or a beyond-limit move are suppressed by the STK-036 guards (`corporate_action_in_window`, `price_jump_beyond_limit`). That is expected, not a bug.

## Financials sync (`financials`)

Fetches quarterly EPS, BVPS, revenue and net income plus a sector label for watchlist and held symbols from the TCBS public API. It upserts `financials` (idempotent; `source` and `fetched_at` on every row), records missing quarters in `data_gaps` (never filled) and writes `symbols.sector`. See `docs/adr/0002-financials-source.md`.

```
pnpm worker:financials              # fetch and write
pnpm worker:financials --dry-run    # fetch and validate, write nothing
```

Env as for the EOD sync. **First live run: use `--dry-run` and check** that EPS is in the thousands of VND, BVPS is above 100 VND, revenue is in billions of VND (stored as integer VND) and which EPS basis the source uses (quarterly vs TTM; this is unverified). Wrong units are rejected (see `rejectedBySymbol`) instead of stored; `missingPeriods` is reported on dry-run too.

Output: one JSON summary line on stdout (logs on stderr). Exit code: 0 ok; 1 partial or failed run (a symbol failed or was skipped, an in-window period was rejected (unsupported company types and out-of-window rejects are reported, not failing), the sector fetch failed, the ledger could not be read, or a fatal error); 2 usage error. Symbols with no data (ETFs) do not fail the run.

Schedule (documented only), after the EOD sync:

```
TZ=Asia/Ho_Chi_Minh
45 18 * * 1-5 cd <repo> && pnpm worker:financials
```

Tuning (lookback, publish lag, delay, caps) is in `src/config.ts`.

## Financial statement lines (`financial-statements`)

Fetches income-statement and balance-sheet lines (revenue, gross profit, operating profit, profit before tax, parent net income, total assets, total liabilities, equity, minority interests, cash, short- and long-term borrowings; the lines that apply to the company type) for watchlist and held symbols from VietCap IQ, for the latest quarters and years. It upserts `financial_lines` (idempotent on `symbol,period_kind,period,line`; `source` and `fetched_at` on every row). A line missing from a period is never written as 0: the period is recorded in `data_gaps` (`financial_lines` for quarters, `financial_lines_annual` for years). Lines that do not apply to a company type are skipped without a gap. See `docs/adr/0007-vci-iq-statement-lines.md`.

```
pnpm worker:financial-statements --dry-run   # fetch and validate, write nothing
pnpm worker:financial-statements             # fetch and write
```

Only `--dry-run` is accepted. Output and exit codes are as for `financials`. **Not scheduled yet:** apply migration `20261108000100_financial_lines.sql` and check a clean dry-run first. Tuning (lookbacks, annual publish lag, caps) is `FINANCIAL_STATEMENTS_SYNC_CONFIG` in `src/config.ts`.

## News sync (`news`)

Reads the RSS feeds of CafeF, Vietstock and VnExpress Kinh doanh and stores the articles in `news` (STK-062, spec F5). Collection only: no UI, no AI. Each article keeps `source`, `url`, `published_at`, `fetched_at`, a `credibility` tag (all three are `established_outlet`), `symbols` linked by deterministic rules in `packages/core` (word-bounded ticker match plus a company-name alias list, no LLM) and a short plain-text excerpt. A url already stored is skipped (first seen wins).

```
pnpm --filter @stoktok/worker run job news --dry-run   # fetch and normalize, write nothing
pnpm --filter @stoktok/worker run job news             # fetch and write
pnpm --filter @stoktok/worker run job news --source vnexpress
```

Output and exit codes are as for `financials`: one JSON summary line on stdout (counts only, never article text), logs on stderr; exit 1 if any source failed. A failing source is recorded as a `news` gap (`data_gaps`, market-wide, `source` = source id), extended while the outage lasts and resolved on the next success; the other sources still run. On a non-trading day the job exits 0 without fetching.

**Schedule (documented only):** hourly, 07:00-22:00 Asia/Ho_Chi_Minh, Monday to Friday (the job also checks the trading calendar itself). **Not scheduled yet:** apply migration `20261108000200_news.sql` first, run a clean `--dry-run`, then wire the schedule in the deployment repo (separate, High-tier change).

**Untrusted text (R9).** Titles and excerpts come from third parties. They are stripped to plain text (tags, script and style content, event handlers, control and zero-width characters removed; entities decoded once) before they are stored. They must never be rendered as HTML (no `dangerouslySetInnerHTML`) and never be treated as instructions. Article pages, images and enclosures are never fetched.

**Feeds, robots.txt and terms (recorded 2026-11-08, from a summarizing fetch, not raw bytes).** Wording is deliberate: "robots.txt allows; no RSS-specific terms found; site terms page not read" is not "terms checked". Ming approved all three sources on 2026-11-08. `scripts/record-news-fixtures.sh` saves each host's raw `robots.txt` next to the recorded feeds so the check can be repeated byte for byte.

| Source | Feeds (config) | robots.txt | Terms |
|---|---|---|---|
| CafeF | `cafef.vn/thi-truong-chung-khoan.rss`, `cafef.vn/doanh-nghiep.rss` | `User-agent: *` / `Allow: /`, no Crawl-delay | No RSS-specific terms found; site terms page not read (`/dieu-khoan-su-dung.chn` returned 404) |
| Vietstock | `vietstock.vn/830/.../co-phieu.rss`, `739/.../giao-dich-noi-bo.rss`, `741/.../niem-yet.rss`, `738/.../co-tuc.rss`, `737/.../hoat-dong-kinh-doanh.rss`, `761/.../vi-mo.rss` | RSS paths not disallowed, no Crawl-delay | RSS page offers RSS as a reader convenience, "(c) Ban quyen thuoc ve Vietstock"; no RSS terms; site-wide terms not read |
| VnExpress Kinh doanh | `vnexpress.net/rss/kinh-doanh.rss` | `User-agent: *` / `Allow: /`; named scraper bots are blocked, our honest `stoktok/...` user agent is not one of them | `/rss`: free for individuals and non-profits, the source must be shown, VnExpress may ask us to stop. Personal single-user use fits; always keep `source` + `url` with the text |

To stop reading a source or a feed, set `enabled: false` or edit `feedUrls` in `NEWS_SYNC_CONFIG` (`src/config.ts`), which also holds the rate limit (3 s between feeds of one source), caps and the user agent. Requests send only `User-Agent` and `Accept`, never follow redirects and never retry a 403 or 404.

**Recorded fixtures (human step before merge).** Tests run on synthetic, labelled fixtures in `src/sources/__fixtures__/news/`. Ming runs `bash scripts/record-news-fixtures.sh` from the repo root and commits `work/tickets/STK-062/live-samples/`; the opt-in `rss-news-source.samples.test.ts` then parses every recorded feed. The script stops at the first non-200 response.

## Medium-term signals (`signals`)

Computes the medium-term rules (P/E and P/B vs sector, earnings growth trend, price vs 50/200-day MA) for watchlist and held symbols from stored data only, and upserts `signals`. All rules, freshness checks and gap checks are in `packages/core`; parameters come from `settings.rule_configs.signals.medium` (defaults apply when unset). The MA rules are suppressed (`corporate_action_in_window`, `price_jump_beyond_limit`) when a stock dividend falls inside the window or a close moves beyond the exchange's daily limit, because the stored closes are not adjusted. Nothing is fetched.

```
pnpm worker:signals              # compute and write
pnpm worker:signals --dry-run    # compute, write nothing
```

A signal is stored for every symbol and rule. When the price or financials data is stale, gapped or missing, or the rule cannot give a value, the row is `suppressed` with its `reason_codes` and no label or value. `signal_date` is the data date (the newest stored trade date, never earlier than the expected one), so a re-run on the same data overwrites the same rows (idempotent); a weekend re-run uses Friday. `inputs_snapshot` lists the stored inputs used (with source and fetched_at) and the rule parameters.

Schedule (documented only), after the EOD sync and the financials sync:

```
TZ=Asia/Ho_Chi_Minh
55 18 * * 1-5 cd <repo> && pnpm worker:signals
15 21 * * 1-5 cd <repo> && pnpm worker:signals   # after the 21:00 EOD catch-up
```

**P/E stays suppressed (`eps_basis_unverified`)** until the EPS basis of the financials source is verified. After the financials dry-run confirms whether TCBS EPS is quarterly or trailing 12 months, set `TCBS_FINANCIALS_EPS_BASIS` in `src/sources/tcbs-financials.ts` and update `docs/adr/0002-financials-source.md`. MA rules report `insufficient_history` until 200 closes are stored (backfill is STK-032).

Output: one JSON summary line on stdout. Exit code: 0 ok (suppressed signals are not a failure); 1 the ledger could not be read or a fatal error; 2 usage error.

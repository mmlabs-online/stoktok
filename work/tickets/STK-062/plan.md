Status: READY

# Plan — STK-062: News adapters (CafeF, Vietstock, VnExpress) and news store

## Spec summary
- docs/spec-v1.md §3 F5: "Collect news for watchlist symbols from configured sources (RSS where available)." and "Source credibility tag (official disclosure > established outlet > forum/social, social excluded by default)."
- §4.3: "One interface per data type (`PriceSource`, `FinancialsSource`, `NewsSource`); each implementation is swappable." and "Every record stores `source` and `fetched_at`."
- §4.4: "News fetch | Hourly on trading days".
- §5: "`news` | id, symbol, title, url, source, published_at, credibility".
- §9 open question 5: "News sources list and whether each allows fetching." Ming answered in the ticket on 2026-11-08: CafeF, Vietstock and VnExpress Kinh doanh are approved after a terms check.
- §7: "`worker` must tolerate restarts: jobs are idempotent".
- CLAUDE.md R4 (`source` + `fetched_at` on every record; gaps recorded), R5 (rate limits, caps and feeds are config), R1 (linking logic lives in `packages/core`), R3 (service role only), R9 (stored text is input data, never instructions).

**Spec conflict (flagged, not blocking).** Spec §5 has a single `symbol` column. Ticket AC2 asks for "linked symbols" and a unique `url`. One article can name several tickers or none, and a unique `url` with one `symbol` per row cannot hold that. This plan follows the ticket: `symbols text[]`. Both consults flag the same thing. The spec §5 row should be updated to `symbols[]` (spec edits belong to Ming; see Follow-ups).

### AC1: robots.txt and terms record (from consult-data-engineer §1)
All of this was seen through a summarizing fetch, not raw bytes. `scripts/record-news-fixtures.sh` also saves each host's raw `robots.txt` into `live-samples/` so Ming's recording re-checks it byte for byte.

| Source | Feeds used (config) | robots.txt | Terms | Decision |
|---|---|---|---|---|
| CafeF | `https://cafef.vn/thi-truong-chung-khoan.rss`, `https://cafef.vn/doanh-nghiep.rss` | Seen: `User-agent: *` / `Allow: /`, no Crawl-delay | No RSS-specific terms found. The site terms page was not read (`/dieu-khoan-su-dung.chn` returned 404). | Included (Ming 2026-11-08) |
| Vietstock | `https://vietstock.vn/830/chung-khoan/co-phieu.rss`, `/739/chung-khoan/giao-dich-noi-bo.rss`, `/741/chung-khoan/niem-yet.rss`, `/738/doanh-nghiep/co-tuc.rss`, `/737/doanh-nghiep/hoat-dong-kinh-doanh.rss`, `/761/kinh-te/vi-mo.rss` | Seen: RSS paths are not disallowed, no Crawl-delay | The RSS page presents RSS as a reader convenience, "© Bản quyền thuộc về Vietstock". No RSS terms. The site-wide terms page was not read. | Included (Ming 2026-11-08) |
| VnExpress Kinh doanh | `https://vnexpress.net/rss/kinh-doanh.rss` | Seen: `User-agent: *` / `Allow: /`. Named scraper bots are blocked; our honest `stoktok/…` UA is not one of them. | Seen on `/rss`: free for individuals and non-profits, the source must be shown, VnExpress may ask us to stop. | Included. Personal single-user use fits "individuals". Store and show `source` + `url`. |

The wording is deliberate: "robots.txt allows; no RSS-specific terms found; site terms page not read". It does **not** say "terms checked". Every source and feed can be switched off in config (`enabled`, `feedUrls`).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | All 3 sources sit behind `NewsSource`, RSS is used, the robots/terms check is recorded, and a source that disallows fetching is left out | `apps/worker/src/sources/news-source.ts` exports `interface NewsSource`. `createNewsSources()` builds one `RssNewsSource` per enabled `NEWS_SYNC_CONFIG.sources` entry (`news-source.test.ts › builds the three configured sources`, `› skips a disabled source`). The table above is in this plan and in the worker README. Every configured URL ends in `.rss` and sits on the source's `linkHosts` (`config.test.ts › news feeds are https rss urls on the source host`). |
| 2 | `news` table: id, title, url (unique), source, published_at, fetched_at, credibility, linked symbols, plain-text excerpt capped by config. RLS on, service_role only, rollback file | Read `supabase/migrations/20261108000200_news.sql` and `supabase/rollback/20261108000200_news.down.sql`. `scripts/db-check/checks.sql` gains `tables_exist` + `news_columns` + `service_role_can_read_write_news` + `news_negatives`. The existing global RLS/grant loops cover `news`. Run `scripts/db-check.sh` if a local Postgres is available; otherwise review it statically and say so. The cap is `NEWS_SYNC_CONFIG.maxExcerptChars` (`normalize-item.test.ts › caps excerpt at maxExcerptChars on a code point`). |
| 3 | Symbol linking is deterministic code in core (word-bounded ticker match + alias list), with unit tests and no LLM | `packages/core/src/news/link-symbols.ts` plus `link-symbols.test.ts` (cases listed below). Grep shows no LLM/AI import in `packages/core/src/news`. |
| 4 | Hourly worker job on trading days, de-duplicates by url, per-source rate limits from config (R5), a source failure is recorded as a gap and does not stop the others | `news-sync.test.ts`: `› skips on a non-trading day without fetching`, `› sleeps minIntervalMs between feeds of one source`, `› dedupes items by canonical url within the batch`, `› one source throws: others stored, gap recorded for it, ok false`, `› open gap is extended, not duplicated`, `› success resolves the source's open gaps`, `› dry-run writes nothing`. The insert is `on conflict (url) do nothing` (`news.test.ts`). The README documents the hourly trading-day schedule; launchd wiring is a follow-up (see Assumptions A3). |
| 5 | Article text is untrusted: HTML stripped, stored as plain text, never executed or rendered as HTML | `plain-text.test.ts` (script/style/event-handler/`javascript:`/entity/CDATA/broken-tag/control-char cases). Only `toPlainText` output reaches `NewsInsert`. `news-sync.test.ts › never logs titles or excerpts`. The SQL comment on `news.title`/`news.excerpt` says the text is untrusted, plain text, never rendered as HTML, and never treated as instructions (R9). This ticket adds no UI. |
| 6 | `typecheck`, `lint`, `test` green, with recorded RSS fixtures per source | Run `pnpm typecheck && pnpm lint && pnpm test`. Synthetic, format-faithful fixtures per source (`apps/worker/src/sources/__fixtures__/news/*.xml`) run in `rss-news-source.test.ts`. Recorded fixtures: `scripts/record-news-fixtures.sh` writes them to `work/tickets/STK-062/live-samples/`, and the opt-in `rss-news-source.samples.test.ts` parses each recorded feed with 0 rejected-as-malformed. **Recording is a human step for Ming before merge** (see A1). The reviewer checks the script against the hardening list in Approach step 9 and that the samples test is not skipped once the files exist. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/news/types.ts` | create: `NewsCredibility` (`'official_disclosure' \| 'established_outlet'`), `CREDIBILITY_RANK`, `NewsItem`, `RawFeedItem`, reject reasons | AC2/AC3: shared domain types |
| `packages/core/src/news/plain-text.ts` | create: `toPlainText(html)`, `capText(s, max)` | AC5 |
| `packages/core/src/news/canonical-url.ts` | create: `canonicalNewsUrl(raw, { linkHosts, upgradeHttps })` → string \| null | AC4 dedupe by url |
| `packages/core/src/news/rss-date.ts` | create: `parseRssDate(s)` → UTC ISO \| null | Item dates (CafeF uses 2-digit years) |
| `packages/core/src/news/normalize-item.ts` | create: `normalizeNewsItem(raw, opts)` → `Result<NewsItem>`, and `dedupeNewsItems(items)` | AC2/AC4/AC5 in one pure step |
| `packages/core/src/news/link-symbols.ts` | create: `linkSymbols(text, { candidates, aliases, config })` | AC3 |
| `packages/core/src/news/config.ts` | create: `NEWS_LINK_CONFIG` (stop tokens, ambiguous tickers, context prefixes, `maxSymbols`, `minFoldAliasChars`) and `NEWS_SYMBOL_ALIASES` seed | AC3, R5 |
| `packages/core/src/news/gaps.ts` | create: `NEWS_GAP_TYPE = 'news'`, `planNewsGap(...)` | AC4 gaps (R4) |
| `packages/core/src/news/index.ts` | create: barrel | export surface |
| `packages/core/src/news/*.test.ts` | create: one per module above | R8 |
| `packages/core/src/index.ts` | modify: `export * from './news'` | export |
| `packages/sources/src/http.ts` | modify: extract a shared request loop; add `getText(fetchImpl, url, o & { accept })`; `getJson`/`postJson` behaviour unchanged | XML is not JSON. Keeps the polite client and `redirect: 'error'` |
| `packages/sources/src/http.test.ts` | modify: `getText` tests | R8 |
| `packages/sources/src/rss.ts` | create: `parseRssFeed(xml, { maxItems })` → `RawFeedItem[]` (fast-xml-parser, rejects DOCTYPE and non-UTF-8) | One RSS parser for all three sources |
| `packages/sources/src/rss.test.ts` | create | R8 |
| `packages/sources/src/index.ts` | modify: export `getText`, `parseRssFeed` | export |
| `packages/sources/package.json`, `pnpm-lock.yaml` | modify: add `fast-xml-parser` (exact pin, latest 5.x) | XML parsing, not hand-rolled |
| `apps/worker/src/sources/news-source.ts` | create: `NewsSource` interface, `RssNewsSource`, `createNewsSources()` | AC1 |
| `apps/worker/src/sources/news-source.test.ts` | create | R8 |
| `apps/worker/src/sources/rss-news-source.test.ts` | create: synthetic fixtures through source + normalize + link | AC6 |
| `apps/worker/src/sources/rss-news-source.samples.test.ts` | create: opt-in (`describe.skipIf`) test over `work/tickets/STK-062/live-samples/*.xml` | AC6 recorded fixtures (STK-049 pattern) |
| `apps/worker/src/sources/__fixtures__/news/{cafef,vietstock,vnexpress}.xml` | create: synthetic, 5–8 items each, header comment "SYNTHETIC — format per consult-data-engineer §2, not recorded" | AC6 until recorded |
| `apps/worker/src/jobs/news-sync.ts` | create: `runNewsSync(deps)` | AC4 |
| `apps/worker/src/jobs/news-sync.test.ts` | create | R8 |
| `apps/worker/src/config.ts` | modify: `NEWS_SOURCE_IDS`, `isNewsSourceId`, `NEWS_SYNC_CONFIG` | R5 |
| `apps/worker/src/config.test.ts` | modify: news config invariants | R8 |
| `apps/worker/src/store.ts` | modify: `createDbNewsStore(db, opts)` | wiring |
| `apps/worker/src/store.test.ts` | modify: news store wiring test | R8 |
| `apps/worker/src/cli.ts` | modify: `news` job, `--dry-run`, `--source <cafef\|vietstock\|vnexpress>` | AC4 entry point |
| `apps/worker/src/cli.test.ts` | modify: parseArgs cases for `news` | R8 |
| `apps/worker/README.md` | modify: "News sync (`news`)" section: feeds, robots/terms table, schedule (hourly 07:00–22:00 Asia/Ho_Chi_Minh on trading days, documented only), "Not scheduled yet: apply migration first", untrusted-text rule | AC1/AC4/AC5 documentation |
| `packages/db/src/rows.ts` | modify: `NewsInsert` | typed payload |
| `packages/db/src/repos/news.ts` | create: `insertNews(db, rows, { chunkSize })` | AC2/AC4 write |
| `packages/db/src/repos/news.test.ts` | create | R8, row-cap guard |
| `packages/db/src/repos/data-gaps.ts` | modify: optional `source` filter on `listAllOpenGaps`; new `extendGaps(db, ids, toTs)` | Per-source open-gap lookup, paged; extend instead of duplicate |
| `packages/db/src/repos/data-gaps.test.ts` | modify | R8 |
| `packages/db/src/index.ts` | modify: export `insertNews`, `extendGaps`, `NewsInsert` | export |
| `supabase/migrations/20261108000200_news.sql` | create | AC2 |
| `supabase/rollback/20261108000200_news.down.sql` | create: `drop table if exists public.news;` | AC2 rollback |
| `scripts/db-check/checks.sql` | modify: `tables_exist` (add `'news'` between `lottery_tickets` and `prices_daily`), `news_columns`, `service_role_can_read_write_news`, `news_negatives` | AC2 verification |
| `scripts/record-news-fixtures.sh` | create: Ming-run recorder (feeds + robots.txt) | AC6 recorded fixtures, AC1 raw robots check |

No other files. `packages/core/src/db/*`, the web app, deploy files and the spec are **not** touched.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `plain-text.test.ts › strips tags and keeps text` | AC5 |
| `› drops <script> and <style> content entirely (incl. uppercase, attributes, unclosed)` | AC5 |
| `› removes event handlers / javascript: hrefs with their tag` | AC5 |
| `› decodes entities once (&amp;lt;b&amp;gt; → "&lt;b&gt;" text, not a tag)` | double-escape stays text |
| `› Vietstock-style escaped markup after XML decode is stripped` | §2 quirk |
| `› numeric and named entities (&#7889; &nbsp; &quot;)` | decode |
| `› broken / nested tags, stray "<" in text ("P/E < 10")` | robustness |
| `› strips control and zero-width chars, collapses whitespace, NFC-normalizes` | AC5, dedupe/match stability |
| `› capText cuts on a code point and never splits a surrogate pair` | AC2 cap |
| `canonical-url.test.ts › forces https when upgradeHttps, lowercases host, drops fragment` | AC4 |
| `› drops utm_*, fbclid, gclid; sorts remaining params; keeps other params` | AC4 |
| `› strips trailing slash on non-root path; keeps root` | AC4 |
| `› rejects non-http(s) schemes (javascript:, data:) and hosts not in linkHosts` | AC5 / safety |
| `› rejects > 2048 chars; same article from two feeds → same url` | DB check, overlap |
| `rss-date.test.ts › "Sun, 08 Nov 26 20:54:00 +0700" → 2026-11-08T13:54:00.000Z` | CafeF |
| `› 4-digit year with +0700 and GMT/Z` | Vietstock / VnExpress |
| `› rejects unparseable, missing, or out-of-range parts (no fallback to now)` | R-Time |
| `› weekday mismatch is ignored, not trusted` | robustness |
| `normalize-item.test.ts › builds NewsItem with source, credibility, fetched_at` | AC2, R4 |
| `› rejects: bad_date, future_date (> maxFutureMs after fetchedAt), empty_title, bad_url` | AC2/R-Time |
| `› caps title at maxTitleChars and excerpt at maxExcerptChars on a code point` | AC2 |
| `› excerpt comes from description through toPlainText; image markup never stored` | AC5 |
| `› dedupeNewsItems keeps the first occurrence per url and is order-stable` | AC4 |
| `link-symbols.test.ts › ticker at start / middle / end, next to punctuation and in parentheses` | AC3 |
| `› Unicode boundary: "HPGđ" or "ĐHPG" does not match; "HPG," matches` | `\b` pitfall |
| `› case-sensitive: "vic" and "Vic" never match` | AC3 |
| `› ticker inside a longer token, URL or hyphenated name (VN-Index) does not match` | false positives |
| `› stop tokens (USD, GDP, CPI, IPO, ETF, VNINDEX, VN30, HNX30) never link` | denylist |
| `› ambiguous ticker (VND, GAS, CEO) links only with a context prefix "(VND)", "mã VND", "cổ phiếu VND", "HOSE: VND", or its alias` | corroboration |
| `› only candidate symbols link; a non-candidate ticker shape is ignored` | scope |
| `› all-caps title: bare tickers ignored, context-prefixed and alias matches kept` | all-caps risk |
| `› alias with and without diacritics (fold only when alias ≥ minFoldAliasChars)` | alias |
| `› longest alias wins on overlap; aliases are word-bounded` | alias |
| `› output sorted, unique, capped at maxSymbols (first appearances kept, then sorted)`; `› same input → same output` | determinism, DB cap |
| `config.test.ts (core) › every alias key passes normalizeSymbol; aliases unique across symbols; no alias shorter than 4 chars; no alias in a generic denylist ("Việt Nam", "Ngân hàng", "Sài Gòn")` | alias hygiene |
| `gaps.test.ts › failure without open gap → insert {from: now - gapLookbackMs, to: now}` | AC4/R4 |
| `› failure with open gap(s) → extend newest to now, no insert` | no hourly duplicates |
| `› success → resolve all open gaps of that source; no open gap → no-op` | AC4 |
| `http.test.ts › getText sends only User-Agent and the given Accept, redirect: error` | polite client |
| `› getText retries 429/5xx, not 403/404; enforces maxBodyBytes; returns text` | R-Terms (no retry storm) |
| `› getJson/postJson unchanged (existing tests still pass)` | refactor safety |
| `rss.test.ts › parses RSS 2.0 items (title, link, guid, pubDate, description) with CDATA` | AC1 |
| `› namespaced feed (atom/content/media) parses` | CafeF |
| `› rejects a document containing <!DOCTYPE (entity expansion)` | security |
| `› rejects a non-UTF-8 encoding declaration; accepts a missing declaration` | encoding |
| `› malformed XML / no <channel> / zero items → SourceError (non-retryable)` | R-Gaps |
| `› truncates to maxItems` | bound |
| `news-source.test.ts › builds the three configured sources`, `› skips a disabled source`, `› fetchFeed uses getText with the source UA and rss Accept` | AC1 |
| `rss-news-source.test.ts › <source> synthetic fixture: all items normalize, dates in UTC, no "<" in excerpts, links canonical` (×3) | AC6 |
| `rss-news-source.samples.test.ts › recorded <file> parses and normalizes with 0 bad_url/bad_date` (skipIf no files) | AC6 recorded |
| `news-sync.test.ts › skips on a non-trading day without fetching (ok true, skipped: "non_trading_day")` | AC4 |
| `› sleeps minIntervalMs between feeds of one source, sources sequential` | AC4 rate limit |
| `› stops a source after maxConsecutiveFeedFailures, others continue` | isolation |
| `› dedupes items by canonical url within the batch` | AC4 |
| `› one source throws: others stored, gap recorded for it, ok false` | AC4 |
| `› 200 with zero valid items counts as a feed failure (gap)` | R-Gaps |
| `› open gap is extended, not duplicated`; `› success resolves the source's open gaps` | AC4 |
| `› rows written before gaps (call order)` | crash safety |
| `› dry-run writes nothing but reports counts` | AC4 |
| `› --source limits the run to one source` | CLI |
| `› links against watchlist ∪ held ∪ alias symbols; held-symbols ledger error → ok false, still runs` | AC3 wiring |
| `› never logs titles or excerpts` | AC5 |
| `news.test.ts (db) › insertNews upserts with onConflict url + ignoreDuplicates, chunked by chunkSize, returns inserted count` | AC2/AC4 |
| `› 2 × chunkSize + 1 rows → 3 requests, each ≤ chunkSize` | row-cap guard |
| `› error maps to DataError, no payload in the message` | consistency |
| `data-gaps.test.ts › listAllOpenGaps with source filter pages past one full page (pageSize 2, 5 rows)` | 1000-row lesson |
| `› extendGaps updates to_ts only where resolved_at is null` | gaps |
| `config.test.ts (worker) › news feeds are https rss urls on the source host`, `› insertChunkSize < 1000 and gapsPageSize ≤ 1000`, `› maxExcerptChars ≤ 10000 (DB backstop)` | AC1, row cap, DB check |
| `cli.test.ts › parses "news", "news --dry-run", "news --source vnexpress"; rejects --backfill and unknown sources` | CLI |
| `store.test.ts › news store wires insertNews / listAllOpenGaps(news, source) / extendGaps / resolveGaps` | wiring |

## Approach
1. **Core types and config (R1, R5).** `NewsCredibility` uses the spec wording: `official_disclosure`, `established_outlet`. `CREDIBILITY_RANK` gives official > established. All three sources are `established_outlet`; nothing is inferred from keywords. `NEWS_LINK_CONFIG` and a small, reviewed `NEWS_SYMBOL_ALIASES` seed (large caps only, e.g. VCB → "Vietcombank", VIC → "Vingroup", VNM → "Vinamilk", HPG → "Hòa Phát", MWG → "Thế Giới Di Động"). The implementer must not invent obscure aliases; Ming extends the list.
2. **`toPlainText`.** A character-level state machine, not a single regex. Order: drop `<script>`/`<style>` blocks, drop all tags, decode entities once, NFC, remove C0/C1 control and zero-width characters, collapse whitespace. `capText` truncates by code point. The output is plain text only. This ticket has no renderer; the UI rule ("never `dangerouslySetInnerHTML` on news") is a follow-up for the UI ticket.
3. **`canonicalNewsUrl`, `parseRssDate`, `normalizeNewsItem`, `dedupeNewsItems`.** As tested above. `published_at` more than `maxFutureMs` (1 day) after `fetchedAt` is rejected, which matches the DB check. An item with no parseable date is dropped and counted, not stored with `now`.
4. **`linkSymbols`.**
   - NFC first.
   - Ticker pass: tokens matching `[A-Z0-9]{3,10}` with Unicode boundaries `(?<![\p{L}\p{N}_\-./])…(?![\p{L}\p{N}_\-/])` (`u` flag). A token links only if it is in the candidate set, not a stop token, and (if ambiguous) has a context prefix or an alias hit.
   - In all-caps text (no lowercase letters), bare tickers are skipped.
   - Alias pass: case-insensitive, word-bounded, longest-first, non-overlapping. The diacritic fold applies only to aliases of at least `minFoldAliasChars` (6).
   - Output: sorted unique symbols, capped at `maxSymbols` (30).
   - Candidates = watchlist ∪ held symbols ∪ alias keys. The `symbols` table is not read; see Specialist input.
   - Linking never fails an item.
5. **Gaps (R4).** `planNewsGap({ failed, openGaps, now, gapLookbackMs })` returns `{ insert? , extendIds, resolveIds }`. Gaps use `data_type = 'news'`, `symbol = null`, `source` = source id. `data_gaps.data_type` has no CHECK (verified in `20261023000100_v1_tables.sql`), so no migration is needed for it. A source counts as failed if any of its feeds failed (fetch error, parse error, or 0 valid items), because news from that feed may be missed.
6. **Sources package.** Refactor `requestJson` into a shared loop that takes `accept` and a body handler. `getJson`/`postJson` keep their exact behaviour. Add `getText`.
   - `parseRssFeed`: refuse `<!DOCTYPE`, refuse a declared encoding other than UTF-8, then use `fast-xml-parser` (exact pin, latest 5.x, MIT; check `pnpm audit` and record the version in impl-log). Read `rss.channel.item` (array or single), cap at `maxItems`.
   - No enclosure, image or item-content URL is ever fetched.
7. **Worker.**
   - `NEWS_SYNC_CONFIG`:
     - `sources[]` with `{ id, name, enabled, credibility, feedUrls, linkHosts, upgradeHttps, minIntervalMs: 3000 }`
     - `timeoutMs: 15000`, `maxAttempts: 2`, `backoffBaseMs: 2000`, `maxBodyBytes: 2 MB`
     - `maxConsecutiveFeedFailures: 2`, `maxItemsPerFeed: 100`
     - `maxTitleChars: 500`, `maxExcerptChars: 2000`, `maxFutureMs: 86_400_000`
     - `gapLookbackMs: 3_600_000`, `insertChunkSize: 200`, `gapsPageSize: 1000`
     - `userAgent: 'stoktok/0.1 (personal portfolio tracker; hourly RSS check)'`
   - `runNewsSync(deps: { store, sources, now, config, sleep, log, dryRun })`:
     1. Read holidays and return early if `!isTradingDay(vnDateOf(now), holidays)`.
     2. Read candidates.
     3. For each source in sequence (in try/catch): fetch its feeds sequentially, with `sleep(minIntervalMs)` between them. Normalize, link, and collect rejects by reason.
     4. Dedupe the whole batch.
     5. If not dry-run: `insertNews` first, then per-source gap insert/extend/resolve.
     6. Return the summary: `ok`, `dryRun`, `skipped?`, `fetchedAt`, `perSource{feeds, failedFeeds, skippedFeeds, items, rejectedByReason}`, `itemsInserted`, `duplicatesInBatch`, `gapsRecorded/Extended/Resolved`, `failedSources`, `ledgerError?`.
   - `ok` is false if any source failed or there was a ledger error. Log only source id, feed URL, status and counts; never titles or excerpts.
   - CLI exit code: 0 when ok, 1 otherwise (existing pattern).
8. **DB.**
   - `insertNews` uses `upsert(chunk, { onConflict: 'url', ignoreDuplicates: true }).select('id')` and sums the returned lengths. Each response is at most `insertChunkSize` (200) rows, so it is under the PostgREST 1000-row cap. Existing URLs are never read and nothing uses `.in('url', …)`.
   - The open-gaps read uses the already-paged `listAllOpenGaps` (`fetchAll`) with a new `source` filter.
   - `listWatchlist` is unchanged and unpaged. It is existing code, bounded by personal watchlist size; noted, not changed (R7).
   - Migration `20261108000200_news.sql` (High tier; Ming reviews the PR):
     - `id bigint generated always as identity primary key`
     - `url text not null unique check (url ~ '^https?://' and char_length(url) <= 2048)`
     - `title text not null check (char_length(title) between 1 and 500)`
     - `source text not null check (source <> '')`
     - `credibility text not null check (credibility in ('official_disclosure','established_outlet'))`
     - `published_at timestamptz not null`, `fetched_at timestamptz not null`, `check (published_at <= fetched_at + interval '1 day')`
     - `symbols text[] not null default '{}'` with `check (cardinality(symbols) <= 50)` and `check (array_to_string(symbols, ',') ~ '^([A-Z0-9]{1,20}(,[A-Z0-9]{1,20})*)?$')`
     - `excerpt text not null default '' check (char_length(excerpt) <= 10000)`
     - Indexes: `(published_at desc, id desc)` and GIN on `symbols`.
     - Table and column comments (untrusted plain text, R9, ids referenced by future `suggestions.news_ids` so rows must not be silently deleted).
     - `enable row level security`, `revoke all … from public, anon, authenticated`, `grant select, insert, update, delete … to service_role`, no policies.
     - No FTS column (not in ACs; deferred).
   - `checks.sql` blocks follow consult-database-optimizer §9, with the credibility values above.
9. **`scripts/record-news-fixtures.sh`.** POSIX bash 3.2, run by Ming from the repo root, with the hardening from spaceM#21:
   - Uses the same UA as `NEWS_SYNC_CONFIG.userAgent`, `Accept: application/rss+xml, application/xml`, no cookies, Referer or browser UA, no `-L`.
   - Sets `--connect-timeout 10 --max-time 20 --max-filesize 5242880`.
   - Downloads each URL to a `.tmp` file and moves it into place **only on HTTP 200**.
   - On **any** other status (403, 404, 3xx, 5xx) or a curl error: delete the tmp file, print it, and stop at once with exit 1. No retry, no bypass.
   - Waits 3 s between requests.
   - Fetches each host's `/robots.txt` first (same rules), then every configured feed.
   - Writes `work/tickets/STK-062/live-samples/README.md` with `recorded_at_utc`, host, and per-file url / status / bytes / sha256.
   - Validated with `bash -n` (and `shellcheck` if present). The implementer does **not** run it.
10. **Checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`. Rules: R1 (all logic in core), R3 (DB only through the worker's service client), R4 (source + fetched_at + gaps), R5 (config), R7 (file list above), R8, R9 (text is data), R10 (read-only RSS; no login, no orders).

### Follow-ups (not in this diff; the orchestrator files them as `debt` issues)
- Schedule wiring in `deploy/deployment-repo` (launchd hourly 07:00–22:00 Mon–Fri + `run-schedule.sh`) once Ming has applied the migration. This is High tier (production deploy config).
- Retention (`news_retention_days`, keep rows referenced by `suggestions.news_ids`).
- Re-link backfill after alias or candidate changes.
- Full-article fetch (separate terms check).
- Staleness gap (a source whose newest item is older than N hours on a trading day).
- Vietnamese FTS column (`'simple'` tsvector, later `unaccent`).
- A paged news reader (keyset on `(published_at, id)`) for the AI ticket.
- UI rule: news is rendered as text only, never with `dangerouslySetInnerHTML`.
- AI input wraps news as quoted data and cites `news.id` (R9).
- Optional: `Retry-After` and conditional GET.
- Update spec §5 `news` to `symbols[]` (Ming).

## Specialist input used
- **data-engineer §1 (feeds, robots, terms):** adopted. The wording follows its caveat: "site terms page not read", not "terms checked".
- **§2 (date, encoding, CDATA, escaped HTML, dedupe, ordering):** adopted in full.
- **§3 (no article-page fetch, excerpt only, no body or image column):** adopted.
- **§4 (getText, config shape, job deps, per-source isolation, gap extend):** adopted.
  - `Retry-After` and conditional GET: deferred.
  - Trading-day gate: done in the job via `isTradingDay` (verified in `packages/core/src/calendar.ts`). The hours window is left to the scheduler.
- **§5 (credibility enum):** adopted, with the spec wording `official_disclosure` / `established_outlet`. Rejected the db-optimizer's `official` / `established` because the spec says "official disclosure > established outlet".
- **§6/§7 (array column, linking rules, tests):** adopted.
  - Rejected "link against the full symbols universe". The `symbols` table only holds symbols the app has touched (rows come from `setSymbolExchange` / `setSymbolSector`), so it is not the listed universe. Reading it adds a paged read and more false-positive surface for little gain. Candidates are watchlist ∪ held ∪ alias keys, and the re-link backfill is a follow-up.
- **§8 (untrusted text, R9 note, no logging of excerpts, no URL following):** adopted.
- **Recommendation 6 (fixtures recorded with curl):** adopted as a Ming-run script (see A1). Synthetic fixtures are used meanwhile and are labelled as such.
- **database-optimizer §1–§4:**
  - Adopted: `text[]` + GIN, columns and checks, no-update on conflict (first seen wins), indexes.
  - Changed: the cardinality cap is 50 in the DB (the code caps at 30). Market round-ups can name more than 20 tickers, and a CHECK failure would reject a whole chunk.
  - Changed: canonical URL params. Only `utm_*`, `fbclid` and `gclid` are dropped. Generic `ref`/`source` are kept, because over-stripping merges distinct articles (its own risk note).
- **§5 (FTS):** deferred. It is not in the ACs.
- **§6 (retention):** deferred to debt.
- **§7 (row cap: upsert without read-back, ≤ 200 per chunk, paged reads, boundary test):** adopted.
- **§8–§10 (migration, rollback, checks.sql, untrusted text):** adopted.

## Assumptions
- **A1. Fixtures (deviation from AC6's literal wording; reversible, stated default).** The implementer cannot reliably fetch raw bytes, and live calls to third-party sites are a human step in this repo (STK-049, STK-061 precedent).
  - Default: implement against synthetic, format-faithful fixtures (clearly labelled) plus the opt-in recorded-samples test.
  - Ming runs `scripts/record-news-fixtures.sh` on the branch and commits `work/tickets/STK-062/live-samples/` **before merging**. The PR body lists this as a merge condition.
  - This PR is High tier (migration), so Ming reviews it anyway.
  - If Ming prefers to record first, the same curl steps can be run before IMPLEMENT and the implementer uses the recorded files directly.
  - The orchestrator should open a `decision` issue for this.
- **A2. Spec §5 single `symbol` vs ticket "linked symbols".** Default: the ticket wins (`symbols text[]`), because it is the newer and more specific requirement. It is flagged here and as a follow-up to update the spec.
- **A3. "Runs hourly on trading days".** Default: the job enforces the trading-day rule itself, and the README documents the hourly 07:00–22:00 Asia/Ho_Chi_Minh schedule. The launchd/`run-schedule.sh` change is a follow-up after the migration is applied (STK-061 precedent: "Not scheduled yet"). Deploy config is High tier, and scheduling before the table exists would fail every hour.
- **A4.** Weekend news is not fetched (spec: trading days). Feed items stay in the feeds about 2–3 days, so Monday's 07:00 run picks up most weekend items.
- **A5.** Vietstock serves the same article over https. `upgradeHttps: true` for all three sources; if the recorded feed shows otherwise, set it to false in config.
- **A6.** CafeF feeds without an XML declaration are UTF-8. A feed declaring another encoding is a failure (gap), not decoded.
- **A7.** `fast-xml-parser` is an acceptable new dependency (MIT, widely used). It is not a stack change. The version is pinned and noted in impl-log for Ming's PR review.
- **A8.** Excerpt cap 2000 chars (config) with a 10000 DB backstop; title cap 500.

## Blocking questions
None.

## Split proposal
None. Estimate: about 700 production lines (core ~300, sources ~120, worker ~200, db + SQL ~150, script ~70) plus tests and fixtures. It is one spec feature (F5 collection only). If the implementer's non-test diff clearly exceeds ~900 lines, stop after steps 1–6 + 8 (core, sources, migration, db repos: AC2, AC3, AC5) and record the remaining worker job, CLI and script (AC1 wiring, AC4, AC6) as slice 2 in impl-log rather than cutting tests.

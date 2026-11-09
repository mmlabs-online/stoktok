STK-062 consult (data-engineer). Read-only. "Saw" = observed through WebFetch on 2026-11-08. "Assumed" = not verified.

## Findings

### 1. Feeds and terms check

WebFetch summarizes pages with a small model, so these are not raw bytes. Re-verify with curl before recording fixtures.

| Site | Feed URLs seen | Format seen | robots.txt (saw) | Terms (saw) |
|---|---|---|---|---|
| CafeF | https://cafef.vn/thi-truong-chung-khoan.rss, https://cafef.vn/doanh-nghiep.rss, https://cafef.vn/vi-mo-dau-tu.rss, https://cafef.vn/tai-chinh-ngan-hang.rss. All are listed on https://cafef.vn/rss.chn. | RSS 2.0 with atom, content and media namespaces. 50 items, newest first. `<ttl>15</ttl>`. | `User-agent: *`, `Allow: /`. Sitemaps only. No Crawl-delay. | Not verified. `/dieu-khoan-su-dung.chn` returned 404. I found no RSS terms page. |
| Vietstock | https://vietstock.vn/830/chung-khoan/co-phieu.rss, plus /739/chung-khoan/giao-dich-noi-bo.rss, /741/chung-khoan/niem-yet.rss, /738/doanh-nghiep/co-tuc.rss, /737/doanh-nghiep/hoat-dong-kinh-doanh.rss, /761/kinh-te/vi-mo.rss. All are listed on https://vietstock.vn/rss. | RSS 2.0, no namespaces, `encoding="utf-8"`. 20 items, newest first. | `User-agent: *`. Disallow `/*.js`, `/*.css`, `/manager`, `/export`, `/cache`. RSS paths are not disallowed. No Crawl-delay. | The RSS page says RSS is a reader convenience for subscribing and getting updates in a news reader. It has no separate RSS terms, only "© Bản quyền thuộc về Vietstock". The site-wide terms were not read. |
| VnExpress Kinh doanh | https://vnexpress.net/rss/kinh-doanh.rss (verified). No sub-feeds listed. | RSS 2.0, `encoding="UTF-8"`. 60 items, not strictly date-ordered. | `User-agent: *`, `Allow: /`. Many scraper bots are disallowed by name. Claude-User and Claude-SearchBot are explicitly allowed. Our UA must not be one of the blocked bots. | https://vnexpress.net/rss says feeds are free for individuals and non-profits. Users must clearly give source information. VnExpress may ask you to stop distributing at any time. It says nothing on commercial use or modification. |

- **Fit with v1:** All three robots.txt files allow the RSS paths. Use is personal and single-user, which matches the VnExpress "individuals" licence.
- **Attribution (VnExpress):** Store `source` and `url`, and show both wherever news is displayed. Never present an excerpt as our own text.
- **Terms gap (CafeF and Vietstock):** I did not find a readable general terms page for either. Ming's 2026-11-08 approval still stands, but the plan should say "robots.txt allows; no RSS-specific terms found; site terms page not read". It should not say "terms checked".

### 2. Format quirks (all seen)

- **Date formats differ per source:**
  - CafeF: `Sun, 08 Nov 26 20:54:00 +0700`. The year has two digits, which is RFC 822 and not accepted by every parser.
  - Vietstock and VnExpress: `Sun, 08 Nov 2026 18:00:00 +0700`.
  - Write one `parseRssDate` that handles both. Treat 2-digit years as 20yy. Keep the offset and convert to a UTC ISO string. Reject an unparseable date; do not fall back to `now`.
  - Also reject `published_at` more than about 1 day in the future. Clock skew is possible. Cap or flag, never silently trust.
- **Encoding:**
  - Two feeds declare UTF-8. CafeF has no XML declaration, so assume UTF-8. This is not verified at byte level.
  - Do not reuse `getJson`'s `readCapped`, which decodes with `new TextDecoder()` as UTF-8. That is fine here, but add a `getText` variant (or `getText` plus a parser option) in `packages/sources/src/http.ts`. Its `Accept` header must be `application/rss+xml, application/xml`.
  - Normalize the text to NFC. Vietnamese can arrive precomposed or decomposed, which breaks matching and dedupe.
- **CDATA and entities:**
  - CafeF and VnExpress wrap `description` in CDATA containing `<a><img></a>` plus text. VnExpress uses a `</br>` tag.
  - Vietstock HTML-escapes the markup (`&lt;img ... /&gt;`). Parsing the XML gives a string that is still HTML, so it needs a second pass.
  - Pipeline: XML-decode, then strip HTML, then decode entities, then collapse whitespace.
  - Do not strip with a regex alone. Remove `<script>`/`<style>` content, drop all tags, decode entities once, and strip control characters and zero-width characters.
- **guid:**
  - `guid` equals `link` in all three. CafeF has no `isPermaLink`. Vietstock links are `http://`, not `https`.
  - Dedupe on a canonical URL, not the raw string. Canonicalize as follows: force https, lowercase the host, drop the fragment and `utm_*` parameters, and trim trailing whitespace.
  - Keep the original `link` only if it differs.
- **Feed overlap:** The same article appears in several feeds of one site (CafeF market and business, for example). Unique `url` handles this. Also dedupe within a batch before upserting, or the upsert errors on a duplicate key.
- **Ordering:** VnExpress is not sorted. Never assume the first item is newest. Sort by `published_at`.

### 3. How much text RSS gives

- All three give a 1-2 sentence teaser (plus a thumbnail), not the body. This was seen for CafeF and Vietstock, and for VnExpress (summary text after the image).
- **Recommendation: do not fetch article pages in v1.** Reasons:
  - It adds 20-200 requests per run.
  - robots.txt is probably fine, but the terms are unclear (see §1).
  - It adds scraping fragility and an XSS surface.
  - The AI summary can use title plus excerpt. The AC says "excerpt or body capped".
- Store `excerpt` (plain text, capped by `NEWS_CONFIG.maxExcerptChars`, e.g. 1000). Do not add a `body` column in v1.
- Never store the thumbnail `<img>` markup. Storing `image_url` is optional and not needed.
- If Ming later wants full text, make it a separate ticket with its own terms check.

### 4. Existing code patterns

- **HTTP:**
  - `packages/sources/src/http.ts` provides `getJson` and `postJson`: polite client, UA and Accept only, `redirect: 'error'`, 5 MB cap, retry on 429/5xx, `SourceError(message, retryable, status)`.
  - `apps/worker/src/sources/http.ts` re-exports it.
  - Add `getText` there, reusing `requestJson`/`readCapped`. Keep `redirect: 'error'`. If a feed 301s, that is a failure and a gap, which is the right behaviour.
  - Put the shared XML/RSS parsing in `packages/sources`. I did not see an XML dependency in the repo. Choose one small, well-maintained parser (e.g. `fast-xml-parser`) and do not hand-roll XML. Entity-expansion limits must stay on. Check pnpm's lockfile and licence.
- **Config (R5):**
  - Follow `VCI_INTRADAY_CONFIG` and `FINANCIALS_SYNC_CONFIG`. Add `NEWS_SYNC_CONFIG` in `apps/worker/src/config.ts` with:
    - per-source `{ id, name, feedUrls[], credibility, minIntervalMs }`
    - `requestDelayMs`
    - `maxConsecutiveFailures`
    - `timeoutMs`
    - `maxAttempts`
    - `maxExcerptChars`
    - `maxItemsPerFeed`
    - `userAgent`
  - UA: an honest one, as in VCI, with contact information. Do not use browser headers.
- **Job:**
  - Model `runNewsSync(deps)` on `runFinancialsSync` in `apps/worker/src/jobs`.
  - Deps are injected: store, sources, now, config, sleep, log, dryRun.
  - It returns a summary with `ok`.
  - Wire it in `cli.ts` as the `news` job with `--dry-run`, add a `--source` choice if wanted, and add a README schedule section. The README says scheduling is "documented only, no scheduler code".
  - Trading-day gating: grep for `isTradingDay` only found `packages/core/src/index.ts`. I did not read it, so the helper was not verified. EOD sync runs harmlessly on non-trading days.
  - For news, "hourly on trading days" is cheap to satisfy in a crontab. Alternatively the job can early-exit on a weekend or holiday using core's calendar. I suggest running hourly 07:00-22:00 on trading days only (assumed, a plan decision).
  - News also appears on weekends. The spec only says hourly on trading days, so keep to it and note it in Risks.
- **Gaps (R4):**
  - `data_gaps` has `symbol` (nullable), `data_type`, `from_ts`, `to_ts`, `detected_at`, `source`, `fetched_at`, `resolved_at`, plus `resolved_reason` from the 20261105 migration.
  - Use a new `data_type = 'news'` (in core as a constant like `FINANCIALS_GAP_TYPE`), `symbol = null`, `source` = the news source id.
  - `from_ts` is the last successful fetch time (or `now - 1h` if none). `to_ts` is `now`.
  - Resolve the open gap on the next successful fetch of that source.
  - Check that the `data_gaps` insert/uniqueness logic in `packages/db/src/repos/data-gaps.ts` and the CHECK on `data_type` (if any) allow `'news'`. I did not read these. The v1 tables migration did not show an enum for it, but check.
  - Avoid inserting a new gap every hour while a source stays down. Look up the open gaps first, as financials does with `listOpenGaps`, and extend instead.
  - A feed that returns HTTP 200 with 0 items or a parse failure is a gap, not "no news". A feed that returns items older than the last run's newest item is fine.
- **Source isolation:**
  - Wrap each source in try/catch, as `financials-sync` does per symbol.
  - Do not use `maxConsecutiveFailures` across sources. One source failing must not skip the others.
  - Within one source, use a per-source consecutive-failure limit across its feeds.
  - Use `ok: false` and a non-zero exit if any source failed, but still write the rows from the sources that worked.
- **Rate limits:**
  - Sequential requests per source, `sleep(minIntervalMs)` between feeds, say 2-5 s.
  - Run sources in sequence, or with a small `Promise.allSettled` since hosts differ. Sequential is simplest and the load is tiny (3-6 requests per hour).
  - Honour `Retry-After` on 429 (not currently in `getJson`, which uses plain backoff). It is optional, but a 429 should not retry within the same run more than `maxAttempts`.
  - Cache validators: send `If-None-Match`/`If-Modified-Since` and store `etag`/`last_modified` per feed. It is polite, but unverified for these hosts, so treat it as optional. With 15-min TTL and hourly polling it is not needed.
- **Feed selection:**
  - CafeF: `thi-truong-chung-khoan.rss` and `doanh-nghiep.rss`.
  - Vietstock: `co-phieu`, `giao-dich-noi-bo`, `niem-yet`, `co-tuc`, `hoat-dong-kinh-doanh`, `vi-mo`.
  - VnExpress: `kinh-doanh.rss`.
  - Keep the list in config so Ming can trim it.

### 5. Credibility

- The AC says "official disclosure > established outlet". None of these three feeds is an official disclosure (HOSE/HNX/SSC filings). Vietstock's "Giao dịch nội bộ" and "Niêm yết" are press items about disclosures, not the disclosures themselves.
- Define `credibility` as a small enum in core: `official_disclosure`, `established_outlet`. Assign `established_outlet` to all three now. Leave room for a future disclosure source.
- Do not infer `official_disclosure` from keywords.

### 6. `news` table

- **Spec mismatch to flag:** spec §5 lists `news` as id, symbol, title, url, source, published_at, credibility. That is one symbol per row. The ticket wants unique `url` with linked symbols. These conflict, and the ticket and its AC win here, but flag the discrepancy in the plan.
- **Suggested columns:**
  - `id bigint identity pk`
  - `url text not null unique`
  - `title text not null`
  - `source text not null`
  - `credibility text not null check (in (...))`
  - `published_at timestamptz not null`
  - `fetched_at timestamptz not null`
  - `excerpt text not null default ''` with `check (char_length(excerpt) <= N)`
  - `symbols text[] not null default '{}'` with a check `symbols <@` a pattern array, or use a join table `news_symbols(news_id, symbol)`
- **Join table vs array:** The array is simpler, with a GIN index. A join table is cleaner for "news for symbol X" queries and for re-linking later. For v1 the array plus a GIN index is enough.
- **Indexes:** `(published_at desc)`, GIN on `symbols`.
- **RLS and grants:**
  - RLS on, service_role only. Copy the style in `20261023000200_v1_rls_grants.sql`.
  - No anon or authenticated policies, and `revoke all` from them.
  - Add a rollback file in `supabase/rollback/`.
  - Add the table to `scripts/db-check/checks.sql`.
  - Add the row types and mapper in `packages/db`.
- **Upsert:** use `on conflict (url) do nothing` for new items. If the excerpt or title changed, an update is optional. A stricter approach is to update `title`, `excerpt` and `symbols` only (never `fetched_at`/`published_at`). Re-linking after the alias list changes needs a backfill job; mention it as a follow-up.
- **Retention:** no retention is specified. At about 100-300 rows per day it is small, so skip pruning for v1 and note it.

### 7. Deterministic symbol linking (`packages/core`)

Requirements: ticker match with word boundaries plus a company-name alias list, no LLM, unit tests.

- **Where:** `packages/core/src/news/link-symbols.ts`. Use `normalizeSymbol` from `packages/core/src/symbol.ts` (`^[A-Z0-9]{3,10}$`).
- **Input:** text (title + excerpt), the candidate symbol set (watchlist + holdings, or the whole listed universe), and an alias map `{ symbol: string[] }`. The alias list is config, loaded from a data file in core or the worker config (R5).
- **Output:** a sorted, unique array of symbols. Optionally return `{ symbol, via: 'ticker'|'alias' }` for tests and debugging.
- **Ticker match:**
  - Match only on uppercase tokens, case-sensitive. "VIC" matches, "vic" does not.
  - Boundary: `(?<![\p{L}\p{N}_])TICKER(?![\p{L}\p{N}_])` with the `u` flag. JS `\b` is ASCII-only and gives wrong results next to Vietnamese letters, so use Unicode property escapes or a manual tokenizer.
  - NFC-normalize first.
  - Do not match inside URLs, hashtags or e.g. `VN-Index`. For `VN30` or `VNINDEX`, never treat index names as tickers: add an index denylist.
- **False positives (main risk):**
  - Real HOSE/HNX tickers that are common words or abbreviations include `ACB`, `CEO` (a real HNX ticker), `DXG`, `TCB`, `HAG`, `FPT`, `VND`, `GAS`, `BID`, `SAB`, `PNJ`. Several are also ordinary acronyms: `VND` (the currency), `GAS` (the commodity), `CEO`, `ETF`, `GDP`, `FED`, `USD`, `IPO`, `CPI`, `ESG`, `AI`.
  - I did not verify the current listing for each of these. Use them as test cases, not as facts. Build the fixtures from the real universe.
  - Rules:
    1. A configurable ambiguity denylist of tickers that match only with corroboration. Corroboration is the company alias in the same text, or a context pattern such as `(VND)` / `mã VND` / `cổ phiếu VND` / `VND:` / `HOSE: VND`.
    2. A hard stoplist of acronyms never linked by bare ticker (`USD`, `VND` as currency, `GDP`, `CPI`, `IPO`, `ETF`, `FED`, `CEO`, `ESG`, `NIM`, `ROE`, `ROA`, `EPS`, and similar). Note `VND` needs the context rule, not a hard stoplist, because it is also a real ticker.
    3. Tickers of 2 characters or fewer are not accepted (the current `normalizeSymbol` already requires 3-10).
  - Do not lower-case the text for matching. Vietnamese words in uppercase headlines (all-caps titles) could produce matches. Handle all-caps titles by requiring a corroborating signal such as a context pattern, or skip ticker matching on all-caps titles and use aliases.
  - Digits: a ticker such as `E1VFVN30` has digits and a pure-number token must not match.
- **Alias list:**
  - Map alias -> symbol. Matching is NFC-normalized, accent-insensitive on request (compare an accent-stripped fold too, since headlines often drop tone marks), case-insensitive, and word-bounded.
  - Prefer longest-match-first, so "Ngân hàng TMCP Ngoại thương Việt Nam" (VCB) wins over a shorter overlapping alias.
  - Aliases must be specific. "Vingroup", "Hòa Phát", "Vinamilk" are fine. A bare "Việt Nam", "Ngân hàng" or "Sài Gòn" is not, since it collides with other companies. Examples: "Hòa Phát" also appears in other names, and "Vietcombank" is a trademark for VCB, so check those.
  - Stripping Vietnamese diacritics can create collisions between different words. Test it, and fold only if the alias itself is long (e.g. 6+ characters).
  - Seed aliases for the symbols Ming actually holds or watches plus a top-N list. The alias list needs a maintainer: put it in a reviewed config file and add a check that every alias maps to a known symbol.
- **Scope of symbol set:** Linking only to symbols known to the app (watchlist, holdings, or the symbols table) avoids stray matches. But then news about a later-added symbol is not retroactively linked. Alternative: link against the whole `symbols` universe, and store all linked symbols. I recommend linking against the full known-symbols table, with the ambiguity rules above, so later watchlist additions find old news. This is a plan decision (see Open questions).
- **Tests:**
  - Ticker at start/middle/end of text, next to punctuation and Vietnamese letters, in parentheses.
  - Case-sensitive negatives (`vic` and `Vic` do not match).
  - Ticker inside a longer word or URL.
  - Currency/acronym stoplist.
  - Ambiguous tickers with and without context.
  - Alias with and without diacritics, overlapping aliases, longest-match.
  - All-caps headline.
  - Determinism: same input, same sorted output.
  - Also run the recorded RSS fixtures through it.
- **R1:** this is domain logic, so it belongs in `packages/core` and not in the worker (R1). The rule also applies to R2/R7: no float or financial calculation is involved.

### 8. Untrusted text (AC 5)

- Strip HTML in one function in core or sources: `toPlainText(html)`. Test with `<script>`, event handlers, `javascript:` hrefs, nested or broken tags, entities (`&amp;lt;`), and CDATA. Store only the result.
- Keep it as plain text end to end:
  - No `dangerouslySetInnerHTML` anywhere that reads `news`.
  - Make this a rule for the later UI ticket, and cite it in the plan.
- **Prompt injection (R9):**
  - Titles and excerpts will feed the AI summaries and the chat agent. A headline like "Ignore previous instructions..." is possible.
  - Out of scope for this ticket, but record a follow-up note: the AI input must wrap news as quoted data, and the output must cite news ids.
  - Store a cap on length and strip control characters so that the stored text cannot smuggle delimiters.
- Never log full excerpts (they are noise, and could carry injected text).
- SSRF is not a concern because only hardcoded config URLs are fetched, and `redirect: 'error'` stays on. Do not follow URLs found inside item content.
- Never fetch `enclosure` or image URLs.

## Recommendations (tied to criteria)

1. **AC1 (NewsSource, robots/terms):**
   - Define `NewsSource` in `apps/worker/src/sources/news-source.ts`, e.g. `{ name; feeds; fetchFeed(feed): Promise<NewsItem[]> }`.
   - Use one generic RSS implementation plus three config entries and per-source parse quirks (CafeF 2-digit year, Vietstock escaped HTML). Do not write three classes if one parser suffices. If the ticket insists on three, keep them thin.
   - Put the robots/terms table from §1 into plan.md, marked as seen vs assumed. All three can stay in.
2. **AC2 (table):** §6. Flag the spec §5 mismatch.
3. **AC3 (linking):** §7. Put `linkSymbols` and `toPlainText` in `packages/core` with tests. Export from `packages/core/src/index.ts`.
4. **AC4 (job):**
   - `runNewsSync` as in §4, with per-source isolation and gaps recorded.
   - Write the gap and the rows in an order that never leaves a gap without its fetch record (insert rows first, then gaps, as financials does).
   - `--dry-run` writes nothing.
5. **AC5 (untrusted text):** §8.
6. **AC6 (tests):**
   - Record one real feed per source into `apps/worker/src/sources/__fixtures__/` (or similar). Trim to about 5-10 items, keeping real Vietnamese text and the CDATA/escaped variants. Take them with curl at implementation time. Do not paste anything that came from my WebFetch summary.
   - Test the date parser on all three formats, the dedupe, partial failure (one source throws, the others are stored and a gap is recorded), 0-item feed, malformed XML, and an oversize body.
7. **Security reviewer:** Triggered by the new migration/RLS. Check the grants and that `news` is unreachable from anon.

## Risks

- R-Terms: CafeF and Vietstock terms were not read. Fix by wording the plan precisely and keeping a source easy to turn off in config. VnExpress may ask to stop at any time, so a feed 403 should become a gap with a clear log, not a retry storm.
- R-Linking: Ticker/word collisions will cause false links, and false links flow into AI summaries and suggestions. Prefer missing a link over a wrong link, and test the denylist.
- R-Gaps: A 200 response with an empty or stale feed looks healthy. Add a staleness check: if a source's newest item is older than N hours on a trading day, record a gap.
- R-Time: Date quirks (2-digit years, mixed order) can produce a wrong `published_at`. News that is later used to judge "news before a suggestion" would be wrong.
- R-Parser: A new XML dependency is added to the supply chain. Pin it and review it.
- R-Cache: Feed items disappear from the feed after about 2-3 days (CafeF items ran 6-8 Nov, Vietstock 5-8 Nov). A missed outage longer than that loses news permanently and cannot be backfilled. The gap record is the only trace.
- R-Schedule: Hourly on trading days only misses weekend news. This is acceptable per the spec.

## Open questions (proposed defaults)

1. Link against the full symbols universe or only watchlist/holdings? Default: the full known-symbols table, so later additions find older news.
2. `symbols text[]` with a GIN index, or a join table? Default: `text[]`.
3. Add an `etag`/`last_modified` conditional GET? Default: no.
4. Fetch article pages? Default: no (RSS excerpt only). A separate ticket if wanted.
5. Which feeds per source? Default: the list in §4. Ming can trim.
6. Is the hourly schedule 07:00-22:00 Asia/Ho_Chi_Minh on trading days? Default: yes. Open question: should the job also run on weekends? Default: no (spec).
7. Is a gap `data_type = 'news'` accepted by `data_gaps` (any CHECK or enum, and the repo code in `packages/db/src/repos/data-gaps.ts`)? Not verified, so the plan should check this first.
8. Source UA: is the contact string in the UA (like VCI) acceptable? Default: yes, honest UA with a project name, no browser spoofing.

## Relevant files

- D:\mmlabs\spaceM\projects\stoktok\work\tickets\STK-062\ticket.md
- D:\mmlabs\spaceM\projects\stoktok\packages\sources\src\http.ts
- D:\mmlabs\spaceM\projects\stoktok\packages\sources\src\config.ts
- D:\mmlabs\spaceM\projects\stoktok\packages\sources\src\index.ts
- D:\mmlabs\spaceM\projects\stoktok\apps\worker\src\sources\http.ts
- D:\mmlabs\spaceM\projects\stoktok\apps\worker\src\jobs\financials-sync.ts
- D:\mmlabs\spaceM\projects\stoktok\apps\worker\src\config.ts
- D:\mmlabs\spaceM\projects\stoktok\apps\worker\src\cli.ts
- D:\mmlabs\spaceM\projects\stoktok\apps\worker\README.md
- D:\mmlabs\spaceM\projects\stoktok\packages\core\src\symbol.ts
- D:\mmlabs\spaceM\projects\stoktok\supabase\migrations\20261023000100_v1_tables.sql
- D:\mmlabs\spaceM\projects\stoktok\supabase\migrations\20261023000200_v1_rls_grants.sql
- D:\mmlabs\spaceM\projects\stoktok\packages\db\src\repos\data-gaps.ts

Not read: the data-gaps repo, `store.ts`, and the core trading-calendar helper. Confirm these before writing the plan.

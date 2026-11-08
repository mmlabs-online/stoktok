# STK-062 security review

## Attempt 1

# STK-062 security review, attempt 1

**Verdict: no blockers (🔴 none).** Three 🟡 items should be fixed or ticketed before merge. Everything else in scope checks out. I read the code statically only: I ran nothing, and `scripts/db-check.sh` has not been run by anyone yet (see Risks).

## Findings

### 🟡 F1: Text that looks like markup survives "plain text" (AC5 is weaker than it reads)
- **Where:** `packages/core/src/news/plain-text.ts:66-67`, with `packages/sources/src/rss.ts:19-24`.
- **What happens:**
  - `toPlainText` strips tags first and decodes entities second.
  - fast-xml-parser (default `processEntities: true`) has already decoded the XML entities once. CDATA content is passed through raw.
  - So a feed `<description><![CDATA[&lt;img src=x onerror=alert(1)&gt;]]></description>`, or `&amp;lt;img…&amp;gt;` outside CDATA, is stored as the literal text `<img src=x onerror=alert(1)>`.
  - CDATA descriptions are the normal shape for these feeds.
- **What it means:** this is not exploitable today. There is no UI, and React escapes text by default. But the stored "HTML stripped" text can still hold markup. It becomes XSS the first time anything uses `dangerouslySetInnerHTML`, a markdown renderer that allows HTML, or an AI output rendered as HTML.
- **The test pins this behaviour:** `plain-text.test.ts:23-24` expects `&amp;lt;b&amp;gt;` → `&lt;b&gt;`, which the XML layer had already turned into `<b>`.
- **One-commit fix:** run the tag strip again after decoding: `stripTags(decodeEntities(stripTags(html)))`, then the NFC and control-character steps.
  - Text like "P/E < 10" survives, because `stripTags` only treats `<` followed by `[A-Za-z/!?]` as a tag.
  - Add an end-to-end test: `parseRssFeed` → `normalizeNewsItem` with a CDATA `&lt;script&gt;` description. Assert there is no `<[A-Za-z/!?]` in the output.

### 🟡 F2: Migration does not revoke the identity sequence explicitly
- **Where:** `supabase/migrations/20261108000200_news.sql:30-32`.
- **What:** `news_id_seq` gets no `revoke all on sequence public.news_id_seq from anon, authenticated;`. The precedent `20261026000200_signals.sql:41,43` does this.
- **Why it is probably fine:** the default-privilege revoke in `20261023000200_v1_rls_grants.sql:17-18` most likely covers it. The `no_grants_anon_authenticated_public` sequence check (`checks.sql:207-209`) would also catch a leak, but only if someone runs it. Exposure is low (a sequence, not data), but this is a High-tier path.
- **Fix:** add the revoke line to match signals. Service role does not need `usage` on an identity sequence, but adding `grant usage, select … to service_role` like signals does is harmless.

### 🟡 F3: The recorder fetches every feed before anyone reads robots.txt
- **Where:** `scripts/record-news-fixtures.sh:50-62`.
- **What:** robots.txt is saved, then all of that host's feeds are fetched in the same pass. Ming reads the robots files only afterwards (line 74). If a host has since disallowed `/…rss`, the script has already fetched it.
- **Also:** robots.txt is requested with the RSS `Accept` header (line 35). This is cosmetic.
- **Fix:** two passes. Fetch all robots files, then stop and print "review robots-*.txt, then re-run with `--feeds`". Alternatively, refuse to fetch a feed whose path prefix matches a `Disallow` line under `User-agent: *`.

### 🟢 What checked out
- **RLS and grants** (`news.sql:30-32`): RLS on, no policies, `revoke all … from public, anon, authenticated`, CRUD for service_role only. This matches the generic checks (`rls_enabled_all_tables`, `no_policies`, `anon_denied`/`authenticated_denied` loop at `checks.sql:186-220`). Rollback `supabase/rollback/20261108000200_news.down.sql` is a clean `drop table if exists`.
- **DB backstops** (`news.sql:6-17`):
  - URL scheme `^https?://` and ≤2048 chars, so `javascript:` is blocked at the DB as well as in core (`canonical-url.ts:35`).
  - Title/excerpt lengths match config (500 / 2000 ≤ 10000).
  - Symbols are limited by a regex and a 50-item cap.
  - `published_at` may be at most 1 day after `fetched_at`.
  - The checks.sql negative tests cover these (`checks.sql:484-499`).
- **Service role (R3):** `@stoktok/sources` and `fast-xml-parser` are dependencies of `apps/worker` only. Nothing reaches `apps/web` or a `NEXT_PUBLIC_*` variable. The worker uses the existing `createServiceClient`. No new secret names, and no secret values anywhere in the diff.
- **XML attacks** (`rss.ts:15-18`):
  - Any DOCTYPE is refused (no XXE, no billion-laughs). This also rejects a DOCTYPE string inside CDATA, which fails safe.
  - Non-UTF-8 encodings are refused; the document is validated before parsing; `ignoreAttributes`; `parseTagValue: false`.
  - Results are capped at `maxItems`.
  - The 5.12.0 pin is later than the known prototype-pollution and ReDoS CVEs (fixed in the 4.x line).
- **SSRF and redirects:**
  - Feed URLs come only from hard-coded config (`apps/worker/src/config.ts:155-182`). Nothing from feed items is ever fetched (`rss.ts:11`).
  - `redirect: 'error'` (`http.ts:67`); timeout via `AbortSignal.timeout`, which also covers reading the body.
  - Stored links must be on an allow-listed host (`canonical-url.ts:36-38`): no userinfo, http(s) only, fragment dropped. Off-host phishing links are rejected.
- **Size caps** (`http.ts:91-115`): a declared `Content-Length` over the cap is rejected; streamed bytes are counted and the stream is cancelled at the cap (worker cap 2 MiB, `config.ts:191`). No retries on 403/404; 429/5xx get at most 2 attempts.
- **Control and invisible characters** (`plain-text.ts:69-70`): `\p{Cc}\p{Cf}` is stripped, which removes bidi overrides, zero-width characters, BOM and the Unicode tag block. The tag block is the usual "ASCII smuggling" route for prompt injection. U+2028/2029 become spaces. Entities above U+10FFFF and surrogate entities are dropped.
- **Logging (R9):** `news-sync.ts:139,145` logs source id, config URL and fixed error messages, never article text.
- **ReDoS / complexity:** `stripTags`, `tagEnd`, the `linkSymbols` regex and the alias `indexOf` scans are all linear or bounded. There is no backtracking regex on untrusted input.
- **Recorder posture:** honest UA, identical to config. curl defaults: no cookies, no Referer, no `-L`, so a 3xx counts as non-200 and stops the run. Connect/total timeouts; 3 s pause; any failure deletes the temp file and exits. A here-string rather than a pipe, so `exit 1` really stops the script.

## Recommendations
1. **F1 → AC5:** apply the strip → decode → strip order and add the end-to-end CDATA test before merge.
2. **F2 → AC2 / High tier:** add the explicit sequence revoke, then run `scripts/db-check.sh` against a local Supabase. That run is the only real proof of the RLS and grant claims, and it has not happened (impl-log line 40).
3. **F3 → AC1:** split the recorder into a robots pass and a feeds pass, so Ming's review happens before the feeds are fetched.
4. **R9, later AI use:** open a `debt` issue now (it is in the plan's follow-ups but has no issue yet). When news feeds the AI:
   - put titles and excerpts in a delimited data block inside a user-role message, never the system prompt;
   - give that call no tools;
   - require cited `news.id`s, matching R9.
   - Stored text can carry instructions such as "ignore previous instructions…"; nothing here prevents that, and nothing here should.
5. **UI follow-up:** when the news list ships, the reviewer should reject any `dangerouslySetInnerHTML` or HTML markdown on `news.title`/`excerpt`. For `<a href={news.url}>`, use `rel="noopener noreferrer"` and re-check the `https:` scheme on render.

## Risks
- **Migration never executed:** RLS and grants are verified on paper only, on a High-tier path.
- **Stored injection payloads:** these are permanent rows ("must not be silently deleted", `news.sql:23`). Any future renderer or AI path inherits them.
- **Parser stack depth:** an absurdly deep but well-formed 2 MiB feed could exhaust the stack in the recursive XML parsing. It would be caught by the per-feed `catch` (`news-sync.ts:135`) and recorded as a gap. This needs a hostile or compromised outlet; low.
- **`--max-filesize` in the recorder:** only enforced while streaming on curl ≥ 8.4. On older curl a chunked response with no Content-Length is unbounded within the 20 s window. Low.

## Open questions
1. Will `live-samples/` (full third-party RSS text, "© Bản quyền thuộc về Vietstock") be committed to a public or shared repo? Default: commit only after trimming each sample to a few items; keep the full files local.
2. Is it acceptable that `credibility` is always `established_outlet`, given that Vietstock's `giao-dich-noi-bo` feed is relayed disclosure, not official disclosure? Default: yes for v1, since it is a third-party relay.

Files reviewed (all under `D:\mmlabs\spaceM\projects\stoktok\`):
- `supabase\migrations\20261108000200_news.sql`
- `supabase\rollback\20261108000200_news.down.sql`
- `scripts\db-check\checks.sql`
- `packages\sources\src\http.ts`
- `packages\sources\src\rss.ts`
- `packages\core\src\news\plain-text.ts`
- `packages\core\src\news\canonical-url.ts`
- `packages\core\src\news\normalize-item.ts`
- `packages\core\src\news\link-symbols.ts`
- `packages\core\src\news\config.ts`
- `apps\worker\src\sources\news-source.ts`
- `apps\worker\src\jobs\news-sync.ts`
- `apps\worker\src\config.ts`
- `apps\worker\src\store.ts`
- `apps\worker\src\cli.ts`
- `packages\db\src\repos\news.ts`
- `scripts\record-news-fixtures.sh`

## Attempt 2

## STK-062 security re-check, attempt 2 (commit 58abb0a)

**Verdict:** no 🔴. F1 is **still open**. The `htmlEntities: true` change is safe, but it does not fix F1. F2 and F3 are unchanged. I only read the code and ran nothing.

### Findings

🟡 **F1 is not resolved, in either case.**
- `packages/core/src/news/plain-text.ts:75` still does `decodeEntities(stripTags(html))`: one strip, then the decode. There is no second strip.
- **CDATA + entities:** fast-xml-parser 5.12.0 hands CDATA text through without decoding it. `OrderedObjParser.js:413` calls `parseTextData(..., escapeEntities=true)`, so `replaceEntitiesValue` is skipped (line 158).
  - `<description><![CDATA[&lt;img src=x onerror=alert(1)&gt;]]></description>` reaches `toPlainText` as the raw text `&lt;img…&gt;`.
  - `stripTags` sees no tag, so nothing is removed. Then `decodeEntities` at line 62 turns it into the literal `<img src=x onerror=alert(1)>`, and that is what gets stored.
- **Double-encoded, no CDATA:** `&amp;lt;img&amp;gt;` is decoded once by the parser (a single pass, `EntityDecoder.js:409-500`) to `&lt;img&gt;`. Core decoding then turns that into `<img>`. It still survives.
- `htmlEntities` only helps the single-encoded case outside CDATA. The parser now turns `&lt;p&gt;` into `<p>` before `stripTags` runs, so that tag is stripped.
- The tests still lock in the weak behaviour:
  - `plain-text.test.ts:24` (`&amp;lt;b&amp;gt;` → `&lt;b&gt;`) and `:25` (`&lt;b&gt;x` → `<b>x`, literal markup as output).
  - There is still no end-to-end CDATA `&lt;script&gt;` test. `rss.test.ts:31,57` only checks the parser layer. The Vietstock fixture at `rss-news-source.test.ts:77-83` uses harmless `<p>`-style markup.
- **Fix (same as attempt 1):** change line 75 to `stripTags(decodeEntities(stripTags(html)))`. Change test :25 to expect `x`. Add a fixture item `<description><![CDATA[a &lt;img src=x onerror=alert(1)&gt; b]]></description>` and run it through `parseRssFeed` → `normalizeNewsItem`. Assert that the excerpt does not match `/<[A-Za-z\/!?]/`. Text like "P/E < 10" still survives, because `stripTags` only treats `<` as a tag when a letter or `/!?` follows (line 33).
- Not exploitable today (no UI; React escapes text), but AC5 ("HTML stripped") is still not met.

🟢 **`htmlEntities: true` does not bring back the entity-expansion risk** (`packages/sources/src/rss.ts:23`).
- Any DOCTYPE is still refused first (`rss.ts:15`), so no input or external entities can be declared. That means no XXE and no billion-laughs.
- `htmlEntities: true` loads only the library's fixed `COMMON_HTML` + `CURRENCY` tables (`OrderedObjParser.js:96`). Each value is a short literal, so nothing recurses.
- `EntityDecoder.decode` makes one linear pass: the lookahead is capped at 32 characters (line 417) and it never re-scans its own output. So output growth is bounded and there is no ReDoS.
- Numeric references go through `_resolveNCR`, so prohibited code points (null, etc.) are removed. Core also drops values above U+10FFFF and surrogates (`plain-text.ts:65`).
- The only side effect is the double decode (parser, then core), which is exactly the F1 issue above. Fixing F1 covers it.

🟢 **Named-entity table** (`plain-text.ts:2-9`): it is a fixed allow-list, looked up with `Object.hasOwn` (line 63), so `&constructor;` and `&__proto__;` cannot resolve to prototype properties. Unknown names are left as they are. The regex is bounded (`{2,6}`, `{1,7}`, `{1,6}`). Fine.

🟡 **F2 is still open.** `supabase/migrations/20261108000200_news.sql` still has no `revoke all on sequence public.news_id_seq from anon, authenticated;` (a grep for `news_id_seq` under `supabase/` finds nothing). There is also still no record of `scripts/db-check.sh` being run. This is a High-tier path.

🟡 **F3 is still open.** `scripts/record-news-fixtures.sh:50-62` still fetches robots.txt and then that host's feeds in the same pass. Ming only reviews afterwards (line 74), and robots.txt still goes out with the RSS `Accept` header (lines 12 and 35).

### Recommendations
1. **AC5:** fix F1 with the second strip, the corrected test :25 and the end-to-end CDATA test before PASS.
2. **AC2 / High tier:** add the sequence revoke and run `scripts/db-check.sh` against a local Supabase.
3. **AC1:** split the recorder into a robots pass and a feeds pass. A `debt` issue is acceptable if Ming defers it.

### Risks
- Every row stored before the F1 fix may contain literal markup, and these rows are permanent. Fix it before the first production sync.

Files:
- `D:\mmlabs\spaceM\projects\stoktok\packages\core\src\news\plain-text.ts`
- `D:\mmlabs\spaceM\projects\stoktok\packages\core\src\news\plain-text.test.ts`
- `D:\mmlabs\spaceM\projects\stoktok\packages\sources\src\rss.ts`
- `D:\mmlabs\spaceM\projects\stoktok\packages\sources\src\rss.test.ts`
- `D:\mmlabs\spaceM\projects\stoktok\apps\worker\src\sources\rss-news-source.test.ts`
- `D:\mmlabs\spaceM\projects\stoktok\supabase\migrations\20261108000200_news.sql`
- `D:\mmlabs\spaceM\projects\stoktok\scripts\record-news-fixtures.sh`
- `D:\mmlabs\spaceM\projects\stoktok\node_modules\.pnpm\fast-xml-parser@5.12.0\node_modules\fast-xml-parser\src\xmlparser\OrderedObjParser.js`
- `D:\mmlabs\spaceM\projects\stoktok\node_modules\.pnpm\@nodable+entities@3.1.0\node_modules\@nodable\entities\src\EntityDecoder.js`

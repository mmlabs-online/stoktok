## Attempt 1 — 2026-11-08
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`: all 5 projects Done, no errors.
- lint: `pnpm lint`: all 5 projects Done, no errors.
- test: `pnpm -r --no-bail test`: core 59 files / 715 passed; sources 3 passed + 1 skipped (34 tests; the skipped file is the existing `vci-intraday.samples.test.ts`); worker 19 passed + 1 skipped (291 tests; skipped = `rss-news-source.samples.test.ts`, no live samples yet); web 38 / 302 passed; db 17 passed, 1 failed (2 failed / 154 passed / 1 todo). The 2 db failures are the pre-existing Windows `r3-guard.test.ts` cases (spaceM#11), not touched by this diff. Matches impl-log.
- `scripts/db-check.sh`: not run (no Postgres here). Migration, rollback and `checks.sql` reviewed by reading only.
- Ad-hoc probes (scratch script via the worker's `tsx`, outside the repo) used for Issues 1, 2 and 4.

### Acceptance criteria
- [x] AC1 `NewsSource` + RSS + robots/terms record. Evidence: `apps/worker/src/sources/news-source.ts` (`interface NewsSource`, `RssNewsSource`, `createNewsSources`), `news-source.test.ts › builds the three configured sources / skips a disabled source / fetchFeed uses getText with the source UA and rss Accept`, `config.test.ts › news feeds are https rss urls on the source host`. The robots/terms table is in plan.md and in `apps/worker/README.md` ("News sync"), with the deliberate "site terms page not read" wording.
- [x] AC2 `news` table. Evidence: `supabase/migrations/20261108000200_news.sql` has every required column, `url` unique, credibility CHECK, `symbols text[]` with cardinality/shape CHECK, excerpt capped by config (`NEWS_SYNC_CONFIG.maxExcerptChars` 2000) with a 10000 backstop, RLS on, revoke from public/anon/authenticated, grant to service_role, no policies. Rollback: `supabase/rollback/20261108000200_news.down.sql`. `checks.sql` adds `tables_exist`, `news_columns`, `service_role_can_read_write_news`, `news_negatives`; the global RLS/grant/anon-denied loops cover `news`. Static review only.
- [x] AC3 deterministic linking in core. Evidence: `packages/core/src/news/link-symbols.ts`, `link-symbols.test.ts` (13 cases), alias hygiene in `config.test.ts`. No LLM/AI import in `packages/core/src/news`. False-positive gaps are in Issue 4 (should-fix).
- [x] AC4 hourly trading-day job, url dedupe, per-source rate limit, failure = gap. Evidence: `news-sync.test.ts` (14 cases, incl. non-trading day, `minIntervalMs` sleeps, consecutive-failure stop, batch dedupe, one source throws → gap + others stored, extend not duplicate, resolve on success, rows before gaps, dry-run). `insertNews` uses `onConflict: 'url', ignoreDuplicates: true` (`news.test.ts`). Schedule is documented only (plan A3).
- [ ] AC5 HTML stripped, plain text only. FAILED, see Issue 1 (and Issue 2).
- [~] AC6 green checks + fixtures per source. Checks are green except the known spaceM#11 failures. The synthetic fixtures are a planned deviation (A1, spaceM#27) and each file has a clear `SYNTHETIC - ... not recorded` header. Their fidelity is weak, see Issue 3. The script `scripts/record-news-fixtures.sh` meets the plan's step-9 hardening list: same UA, the right Accept, no `-L`, connect/max-time/max-filesize set, tmp → mv only on 200, stop with exit 1 on anything else, 3 s pause, robots first, README with sha256. It is bash 3.2-safe (`<<<` is fine).

### Issues
#### Issue 1 — 🔴 blocker — AC5: markup written as XML numeric character references is not stripped
- **Where**: `packages/sources/src/rss.ts:19-24` (XMLParser options), together with the ordering in `packages/core/src/news/plain-text.ts:73-79`.
- **Expected**: After XML decoding, the item text is the real XML text value, so `toPlainText` strips any markup it holds. `<title>&#60;img src=x&#62;Giá</title>` should be stored as `Giá`.
- **Actual**: fast-xml-parser 5.12.0 with default options decodes only `&lt; &gt; &amp; &quot; &apos;`. It leaves `&#60;`/`&#x3C;` as they are. `toPlainText` strips tags first and decodes entities after, so numerically encoded markup comes out as literal tags in the stored text. Probe: `parseRssFeed` → title `"&#60;img src=x&#62;Gi&#225; …"` → `toPlainText` → `"<img src=x>Giá …"`. The stored title/excerpt then contains HTML, which AC5 forbids. `&lt;…&gt;` and `&#60;…&#62;` encode the same markup in XML, but only the first is stripped.
- **Fix instruction**: In `parseRssFeed`, pass `htmlEntities: true` to `new XMLParser({...})`. I checked that with this option the same input gives `"Giá &lt;b&gt; …"` → `toPlainText` → `"Giá <b> …"` for the double-escaped part, which is correct, and the numerically encoded `<img>` is stripped. `&amp;lt;` still decodes only once because fast-xml-parser applies `&amp;` last. Add `rss.test.ts › numeric character references are decoded at the XML layer` (`&#60;p&#62;Hi&#60;/p&#62;` → description `<p>Hi</p>`). Add one item to `vietstock.xml` with numerically escaped markup, and make the existing `no "<" in excerpts` assertion cover it.

#### Issue 2 — 🟡 should-fix — AC5: HTML named entities other than six are left in the stored text
- **Where**: `packages/core/src/news/plain-text.ts:1` (`NAMED_ENTITIES`) and `:62-69`.
- **Expected**: Entities in HTML-escaped descriptions decode to plain text. Vietnamese CMS editors (e.g. CKEditor defaults) emit Latin-1 named entities such as `&agrave; &aacute; &acirc; &atilde; &egrave; &eacute; &ecirc; &igrave; &iacute; &ograve; &oacute; &ocirc; &otilde; &ugrave; &uacute; &yacute;`, their uppercase forms, and typographic ones (`&ndash; &mdash; &lsquo; &rsquo; &ldquo; &rdquo; &hellip; &laquo; &raquo;`).
- **Actual**: Only `amp lt gt quot apos nbsp` decode. Probe: Vietstock-style `&lt;p&gt;Ph&amp;aacute;t&lt;/p&gt;` is stored as `"Ph&aacute;t"`. That is entity residue in the stored "plain text", and it also defeats alias matching ("Hòa Phát").
- **Fix instruction**: Extend `NAMED_ENTITIES` with the HTML4 Latin-1 letter entities listed above (upper and lower case, exact case match) and the typographic entities, all as a static table. Do not add a dependency. Note that the current `name.toLowerCase()` lookup would wrongly map `&Agrave;` to `à`, so look names up case-sensitively. Add `plain-text.test.ts › Latin-1 and typographic named entities decode (Ph&aacute;t → Phát, &Ecirc; → Ê, &ndash; → –)`, and keep the unknown-entity case (`&foo;` stays as text).

#### Issue 3 — 🟡 should-fix — AC6: synthetic fixtures are not faithful on the one property every real feed has (Vietnamese text)
- **Where**: `apps/worker/src/sources/__fixtures__/news/{cafef,vietstock,vnexpress}.xml`, `apps/worker/src/sources/rss-news-source.samples.test.ts:17-38`.
- **Expected**: Synthetic fixtures copy the real feed format. All three outlets publish Vietnamese with diacritics (multi-byte UTF-8, sometimes decomposed; consult-data-engineer §2 "Encoding: normalize to NFC"). The recorded-samples test should also check the AC5 properties on real data.
- **Actual**: Every title and description is ASCII-only ("Co phieu HPG tang manh", "Hoa Phat"). The end-to-end fixture tests therefore never exercise UTF-8 decoding through `parseRssFeed`, NFC on decomposed input, or a diacritic alias match. The samples test checks only `bad_url`/`bad_date`, so Ming's recording would not catch leftover `<` or entities.
- **Fix instruction**: Rewrite the fixture text in real Vietnamese with diacritics (e.g. "Cổ phiếu HPG tăng mạnh", "Hòa Phát vượt đỉnh"). Make at least one item in one fixture use decomposed (NFD) characters, and assert that its stored title equals the NFC form. Keep the `SYNTHETIC` header. In `rss-news-source.samples.test.ts`, add assertions per normalized item: `title`/`excerpt` contain no `<`, do not match `/&[A-Za-z]+;|&#\d+;/`, and equal their own `.normalize('NFC')`.

#### Issue 4 — 🟡 should-fix — AC3: predictable ticker false positives not in `ambiguousTickers`
- **Where**: `packages/core/src/news/config.ts:5` (`ambiguousTickers`).
- **Expected**: Real tickers that are everyday tokens in Vietnamese finance news link only with context, as VND/GAS/CEO/TOP already do.
- **Actual**: Probe with candidates incl. HCM, VIX: `"Giá nhà tại TP HCM tăng mạnh"` → `['HCM']`, `"Tp. HCM và Hà Nội"` → `['HCM']`, `"Chỉ số VIX tăng"` → `['VIX']`. HCM (HSC securities) would link to almost every Ho Chi Minh City article once it is on the watchlist.
- **Fix instruction**: Add `'HCM'` and `'VIX'` to `NEWS_LINK_CONFIG.ambiguousTickers`. Add `link-symbols.test.ts › city/index abbreviations (TP HCM, Tp. HCM, chỉ số VIX) do not link without context; "mã HCM" does`. Do not add more speculative entries; Ming extends the list.

### Rules R1–R10
No violations found.
- R1: cleaning, URL canonicalization, dates, linking and gap planning are all in `packages/core/src/news`. The worker only orchestrates.
- R3: DB access only via `@stoktok/db` from the worker. The `news` grants go to service_role only. The r3-guard failures are pre-existing (spaceM#11).
- R4: every row has `source` + `fetched_at`. Source failures become `news` gaps (extended, then resolved).
- R5: feeds, intervals, caps, link rules and aliases are config.
- R7: every changed file is in the plan's file list. The `DataGapInsert.symbol` widening sits inside a planned file and is justified.
- R8: core tests exist for every new module.
- R9: the SQL comments mark the text as untrusted. Logs carry counts and URLs only (`news-sync.test.ts › never logs titles or excerpts`).
- R10: read-only RSS.
- PostgREST 1000-row cap: OK. `insertNews` returns at most 200 ids per request (`select('id')` after `ignoreDuplicates`, so only inserted rows come back). The open-gaps read is paged through `fetchAll` (`data-gaps.test.ts` pages past a full page). Holidays come from one settings row. No `.in('url', …)` read. `listWatchlist` stays unpaged (existing code, bounded, noted in plan).
- DOCTYPE/entity: `<!DOCTYPE` is refused case-insensitively before parsing, so no internal-entity expansion is possible. A non-UTF-8 declaration is refused. A BOM is stripped. Undefined entities stay as literal text (harmless). The remaining entity problem is Issue 1.

### Nits (do not block)
- `supabase/migrations/20261108000200_news.sql`: `signals` (20261026000200) explicitly revokes/grants `signals_id_seq`. `news_id_seq` relies on the 20261023000200 default privileges. Identity inserts do not need sequence USAGE, and `checks.sql` would catch an anon sequence grant, but copying the signals pattern is cheap defence.
- `symbols` CHECK uses `array_to_string`, which skips NULL elements, so `'{NULL}'` passes. Consider `and array_position(symbols, null) is null`.
- `link-symbols.ts:29`: parentheses alone count as context, so a currency in brackets ("tỷ đồng (VND)") links VND when VND is a candidate. This is plan-specified; flagging it for Ming's alias/ambiguity review.
- Alias `Masan` also links MSN for subsidiaries ("Masan MEATLife", "Masan High-Tech Materials").
- `plain-text.ts` drops the rest of the input on an unclosed tag-like `<` followed by a letter ("a<b c" → "a"). This is safe but lossy. Fine for now.
- `news-sync.ts`: if `insertNews` throws (e.g. a CHECK failure in one chunk), the run aborts before any gap is recorded. Consider recording the failure in the summary.
- `record-news-fixtures.sh` uses `--max-filesize 5242880` while the worker caps at 2 MB. A recorded file between 2 and 5 MB would pass the script but fail the job. Matching it to `maxBodyBytes` is cleaner.
- An untracked `.gitattributes` is in the working tree. It is not part of this diff; commit or remove it deliberately.

### Follow-ups (out of scope)
- All plan follow-ups stand (schedule wiring after the migration, retention, re-link backfill, staleness gap, FTS, paged reader, UI text-only rule, AI quoting, Retry-After / conditional GET, spec §5 `symbols[]`).
- Ming reviews `ambiguousTickers` and `NEWS_SYMBOL_ALIASES` against the real watchlist after the first recorded run.

## Attempt 2 — 2026-11-08
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck`: all projects Done, no errors.
- lint: `pnpm lint`: all projects Done, no errors.
- test: `pnpm -r --no-bail test`: core 59 files / 717 passed; sources 3 passed + 1 skipped (35 tests); worker 19 passed + 1 skipped (292 tests); web 38 / 302 passed; db 17 passed, 1 failed (2 failed / 154 passed / 1 todo). The 2 db failures are the pre-existing Windows `r3-guard.test.ts` cases (spaceM#11). Matches impl-log Attempt 2.
- `scripts/db-check.sh`: not run (no Postgres). No SQL changed in this attempt.
- Ad-hoc probe (temporary script via the worker's `tsx`, deleted afterwards; working tree unchanged) of `parseRssFeed` → `toPlainText`:
  `&#60;img src=x&#62;Giá` → `Giá`; `&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;ok` → `ok`; `Ph&amp;aacute;t &amp;Agrave;` → `Phát À`; `&lt;p&gt;x&amp;amp;y&lt;/p&gt;` → `x&y`; `a &amp;lt;b&amp;gt; c` → `a <b> c` (double-escaped, so it is literal text; decoded once only, as intended).

### Previous issues
- Issue 1 (🔴 numeric refs): fixed. `packages/sources/src/rss.ts:23` `htmlEntities: true`; `rss.test.ts › numeric character references are decoded at the XML layer`; Vietstock fixture item 3 uses `&#60;p&#62;` + numeric text refs and `rss-news-source.test.ts › Vietstock …` asserts `Giao dịch thực hiện theo phương thức khớp lệnh.`; the per-fixture `not.toContain('<')` covers it. Probe confirms.
- Issue 2 (🟡 named entities): fixed. `packages/core/src/news/plain-text.ts:2-9` static Latin-1 + typographic table, case-sensitive `Object.hasOwn` lookup (`:63`); `plain-text.test.ts › Latin-1 and typographic named entities decode …` (incl. `&Agrave;` vs `&agrave;` and `&foo;` kept). Vietstock item 4 (`&amp;agrave;`, `&amp;#7883;`) → `Ngày giao dịch không hưởng quyền là 20/11.`.
- Issue 3 (🟡 fixture fidelity): fixed. All three fixtures carry Vietnamese with diacritics, `SYNTHETIC` headers kept. CafeF item 3 title is NFD: `rss-news-source.test.ts › CafeF: a decomposed (NFD) title is stored as NFC` asserts the raw is not NFC and the stored title is. Every fixture item now asserts NFC and no entity residue. `rss-news-source.samples.test.ts:38-46` adds no-`<`, no-entity, NFC checks per item for recorded samples.
- Issue 4 (🟡 HCM/VIX): fixed. `packages/core/src/news/config.ts:6`; `link-symbols.test.ts › city/index abbreviations …` covers `TP HCM`, `Tp. HCM`, `Chỉ số VIX` (no link) and `mã HCM` (links).

### Acceptance criteria
- [x] AC1 — unchanged from Attempt 1 (evidence there).
- [x] AC2 — unchanged (no SQL change); static review only.
- [x] AC3 — Attempt 1 evidence plus the HCM/VIX test above.
- [x] AC4 — unchanged; `news-sync.test.ts` still green (worker 292 passed).
- [x] AC5 — HTML stripped, plain text only: Issues 1 and 2 fixed, see evidence above and probe.
- [x] AC6 — checks green except spaceM#11; fixtures per source, synthetic per planned deviation A1 (spaceM#27), now in Vietnamese with an NFD case; samples test checks AC5 properties on recorded data.

### Scope
Attempt 2 diff (`7cc664d..58abb0a`) touches only files already in the plan's file list, limited to the four issues. No out-of-plan files.

### Rules R1–R10
No violations found. Entity decoding and normalisation stay in `packages/core` / `packages/sources`; the worker only orchestrates (R1). New ambiguous tickers are config (R5). Core changes have unit tests (R8).

### Nits (do not block)
- Double-escaped markup (`&amp;lt;b&amp;gt;`) is stored as the literal text `<b>`. This is correct plain text, but the samples test's `not.toContain('<')` would fail on a real feed that does this. If it trips on Ming's first recording, relax that one assertion rather than decoding twice.
- The samples-test entity regex `/&[A-Za-z]+;|&#\d+;/` misses hex refs (`&#x…;`). Cosmetic.
- Attempt 1 nits still open (news_id_seq grants, `array_position` NULL check, record script `--max-filesize` vs 2 MB, insertNews failure summary, untracked `.gitattributes`).

### Follow-ups (out of scope)
- Same as Attempt 1. Ming reviews `ambiguousTickers` / `NEWS_SYMBOL_ALIASES` after the first recorded run.

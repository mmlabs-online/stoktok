## Attempt 1 — 2026-11-08

### Files touched
| File | Required because |
|---|---|
| `packages/core/src/news/{types,plain-text,canonical-url,rss-date,normalize-item,link-symbols,config,gaps,index}.ts` (new) | AC2/3/4/5: all cleaning, linking and gap rules in core (R1, R5) |
| `packages/core/src/news/*.test.ts` (7 new: plain-text, canonical-url, rss-date, normalize-item, link-symbols, config, gaps) | R8 |
| `packages/core/src/index.ts` | export `./news` |
| `packages/sources/src/http.ts` | shared `request` loop; new `getText`; `getJson`/`postJson` behaviour unchanged |
| `packages/sources/src/http.test.ts` | `getText` tests |
| `packages/sources/src/rss.ts`, `rss.test.ts` (new) | `parseRssFeed` (fast-xml-parser; DOCTYPE and non-UTF-8 refused) |
| `packages/sources/src/index.ts` | export `getText`, `parseRssFeed` |
| `packages/sources/package.json`, `pnpm-lock.yaml` | `fast-xml-parser` 5.12.0, exact pin (MIT). `pnpm audit --prod`: no known vulnerabilities |
| `apps/worker/src/sources/news-source.ts`, `news-source.test.ts` (new) | `NewsSource`, `RssNewsSource`, `createNewsSources` (AC1) |
| `apps/worker/src/sources/rss-news-source.test.ts`, `rss-news-source.samples.test.ts` (new) | AC6: synthetic fixtures through source + normalize + link; opt-in recorded-samples test (skipped until files exist) |
| `apps/worker/src/sources/__fixtures__/news/{cafef,vietstock,vnexpress}.xml` (new) | AC6; each carries a "SYNTHETIC - not recorded" comment |
| `apps/worker/src/jobs/news-sync.ts`, `news-sync.test.ts` (new) | AC4 job |
| `apps/worker/src/config.ts`, `config.test.ts` | `NEWS_SOURCE_IDS`, `NEWS_SYNC_CONFIG` (R5) |
| `apps/worker/src/store.ts`, `store.test.ts` | `createDbNewsStore` |
| `apps/worker/src/cli.ts`, `cli.test.ts` | `news` job, `--dry-run`, `--source <cafef\|vietstock\|vnexpress>` |
| `apps/worker/README.md` | News sync section: schedule (documented only), robots/terms table, untrusted-text rule, fixture recording step |
| `packages/db/src/rows.ts` | `NewsInsert`; `DataGapInsert.symbol` is now `string \| null` (news gaps are market-wide; the column is already nullable) |
| `packages/db/src/repos/news.ts`, `news.test.ts` (new) | `insertNews` (upsert, `onConflict url`, `ignoreDuplicates`, chunked, `select('id')`) |
| `packages/db/src/repos/data-gaps.ts`, `data-gaps.test.ts` | optional `source` filter on `listAllOpenGaps`; new `extendGaps` |
| `packages/db/src/index.ts` | exports |
| `supabase/migrations/20261108000200_news.sql`, `supabase/rollback/20261108000200_news.down.sql` (new) | AC2 (High tier: migration) |
| `scripts/db-check/checks.sql` | `news` in `tables_exist`; `news_columns`, `service_role_can_read_write_news`, `news_negatives` |
| `scripts/record-news-fixtures.sh` (new) | Ming-run recorder for feeds and raw `robots.txt` (AC6, AC1). Not run by me. `bash -n` OK; `shellcheck` is not installed here |

### Tests added / changed
- core: `plain-text.test.ts` (tags, script/style incl. unclosed and uppercase, event handlers and `javascript:`, quoted `>` in attributes, entities decoded once, numeric/named, CDATA, stray `<`, control/zero-width/NFC, `capText` on a code point); `canonical-url.test.ts`; `rss-date.test.ts` (2-digit year, GMT/Z/offset, rejects, weekday ignored); `normalize-item.test.ts` (build, guid fallback, 4 reject reasons, caps, excerpt via toPlainText, dedupe); `link-symbols.test.ts` (positions, Unicode boundary, case, longer tokens/URLs/hyphen, stop tokens, ambiguous tickers, candidates only, all-caps, per-field all-caps, alias with/without diacritics, longest alias, cap/sort/determinism); `config.test.ts` (alias hygiene); `gaps.test.ts`
- sources: `http.test.ts › getText …` (headers, redirect error, retry 429/5xx, no retry 403/404, body cap); `rss.test.ts` (CDATA, namespaces, DOCTYPE, encoding, malformed/no channel/zero items, maxItems)
- db: `news.test.ts` (onConflict url + ignoreDuplicates, chunking 200/200/1, inserted count, error mapping); `data-gaps.test.ts` (source filter paged past one full page, `extendGaps`)
- worker: `news-source.test.ts`, `rss-news-source.test.ts` (3 synthetic fixtures + specifics), `rss-news-source.samples.test.ts` (opt-in, skipped), `news-sync.test.ts` (all 14 cases in the plan plus reject counts), `config.test.ts` (news invariants), `store.test.ts` (news wiring), `cli.test.ts` (news args)

### Checks (actual output summary)
- typecheck: `pnpm typecheck` - all 5 workspace projects Done, no errors.
- lint: `pnpm lint` - all projects Done, no errors.
- test: `pnpm -r --no-bail test` - core 59 files / 715 tests passed; sources 3 passed + 1 skipped (34 tests); worker 19 passed + 1 skipped (291 tests); web 38 files / 302 tests passed; db 17 files passed, 1 failed (154 passed, 2 failed, 1 todo). The 2 db failures are the pre-existing Windows `r3-guard.test.ts` ones (spaceM#11: "SUPABASE_SERVICE_ROLE_KEY is referenced only in packages/db/src/client.ts" and "apps/web/server/db.ts starts with import 'server-only'"); nothing in this diff touches them.
- `scripts/db-check.sh`: NOT run (no `psql` / local Postgres here). The SQL was reviewed statically only. Ming or CI should run it.
- `scripts/record-news-fixtures.sh`: NOT run (human step, A1).

### Out-of-plan files
None. (`DataGapInsert.symbol` widening is inside `packages/db/src/rows.ts`, which is in the plan.)

### Notes for the reviewer
- `packages/core` is compiled with `lib: ["ES2022"], types: []`, so `URL` and `URLSearchParams` do not exist there. `canonical-url.ts` declares just the used part locally (`declare const URL …`) instead of changing `packages/core/tsconfig.json` (not in the plan). Both are runtime globals in the web app and worker.
- `fast-xml-parser` 5.12.0 is the new dependency (A7).
- Stored `news.source` is the outlet display name ("CafeF"); the `data_gaps.source` of a news gap is the source id ("cafef"). The per-source open-gap lookup filters on the id.
- `NewsItem` and `RawFeedItem` fields are plain strings; `guid` is used only as a fallback for an empty `link`.
- Raw invisible characters (zero-width, BOM) appear in `plain-text.test.ts` line 44 as test input; lint passes.

### Follow-ups (noticed, not done)
- All follow-ups listed in plan.md stay open (schedule wiring after the migration is applied, retention, re-link backfill, full-article fetch, staleness gap, Vietnamese FTS, paged news reader, UI text-only rule, AI input quoting, `Retry-After`/conditional GET, spec §5 `symbols[]`).
- No root `package.json` script such as `worker:news` was added (the file is not in the plan); the README documents `pnpm --filter @stoktok/worker run job news`.
- Ming to run `bash scripts/record-news-fixtures.sh`, re-read the saved `robots-*.txt`, and commit `work/tickets/STK-062/live-samples/` before merge (A1).

### Scope self-check
- Could the diff be smaller? No: each file is in the plan list; the non-test production diff is about 780 lines, under the 900-line split threshold.
- Diff size: tracked files +429 / -37, plus new files (core news ~410, job + source ~235, rss 37, news repo 18, SQL ~60, script ~85 lines, tests and fixtures on top).

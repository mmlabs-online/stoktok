## Attempt 1 — 2026-10-24
Verdict: PASS

Scope reviewed: `git diff d02f848^..HEAD` (STK-005 slice 1 only; STK-009 and STK-030 are in PR #8). AC4 (gap detection) moved to STK-031 and is not expected. Source (TCBS public) and scope (watchlist ∪ held) are Ming's decisions in ticket Notes. R6 is suspended, so missing auth is not flagged.

### Checks (run by reviewer)
- typecheck: pass (all workspace projects, exit 0)
- lint: pass (exit 0)
- test: pass. core 192, db 57 (+1 todo), worker 26 (4 files), web 106. Matches impl-log.
- build: pass (exit 0; worker emits `dist/cli.js`)
- check:service-key: `OK: no service key material in client bundle` (0 hits for sentinel, `SUPABASE_SERVICE_ROLE_KEY`, `service_role`)

### End-to-end runs without network (reviewer's scratch harness, outside the repo)
I ran the real `runEodSync` and the real `TcbsPriceSource` with a stubbed `fetchImpl`, an in-memory store and `now` = Fri 2026-10-23 19:00 VN. Symbols: watchlist VNM, BAD (malformed fixture), THO (bars-ok divided by 1000, i.e. thousand-VND), ERR (HTTP 500), HUN; held FPT, VNM.
- **Dry run:** 0 upsert calls, table empty. The summary still counts 8 bars and 7 rejections. Target 2026-10-23, from 2026-09-28 (20 trading days).
- **Non-dry run 1:** 8 rows. Each row has integer VND, `source: "tcbs-public"` and `fetched_at` set to the run time.
- **Non-dry run 2 (now +2h):** still 8 rows. OHLCV, volume and source are identical (`identical OHLCV true`). Only `fetched_at` was refreshed, as plan A3 says.
- **Wrong units rejected:** all 3 THO thousand-VND bars were rejected (`invalid_low` / `invalid_open` / `invalid_high`) and none were stored. Core tests cover the band and step guards (`daily-bar.test.ts › unit guard`, `› jump guard`).
- **One failure does not stop the others:** ERR was retried, then listed in `failedSymbols`. The symbols after it (FPT, HUN, THO, VNM) were fetched and stored. `ok: false`.
- **CLI:** `pnpm worker:eod --dry-run` passes the flag through and fails on missing env before any network call. `node dist/cli.js bogus` exits 2. With an unreachable `SUPABASE_URL` and a sentinel service key, it prints `settings.get: database error`, exits 1, and the sentinel appears 0 times in the output.

### Acceptance criteria
- [x] AC1 `PriceSource` + one implementation, callers unchanged by a new source. Evidence: `apps/worker/src/sources/price-source.ts`, `TcbsPriceSource implements PriceSource` (tcbs.ts). `jobs/eod-sync.ts` does not import tcbs; only `cli.ts` constructs it. Test `eod-sync.test.ts › every row carries source = source.name` uses a fake source named `other-source`.
- [x] AC2 sync of watchlist ∪ held, idempotent upsert, `source` + `fetched_at`. Evidence: tests `› syncs watchlist U held, deduped, normalised and sorted`, `› re-run with same data…`, `› every row carries source…`, and `prices-daily.test.ts` (onConflict `symbol,trade_date`, 1200 rows → 500/500/200, dedupe, empty, 23514 mapping). The onConflict columns match the PK in `supabase/migrations/20261023000100_v1_tables.sql:90`. Reviewer runs 1 and 2 above confirm it.
- [x] AC3 integer VND at the adapter boundary, invalid/missing fields rejected. Evidence: `packages/core/src/market/daily-bar.ts` `toVnd` / `normalizeDailyBar`, called from `tcbs.ts` with a single `TCBS_PRICE_UNIT` constant. Tests: `daily-bar.test.ts` (missing, NaN, negative, volume, date, range checks mirroring the DB CHECK, unit and jump guards), `tcbs.test.ts › bars-malformed.json`, `eod-sync.test.ts › rejected bars are counted and never upserted`. The reviewer's THO run confirms it.
- [~] AC4 moved to STK-031. Not reviewed.
- [x] AC5 no live network in tests. Evidence: `apps/worker/vitest.config.ts` setupFiles → `test/no-network.ts` stubs global `fetch` to throw. Test `tcbs.test.ts › global fetch is blocked in tests`. The adapter takes an injected `fetchImpl`. Fixtures are labelled **SYNTHETIC … not recorded. Verify against a live response** in `apps/worker/test/fixtures/tcbs/README.md`, which is honest.
- [x] AC6 documented pnpm script and minimal cron. Evidence: root `worker:eod`, `apps/worker/README.md` (dry-run-first instruction, env, exit codes, crontab with `TZ=Asia/Ho_Chi_Minh`, container form). No scheduler code. `cli.test.ts` passes, and the reviewer's CLI runs above confirm the behaviour.

### Issues
None blocking.

### Rules R1–R10
- R1: all conversion, validation and date math are in core (`market/daily-bar.ts`, `calendar.ts`). Held symbols come from core `buildLedger` (`packages/db/src/holdings.ts`). The job only orchestrates.
- R2: prices are integers end to end. `toVnd` is the only conversion. The schema columns are `integer`/`bigint`, and `maxPriceVnd` 10M fits.
- R3: the service key is read only in `cli.ts` via `createServiceClient(process.env)`. Logs carry only error messages, HTTP status and `e.name`; no URL, env value or key is logged. A sentinel test confirmed nothing leaks. The web bundle check is clean.
- R4: every row has `source = source.name` and one `fetched_at` per run.
- R5: sanity bounds are in `packages/core/src/market/config.ts`. Lookback, delay, retries and breaker are in `apps/worker/src/config.ts`. Holidays come from `settings.holidays`, and the cutoff is the shared core constant.
- R7: every changed file is in the plan. The extra `export type { PriceDailyInsert }` is a listed file. Workflow files (`backlog.md`, ticket, STK-031 ticket, consults) are expected.
- R8: green. New core logic has unit tests.
- R10: read-only market data only.
No violations found.

README / ADR accuracy: the claims I checked match the code: 20-trading-day window, 1 s delay, 15 s timeout, retries on network/429/5xx, breaker at 5, User-Agent string, exit codes 0/1/2, logs on stderr and summary on stdout, and `--env-file-if-exists` (Node 22.22 supports it). The ADR names who accepted the risk and when, and lists the UNVERIFIED items.

### Nits (do not block)
- 💭 Unit-guard hole for stocks at or above 100k VND. If the feed were really in thousand VND, a bar whose OHLC are all multiples of 10 (thousand) passes. In the harness, `HUN` 120/130/120/130 was stored as 120/130 VND on a first run with no `lastClose`. The other bars in the same response would almost certainly be rejected, so `ok: false` and the dry-run-first step would catch it. Hardening idea: if any bar in a response fails a unit-type check, reject the whole response for that symbol.
- 💭 Once a wrong close is stored, `close_jump` against the latest stored close rejects every correct bar for that symbol until someone fixes the row by hand. That is safe (nothing wrong is added), but it needs an operator note in the README.
- 💭 README crontab lines assume `pnpm` is on cron's PATH. A full path or `SHELL`/`PATH` line in the crontab would help.
- 💭 The impl-log says "not committed, per instruction", but the work is committed (dd7f281). Cosmetic.

### Follow-ups (out of scope)
- Whole-response unit rejection, and a manual override for a stored bad close (see nits).
- Already listed by the planner/implementer: partial unique index on data_gaps + single-run lock, `Retry-After`, env overrides for config, backfill flag, fallback source, recorded fixtures replacing synthetic ones, adjusted-series decision (STK-015).

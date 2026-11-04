Status: READY

# Plan — STK-046: Seed the Vietnamese exchange holiday calendar and resolve false price gaps

## Spec summary
- docs/spec-v1.md §2.1: "All values below are **configuration, not hard-coded**, and must be verified against current exchange and TCBS rules before go-live." Settlement row: "T+2: bought shares can be sold from T+2 | Never suggest selling a lot that is not yet sellable".
- §2.2: "Gaps happen (sleep, Windows Update, network). Gaps must be detected, not silently interpolated."
- §4.4: "EOD OHLCV sync | After market close"; "Gap detection | After each poll and at EOD"; "News fetch | Hourly on trading days".
- §5: "`data_gaps` | symbol, from_ts, to_ts, detected_at"; "`settings` | fee_rate, tax_rate, concentration_threshold, rule configs".
- CLAUDE.md R4: "Every market-data record carries `source` and `fetched_at`. Stale or gapped data never produces a signal; gaps are recorded." R5: "Market rules are configuration, never hard-coded: fee rate, sell tax, price limits per exchange, settlement days, lot size." CLAUDE.md market-rules table header: "configuration defaults — verify before go-live".
- Ticket notes: "Today `settings.holidays` defaults to `[]` (`packages/core/src/ledger/settings.ts`)." STK-047 (Settings editor for holidays) follows this ticket.

**Source caveat (applies to every seeded date).** All dates come from secondary sources (news outlets and legal aggregators quoting the HOSE/HNX notices). hsx.vn / hnx.vn could not be reached from the sandbox. The seed module's header comment and the worker README must say: **"Dates to be verified against the original notices on hsx.vn / hnx.vn before go-live."** The PR body repeats it.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | HOSE/HNX/UPCoM non-trading weekdays for 2025, 2026 and 2027 are seeded as configuration (R5), each with a cited source; a year whose official schedule is not yet published is marked provisional. | `packages/core/src/market/holiday-calendar.ts` holds `VN_MARKET_HOLIDAYS` with exactly the dates in the table under Approach step 1, each with a non-empty `source` (notice number and/or URL) and a `provisional` flag. Every 2027 entry and 2026-11-24 are `provisional: true`; all other entries are `false`. Tests in `holiday-calendar.test.ts` (listed below) pass. The header comment says it is one calendar for HOSE, HNX and UPCoM and includes the hsx.vn/hnx.vn verification note. |
| 2 | When `settings.holidays` is empty or unset, the app uses the seeded calendar; dates Ming has stored are kept, not overwritten. | `effectiveHolidays` tests (empty / null / undefined → seed; stored dates kept in the result; input not mutated). `packages/db` settings tests: `getSettings` / `getEntrySettings` (row with `[]`, row missing, row with stored dates) return the effective list. `getAppSettings`, `settingsInputToRow` and `saveAppSettings` still pass the raw stored array through, so the seed is never written to the DB (existing mapper test "keeps … holidays … from the existing row" still passes unchanged). |
| 3 | Open price gaps whose missing days all fall on seeded holidays are resolved, not deleted, with a recorded reason; a gap that also covers a real trading day is left open (R4). | Migration adds `data_gaps.resolved_reason` (`'data_stored' \| 'non_trading_day'`), checked by `pnpm db:check`. `holidayOnlyGapIds` tests (Tết gap resolves; 2026-02-13…2026-02-23 gap stays open). `resolve-holiday-gaps` job tests: dry-run writes nothing and lists what it would resolve; real run calls `resolveGaps(ids, at, 'non_trading_day')` with only holiday-only ids, covering symbols that are no longer watched and market-wide (symbol NULL) gaps. `resolveGaps` repo test: update payload includes `resolved_reason`, keeps `.is('resolved_at', null)`, and uses update, never delete. EOD test: a holiday-only gap is resolved with reason `non_trading_day`, and a gap whose day got a bar is resolved with `data_stored`. |
| 4 | Unit tests cover the calendar (ISO dates, weekdays only, no duplicates, sorted), the fallback rule, and the gap-resolution rule; `typecheck`, `lint`, `test` pass. | Tests listed below exist and pass; `pnpm typecheck`, `pnpm lint`, `pnpm test` are green; `pnpm db:check` is green where Postgres is available (record it in impl-log if not runnable). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/market/holiday-calendar.ts` | **New.** `SeededHoliday` type `{ date; name; source; provisional }`, `VN_MARKET_HOLIDAYS` (readonly, sorted), `SEEDED_HOLIDAY_DATES` (derived dates), `SEEDED_HOLIDAY_YEARS = [2025, 2026, 2027]`, `effectiveHolidays(stored)` | AC1, AC2, R5. One configuration module in core (R1) |
| `packages/core/src/market/holiday-calendar.test.ts` | **New.** Calendar, fallback and settlement/freshness tests | AC4, R8 |
| `packages/core/src/market/price-gaps.ts` | Add `GapResolvedReason` type and `holidayOnlyGapIds(openGaps, holidays)`. `planPriceGaps` is unchanged | AC3 rule in core (R1) |
| `packages/core/src/market/price-gaps.test.ts` | Add `holidayOnlyGapIds` tests | AC4 |
| `packages/core/src/index.ts` | Export the new symbols | Consumers in db/worker |
| `packages/db/src/repos/settings.ts` | `getSettings` and `getEntrySettings` (all three return branches) return `holidays: effectiveHolidays(raw)`. `getAppSettings`, `saveAppSettings` and `saveSettings` stay raw | AC2. These two functions feed the ledger (`db/src/ledger.ts`), the worker (`store.ts`) and the web loaders (dashboard, watchlist, symbol, chart) |
| `packages/db/src/repos/settings.test.ts` | Update holiday expectations; add fallback cases | AC2 |
| `packages/db/src/repos/data-gaps.ts` | `resolveGaps(db, ids, resolvedAt, reason?)`: include `resolved_reason` only when `reason` is given. New `listAllOpenGaps(db, dataType, { pageSize })`: every open gap of the type, any symbol including NULL, ordered by id, paged with `fetchAll` | AC3, plus orphan symbols and the PostgREST row cap |
| `packages/db/src/repos/data-gaps.test.ts` | Tests for both changes | AC4 |
| `packages/db/src/index.ts` | Export `listAllOpenGaps` | Worker wiring |
| `supabase/migrations/20261105000100_data_gaps_resolved_reason.sql` | **New.** Additive nullable `resolved_reason text` column plus two checks (see Approach step 4) | AC3 "recorded reason" |
| `supabase/rollback/20261105000100_data_gaps_resolved_reason.down.sql` | **New.** `alter table public.data_gaps drop column if exists resolved_reason;` | db-check applies every rollback |
| `scripts/db-check/checks.sql` | Assert the column (`text`, nullable), its check constraint, and `expect_fail` cases for a bad value and for a reason without `resolved_at` | db-check covers each schema change |
| `apps/worker/src/jobs/eod-sync.ts` | `EodStore.resolveGaps(ids, at, reason?)`. The gap step splits `plan.toResolve` with `holidayOnlyGapIds(own, holidays)` into `non_trading_day` and `data_stored`, then calls `resolveGaps` once per reason | AC3: gaps the EOD resolves also get a reason |
| `apps/worker/src/jobs/eod-sync.test.ts` | Fake captures the reason; new cases | AC4 |
| `apps/worker/src/jobs/resolve-holiday-gaps.ts` | **New.** One-off/re-runnable job `runResolveHolidayGaps({ store, now, log, dryRun, config })` | AC3 cleanup of existing false gaps, including symbols no longer watched |
| `apps/worker/src/jobs/resolve-holiday-gaps.test.ts` | **New.** | AC4 |
| `apps/worker/src/config.ts` | `HOLIDAY_GAPS_CONFIG = { pageSize: 1000, resolveChunkSize: 200 }` | Tuning lives in config.ts (existing convention) |
| `apps/worker/src/store.ts` | `createDbEodStore.resolveGaps` passes the reason through. New `createDbHolidayGapsStore(db, cfg)` wired to `getEntrySettings` (effective holidays), `listAllOpenGaps` and `resolveGaps` | Wiring only |
| `apps/worker/src/store.test.ts` | Wiring tests for the reason and the new store | R8 |
| `apps/worker/src/cli.ts` | New job `resolve-holiday-gaps [--dry-run]` (no `--backfill`/`--source`); update USAGE | Entry point (`run-job.sh resolve-holiday-gaps --dry-run` works unchanged, because run-job.sh passes the job name through) |
| `apps/worker/src/cli.test.ts` | parseArgs cases | R8 |
| `package.json` (root) | Script `"worker:holiday-gaps": "pnpm --filter @stoktok/worker run job resolve-holiday-gaps"` | Same pattern as the other worker scripts |
| `apps/worker/README.md` | Rewrite the "Holidays" section: seeded calendar plus union with `settings.holidays`; provisional dates; the verify-on-hsx.vn/hnx.vn note; the new job and its first-run procedure; the 2024 backfill limit; "apply the migration before deploying this image" | Ops documentation |

No web files change. Loaders read `getEntrySettings`, so they get the effective list (R7).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `holiday-calendar.test.ts` › every date is valid ISO `YYYY-MM-DD` (`isValidDate`) | AC1/AC4 |
| › no Saturday or Sunday, and explicitly not 2025-04-26, 2026-01-10, 2026-08-22 (make-up Saturdays) | AC4 |
| › strictly ascending (sorted, no duplicates) | AC4 |
| › covers 2025, 2026 and 2027 (each year has ≥1 entry; `SEEDED_HOLIDAY_YEARS` matches) | AC1 |
| › every entry has non-empty `name` and `source` | AC1 |
| › provisional flags: every 2027 entry and 2026-11-24 are `true`; every other 2025/2026 entry is `false` | AC1 |
| › exact date snapshot (the 38 dates: 12 + 14 + 12 in Approach step 1) | AC1, guards against silent edits |
| › `effectiveHolidays([])`, `(null)` and `(undefined)` return `SEEDED_HOLIDAY_DATES` | AC2 |
| › `effectiveHolidays(['2026-10-20'])` contains the seed plus 2026-10-20, sorted, unique | AC2 |
| › a stored date that is already in the seed is not duplicated; the input array is not mutated | AC2 |
| › with the effective calendar: `addTradingDays('2026-02-13', 2, …)` returns `'2026-02-24'` (T+2 across Tết) | finance consult rec 6 |
| › `expectedPriceDate(2026-02-23 09:00 VN, …, DEFAULT_PRICE_CUTOFF_MINUTES_VN)` returns `'2026-02-13'` | finance consult rec 6 |
| `price-gaps.test.ts` › `holidayOnlyGapIds`: a gap 2026-02-16…2026-02-20 (Tết) resolves | AC3 |
| › a single-day holiday gap (2026-09-02) resolves | AC3 |
| › a gap 2026-02-13…2026-02-23 (holiday plus real trading days) stays open | AC3, R4 |
| › a weekend-only gap resolves | AC3 (explicit behaviour) |
| › with an empty holiday list, a weekday gap is not returned | AC3 |
| › output is sorted and unique | AC4 |
| `data-gaps.test.ts` › `resolveGaps` with a reason sends `{ resolved_at, resolved_reason }`, keeps `.is('resolved_at', null)`; without a reason the payload is unchanged | AC3 |
| › `listAllOpenGaps` filters only `data_type` and `resolved_at is null` (no symbol filter), orders by id, pages (pageSize 2 → two calls) | AC3, row cap |
| `settings.test.ts` › `getEntrySettings`: row with `holidays: []` → seed; row missing → seed; row with `['2026-10-20']` → union | AC2 |
| › `getSettings`: stored `['2026-01-01']` → union (equal to the seed, since 01-01 is seeded) | AC2 |
| › `getAppSettings` returns the raw stored array (not the seed) | AC2: never materialize the seed; STK-047 contract |
| `eod-sync.test.ts` › an open gap on a holiday is resolved with reason `non_trading_day`; a gap whose bar arrived is resolved with `data_stored` | AC3 |
| › dry-run still makes no `resolveGaps` call (existing tests keep passing) | regression |
| `resolve-holiday-gaps.test.ts` › dry-run: no `resolveGaps` call; summary lists `{ id, symbol, from, to }` for holiday-only gaps and `gapsResolved: 0` | AC3 |
| › real run resolves only holiday-only ids with reason `non_trading_day`; a gap covering a real trading day stays out | AC3, R4 |
| › includes gaps of symbols not in any watchlist/held set, and a `symbol: null` gap | AC3 (orphans) |
| › ids are sent in chunks of `resolveChunkSize` | URL-size safety |
| › no open gaps → `ok: true`, no write | idempotent rerun |
| `store.test.ts` › EOD store passes the reason to `resolveGaps`; holiday-gaps store wiring (`listAllOpenGaps(db, 'prices_daily', …)`, `getHolidays` from `getEntrySettings`) | wiring |
| `cli.test.ts` › `resolve-holiday-gaps` and `resolve-holiday-gaps --dry-run` parse; `--backfill` and `--source` with it give usage | CLI |

## Approach
1. **Seed (AC1, R5, R1).** Create `holiday-calendar.ts`. Header comment:
   - one calendar for HOSE, HNX and UPCoM (one SGDVN letter per year, per the finance consult);
   - weekdays only (make-up Saturdays are never trading days, and the weekend logic already covers them);
   - ad-hoc closures are not holidays;
   - **"Sources are secondary; verify every date against the original notices on hsx.vn / hnx.vn before go-live."**

   Each entry's `source` gives the notice number plus one URL from `consult-finance-investment-researcher.md` (copy them verbatim; invent none). Dates:
   - **2025 (12, official):**
     - 01-01, 01-27, 01-28, 01-29, 01-30, 01-31
     - 04-07, 04-30, 05-01, 05-02
     - 09-01, 09-02

     Source: HOSE 2079/TB-SGDHCM, SGDVN 1046/SGDVN-GSTT, plus the cited later notices.
   - **2026 (13 official + 1 provisional):**
     - 01-01, 01-02, 02-16, 02-17, 02-18, 02-19, 02-20
     - 04-27, 04-30, 05-01
     - 08-31, 09-01, 09-02
     - 11-24 (Vietnamese Culture Day; `provisional: true`)

     Source: SGDVN 1403/SGDVN-THHC, HOSE 2294/TB-SGDHCM, HNX 5305/TB-SGDHN and later notices. For 11-24: Resolution 28/2026/QH16 and VPCP letter 10065/VPCP-KGVX, with no exchange notice yet.
   - **2027 (12, all provisional):**
     - 01-01, 02-04, 02-05, 02-08, 02-09, 02-10
     - 04-16, 04-30, 05-03
     - 09-02, 09-03
     - 11-24

     Source: MoHA 11483/TB-BNV and the Labour Code; the exchange calendar is not yet published.
2. **Fallback (AC2).** `effectiveHolidays(stored: readonly string[] | null | undefined): string[]` returns the sorted, unique **union** of `SEEDED_HOLIDAY_DATES` and `stored`. Empty or unset therefore gives exactly the seed. Apply it only in `packages/db` `getSettings` and `getEntrySettings`. Do **not** apply it in the core mappers or in `DEFAULT_MARKET_SETTINGS`:
   - `settingsInputToRow` writes `DEFAULT_MARKET_SETTINGS.holidays` / `existing.holidays` into the row, so putting the seed there would materialize it in the DB on the first settings save.
   - `getAppSettings` stays raw so the settings screen (and STK-047) sees what Ming actually stored. STK-047 can compute the effective list and seed metadata from the exported core functions, so no `holidaysSource` field is needed now.
3. **Gap rule (AC3, R4, R1).** `holidayOnlyGapIds(openGaps, holidays)` returns, sorted and unique, the ids whose `gapDays(g, holidays)` (the existing private helper: `tradingDaysBetween` over `vnDateOf` bounds) is empty. It never looks at stored prices, so a gap with any real trading day can never be returned. `GapResolvedReason = 'data_stored' | 'non_trading_day'`.
4. **Reason column (AC3).** Migration `20261105000100_data_gaps_resolved_reason.sql`:

   ```sql
   alter table public.data_gaps
     add column resolved_reason text,
     add constraint data_gaps_resolved_reason_check check (resolved_reason is null or resolved_reason in ('data_stored','non_trading_day')),
     add constraint data_gaps_resolved_reason_needs_resolved check (resolved_reason is null or resolved_at is not null);
   comment on column public.data_gaps.resolved_reason is 'Why the gap was resolved (STK-046). NULL: resolved before STK-046 or by a job that records no reason (financials).';
   ```

   - No backfill of old rows. No new grants: the table-level `service_role` grants and RLS cover the column (database consult §5). No index.
   - `OpenGapRow` and the mapper are unchanged.
   - `resolveGaps` adds `resolved_reason` to the update only when a reason is passed, so the financials job is untouched.
   - Deploy order: the column is additive and nullable, so it works with the previous image. docs/deploy.md "Cut a release" step 1 already applies migrations by hand before the new image. The README and the PR say: **apply this migration before the image with this code runs**, otherwise the EOD gap step's update fails with an unknown-column error (prices are already upserted before that step).
   - `check-deploy-env.sh` is unaffected (no env or compose change).
5. **EOD gap step.** In `eod-sync.ts`, after `planPriceGaps`, split `plan.toResolve` with a set built from `holidayOnlyGapIds(own, holidays)`. Collect `resolveHoliday` and `resolveData` ids. When not a dry-run, call `store.resolveGaps(resolveData, fetchedAt, 'data_stored')` then `store.resolveGaps(resolveHoliday, fetchedAt, 'non_trading_day')`. `gapsResolved` is the sum. No other EOD change.
6. **Cleanup job (AC3, existing false gaps).** `resolve-holiday-gaps`:
   - `holidays = await store.getHolidays()` (effective).
   - `open = await store.listAllOpenGaps()`: all open `prices_daily` gaps, any symbol, including NULL and symbols no longer watched or held. No price source and no network needed.
   - `ids = holidayOnlyGapIds(open, holidays)`.
   - Log one line per gap: `symbol from..to`.
   - When not a dry-run, `resolveGaps` in chunks of `resolveChunkSize` with `resolvedAt = now`, reason `non_trading_day`.
   - Summary JSON: `{ ok: true, job, dryRun, resolvedAt, openGaps, holidayOnly, gapsResolved (0 on dry-run), gaps: [{ id, symbol, from, to }] }` with VN dates.
   - Idempotent: the list only returns open rows, and `resolveGaps` keeps `.is('resolved_at', null)`. Never deletes.
   - Errors propagate to `cli.ts` main → exit 1.
   - First-run procedure in the README: apply the migration, deploy, then `run-job.sh resolve-holiday-gaps --dry-run`, review the list (Ming), then `run-job.sh resolve-holiday-gaps`. After that the EOD step keeps applying the rule for synced symbols.
7. **Docs.** Update the README Holidays section and the backfill paragraph: "if the same date is missing for every symbol, the calendar is incomplete: add it to `settings.holidays` (STK-047) or fix the seed". Also document the 2024 limit: no 2024 dates are seeded, so `--backfill` beyond about 455 trading days (before 2025-01-02) records false gaps on 2024 holidays; the default 260 stays inside 2025.
8. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm db:check` if Postgres is present (R8).

How the rules are met:
- R1: calendar, union and gap rule are in core; db and worker only call them.
- R2: n/a.
- R3: the worker only uses the service client; no web change.
- R4: gaps are never deleted, a reason is recorded, and real trading days stay open.
- R5: the calendar is configuration (seed default plus `settings.holidays`).
- R6: suspended; no auth added.
- R7: limited to the file list.
- R8: tests above.
- R9/R10: n/a.

## Specialist input used
- **finance-investment-researcher:**
  - Adopted: the dates, sources and confidence levels (all three years); a single `ALL` calendar; weekday-only; the `provisional` flag per entry; union fallback (rec 3); a reason value; the one-off pass over all open gaps; the T+2 and `expectedPriceDate` Tết tests (rec 6).
  - Adopted with change: core helper `effectiveHolidays` (rec 5) is applied in the db repo, not in every consumer.
  - Rejected for this ticket: a warning for provisional dates within 30 days. It is not in the AC; follow-up/STK-047.
- **data-engineer:**
  - Adopted: core config module; the choke-point idea (but the repo functions, not the mappers, for the materialization reason in step 2); reason column with optional `resolveGaps` param; the CLI with `--dry-run` that needs no price source; a holiday-only pure function; pagination and chunking; idempotency via the `resolved_at is null` guard.
  - Rejected: "stored replaces seed" (see decision D1 below); a `holidaysSource`/`rawHolidays` field. `getAppSettings` stays raw, so STK-047 already has the stored value.
- **database-optimizer:**
  - Adopted: seed in code, not a migration; never `from_ts::date` in SQL (use `vnDateOf`); `listOpenMarketGaps` blind spot (handled by `listAllOpenGaps` without a symbol filter); rollback file and `checks.sql` update; no index; no grant change; no backfill of reasons onto old rows.
  - Rejected: log-only reason (see D2 below); "stored replaces seed" (D1).

### Planner defaults for Ming to confirm in the PR (non-blocking)
- **D1. Fallback is a union of seed and stored, not "stored replaces seed when non-empty".**
  - The AC says "When `settings.holidays` is empty or unset, the app uses the seeded calendar; dates Ming has stored are kept, not overwritten". The union meets both halves.
  - "Replace" would drop the whole 2025–2027 seed the moment Ming stores one date (for example 2026-11-24 in STK-047).
  - With "replace", STK-047 would have to copy the seed into the DB on first save. That freezes it, so later code corrections (the official 2027 calendar, any date found wrong on hsx.vn/hnx.vn) would never reach Ming.
  - Cost: Ming cannot remove a seeded date through settings. Removal is a code change to the seed. If STK-047 needs removal, it adds an explicit exclusion list. Its contract: `getAppSettings` returns raw stored dates, and core exports `VN_MARKET_HOLIDAYS` / `effectiveHolidays`.
- **D2. Persisted `data_gaps.resolved_reason` column via migration, not log-only.**
  - AC3 says "resolved … with a recorded reason". R4 uses "recorded" for DB rows, and a log line on the home server is not a durable record.
  - The column is additive and nullable, works with the previous image, and follows docs/deploy.md step 1 (migrations applied by hand first).
  - Impacts: a rollback file; `checks.sql` assertions; no env/compose change, so `check-deploy-env.sh` is unaffected; the security auditor runs because a migration is in the diff.
  - Risk: deploying the image before the migration breaks the EOD gap step. This is called out in the README and the PR.
- **D3. 2026-11-24 (Culture Day) is seeded as `provisional: true`.**
  - Leaving it out when the market closes gives false staleness, a false gap and T+2 sellability one day early (the dangerous direction).
  - Seeding it when the market trades only delays freshness and sellability by a day, which is the cautious direction (finance consult rec 2).
  - Follow-up: re-check HOSE/HNX notices by ~2026-11-17. If the market trades, remove the date with a one-line code change. Under D1 it cannot be removed through settings.
  - 2027-11-24 is likewise provisional.
- **D4. No 2024 dates.**
  - The AC names 2025–2027, and no sourced 2024 list exists in the consults.
  - The default backfill (260 trading days) stays in 2025–2026. Only `--backfill` above about 455 (max 520) reaches 2024. This is documented in the README; a follow-up ticket only if Ming wants deeper history.
- **D5. Existing false gaps are cleaned by a worker CLI job with `--dry-run`, not only by the EOD gap step.**
  - The EOD step only sees watched or held symbols and only runs after a successful fetch.
  - The CLI covers symbols no longer watched and market-wide rows, needs no network, and gives Ming a dry-run list before anything is written.
  - From then on the EOD step records reasons for the symbols it syncs.

## Assumptions
- One calendar applies to HOSE, HNX and UPCoM (one SGDVN letter per year). No per-exchange split.
- Provisional dates are used by the app exactly like official ones (the flag is metadata for STK-047/README). A provisional date that turns out wrong is fixed in code.
- Ledger effect is intended: once `getSettings` returns the seed, `sellableFrom` of existing lots bought shortly before a holiday moves later (more correct). The ledger has no trade-date-is-trading-day validation (checked `build-ledger.ts`), so existing transactions on any date still load.
- A gap row's bounds are VN-day bounds; `gapDays` (via `vnDateOf`) handles any width. No SQL date casting.
- Signals, chart, backfill chunking and freshness pick up the seed through `getEntrySettings` with no code change. Existing tests that pass explicit `holidays: []` stay valid.
- `pnpm db:check` needs local Postgres 16. If it is unavailable in the session, the implementer records that in impl-log, and the reviewer checks the SQL by reading it.
- Migration timestamp `20261105000100` sorts after all existing migrations.

## Blocking questions
None.

## Split proposal
None. About 250 lines of non-test, non-data code. The seed table and tests add bulk but no design risk. The ticket is already the first half of Ming's split (STK-047 is the editor).

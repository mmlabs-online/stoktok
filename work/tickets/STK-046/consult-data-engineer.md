## STK-046 data-engineer consult (read-only; nothing run)

### Findings

**Where holidays are read today.** There is one source, `settings.holidays` (`date[] not null default '{}'`, in `supabase/migrations/20261023000100_v1_tables.sql:69`). Every consumer reads it through three mappers/defaults, so there are only three choke points:
- `settingsFromRow` and `appSettingsFromRow` in `packages/core/src/db/mappers.ts` (lines 163 and 204) copy `row.holidays` as is.
- `DEFAULT_MARKET_SETTINGS.holidays = []` in `packages/core/src/ledger/settings.ts:11`. `getEntrySettings` uses it when the row is missing (`packages/db/src/repos/settings.ts:64`).
- Consumers:
  - Worker `apps/worker/src/store.ts:34,67` (`getHolidays` = `getEntrySettings(db).settings.holidays`), used by:
    - `eod-sync.ts:83-85,103,229`: target date, fetch window, backfill chunks and `planPriceGaps`.
    - `medium-signals.ts:65-105`.
  - Web loaders `load-dashboard.ts:49`, `load-watchlist.ts:56,71`, `load-symbol.ts:104-141`. These feed `expectedPriceDate`, signal inputs and the chart.
- `packages/core/src/calendar.ts` is pure and takes `holidays` as an argument. Nothing needs to change in it.
- `settingsInputToRow` (mappers.ts:227) keeps `existing.holidays` and does not touch them. So the settings form never materializes the seed. Keep that behaviour.

**Gap resolution mostly exists already.** `planPriceGaps` (`packages/core/src/market/price-gaps.ts:50`) resolves any open gap whose `tradingDaysBetween(gap, holidays)` days are all stored. The comment says this is vacuously true when a holiday is added later. Two consequences:
- Once the seed flows into `getHolidays()`, the next EOD gap step resolves fully-holiday gaps automatically, using the same rule.
- Partial-overlap gaps stay open. A gap that still has a real unstored trading day fails `every`. This matches AC3 and R4.
- `readRange` is already extended to the old gaps, so old dates are read.

**Gaps:**
- `data_gaps` has only `resolved_at`, no reason column. "Resolved with a recorded reason" (AC3) needs a schema change.
- `resolveGaps(db, ids, resolvedAt)` only updates `resolved_at`, guarded by `is('resolved_at', null)`. That guard makes it idempotent.
- The existing EOD path runs only for symbols in watchlist or held. It also needs a working price source and runs fetch before the gap step. Orphan symbols, and runs that fail early, would never clean up.
- `listOpenGaps` filters by symbol. Market-wide gaps (symbol NULL) need `listOpenMarketGaps`. Check whether a market-wide gap can be a holiday gap.
- Gap bounds are VN-day timestamps (`vnDayBoundsUtc`). Comparing them via `vnDateOf` is already handled in `gapDays`.

### Recommendations

1. **Seed as a core config module (R5, AC1).**
   - Add `packages/core/src/market/holiday-calendar.ts`, or a sibling of `calendar.ts`. Do not put it in the DB or a migration seed.
   - Shape: `SEEDED_HOLIDAYS: readonly { date: 'YYYY-MM-DD'; name: string; source: string }[]` plus `provisionalYears: readonly number[]`, or per-year `{ year, provisional, sourceUrl, dates }`.
   - The calendar is one list for HOSE, HNX and UPCoM, because they share non-trading days. Say so in a comment. Do not invent a per-exchange split unless the sources differ.
   - Include weekday-only entries. Tests: ISO format via `isValidDate`, not Sat/Sun, no duplicates, sorted, every year 2025-2027 present, every entry has a non-empty source, provisional flag set where the year is not officially published (2027 likely).
   - Source citation: exchange (HOSE/HNX) or SSC announcements, with the Government's Tết decision. I could not verify the official 2026 and 2027 dates. The implementer must fetch them, and not invent any. If a source is unreachable, mark that year provisional and cite the statutory rule, rather than guess bridge days.
   - Also seed 2025 as it was announced, including 2025 bridge days, e.g. around 30/4.
2. **Fallback rule, in one pure function (AC2).**
   - Add `effectiveHolidays(stored: readonly string[] | null | undefined): readonly string[]`. Return `stored` when it has at least one entry. Otherwise return the seed dates. No merge: "stored wins". The stored list is never rewritten.
   - Apply it at the choke points only: `settingsFromRow`, `appSettingsFromRow` and `DEFAULT_MARKET_SETTINGS` (or the missing-row branch). That covers worker, loaders, chart and backfill with no per-consumer edits.
   - Caveat: `appSettingsFromRow` feeds the settings screen. STK-047 (editor) needs the raw stored value to tell "using the default" from "stored". Return `holidays` as effective and add a `holidaysSource: 'stored' | 'seed'` field, or expose `rawHolidays`. Without it STK-047 would show seed dates as if Ming had stored them, and saving would silently materialize them. `settingsInputToRow` must keep passing `existing.holidays` raw, so the form never writes the seed.
   - Edge: a stored list that is non-empty but stale (e.g. only 2026-01-01) suppresses the whole seed. That is the stated rule. Say so in the worker README (line 38 says "keep it current") and in STK-047.
   - Unit tests: null, undefined, empty gives seed; non-empty stored is kept untouched (same array content, not merged); mappers return effective holidays.
3. **Reason column (AC3).** Add one migration, e.g. `supabase/migrations/2026110xxxxx_data_gaps_resolved_reason.sql`:
   - `alter table public.data_gaps add column resolved_reason text;`
   - Add a check like `resolved_reason in ('stored','holiday', ...)` or leave it free text with a comment. Existing rows get NULL, which is fine.
   - RLS and grants are unaffected (per-table grants already cover the table). Have database-optimizer confirm.
   - Extend `resolveGaps(db, ids, resolvedAt, reason?)` and the `EodStore` and financials interfaces (backward-compatible optional param). Keep the `is('resolved_at', null)` guard.
   - Core side: make `planPriceGaps` return `toResolve: { id; reason: 'stored' | 'holiday' }[]`. Or add a second list `toResolveHoliday`, to limit the type change for `eod-sync` and the existing tests. Rule: reason is `holiday` when the gap has zero trading days under the holidays given and is not covered by stored dates. Reason is `stored` otherwise.
4. **Where to resolve existing false gaps: the EOD gap step, plus an explicit one-off command for the first run.**
   - Not a migration. A migration cannot reach the seed (it lives in TypeScript) and would duplicate the calendar, which breaks "one source". It would also be unreviewable against the sources later.
   - The normal EOD gap step is the right permanent home, because it already applies the rule and keeps working when STK-047 changes the list. A holiday later removed from settings reopens nothing, which is acceptable; note it as a limitation.
   - Add a worker CLI command, e.g. `resolve-holiday-gaps [--dry-run]`, next to the EOD CLI (`apps/worker/src/cli.ts`). It runs only the gap step: `getHolidays` (effective), list open `prices_daily` gaps for all symbols (including market-wide, and not only watchlist), `planPriceGaps`-style evaluation with `storedDates = []`, so only gaps with zero trading days resolve. Then `resolveGaps(ids, now, 'holiday')`.
   - Why this beats waiting for EOD: it needs no price source or network, covers symbols no longer watched, and is the dry-run you can show Ming before touching data.
   - Put the decision in a pure core function, e.g. `holidayOnlyGapIds(openGaps, holidays)`. It returns ids of gaps where `gapDays(...)` is empty, so it cannot resolve a gap with a real trading day. Unit tests for AC4: all-holiday gap resolves, single-day holiday gap resolves, gap spanning a holiday plus a trading day stays open, weekend-only gap (already non-trading) resolves, empty seed gives nothing, and results are sorted and unique.
   - Idempotency: the `is('resolved_at', null)` guard means a rerun updates nothing. The listing only returns open gaps, so a second run reports 0. Never delete.
   - Dry-run: print counts and the ids, symbols and dates it would resolve, writing nothing. Reuse the existing `dryRun` convention in the summary shape (`gapsResolved: 0` on dry-run, plus a `wouldResolve` list).
   - Pagination: `listOpenGaps` is one query under the PostgREST 1000-row cap. A false-gap flood (many symbols x many holiday days) could exceed it. Paginate it for this command, or loop until empty, since resolved rows leave the open set.
   - Keep the EOD hook thin: pass the reason through `resolveGaps`. For the first EOD run after deploy, eod-sync would also resolve those gaps, but only for its symbols.
5. **Consumers to leave alone (R7).** `expectedPriceDate`, signals, chart and backfill get the seed through the effective setting. Add one test per consumer boundary only where cheap: `eod-sync` with `getHolidays` returning seed dates skips Tết days in `tradingDaysBetween`. Do not touch web components.
6. **Tests and checks (R8):** the listed unit tests, plus the `resolveGaps` reason arg (repo fake client), the CLI dry-run/no-write test, and `store.test.ts` wiring. Run `pnpm typecheck`, `lint`, `test`.

### Risks
- Wrong or invented holiday dates: a false holiday suppresses a real trading day, which creates a missing-data hole and hides real gaps (R4). A missing holiday leaves false gaps (harmless, self-corrects once added). Prefer a conservative list and mark provisional years clearly. Provisional dates are still used by the app. Say so in the README. They should be reviewed once the exchange announces.
- Announced bridge days (e.g. extra days added around 30/4-1/5 or 2/9) are often confirmed only months ahead. 2027 is probably provisional; 2026 late-year entries may be too.
- A non-empty stored list masks the seed entirely, including Ming's old test dates.
- Anything in the ledger that uses holidays (settlement date `addTradingDays`, the trade-date check, sellable quantity) will change for already-entered transactions once the seed applies. Results become more correct, but `sellableFrom` on existing lots may shift. Call it out to finance review; add a test or snapshot if one exists.
- Reason column: a migration on the shared Supabase project; apply order with the code deploy. Code that writes `resolved_reason` must not run before the migration. Make the code tolerant, or ship the migration first.
- Gap rule at the edges: gaps are stored as VN-day bounds, so a gap row that spans midnight in UTC but is one VN day is handled by `vnDateOf`. Gaps written with different bounds (backfill chunks) are covered by `gapDays`, no assumption on width.

### Open questions
1. Is a `resolved_reason` column acceptable (a small migration), or should the reason be stored another way (e.g. source marker in an existing column)? Recommend the column.
2. Should the seed be one list for all exchanges? Recommend yes, with a comment. Confirm no per-exchange differences exist in the sources.
3. Should a provisional year apply to signals and gaps immediately? Recommend yes, with README note.
4. Should STK-047 see raw vs effective holidays? Needs `holidaysSource` (rec 2); this ticket should expose it so STK-047 does not have to change the mapper contract.
5. Confirm the first-run procedure with Ming: run the CLI in dry-run on the home server, review, then run for real. Is a market-wide-gap case expected in the data?

Relevant files (all under /home/user/stoktok):
- /home/user/stoktok/packages/core/src/calendar.ts
- /home/user/stoktok/packages/core/src/market/price-gaps.ts
- /home/user/stoktok/packages/core/src/ledger/settings.ts
- /home/user/stoktok/packages/core/src/db/mappers.ts
- /home/user/stoktok/packages/db/src/repos/settings.ts
- /home/user/stoktok/packages/db/src/repos/data-gaps.ts
- /home/user/stoktok/apps/worker/src/jobs/eod-sync.ts
- /home/user/stoktok/apps/worker/src/store.ts
- /home/user/stoktok/apps/worker/src/cli.ts
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/user/stoktok/apps/worker/README.md

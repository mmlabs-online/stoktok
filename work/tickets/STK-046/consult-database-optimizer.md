**Findings**

- **`settings.holidays`** is `date[] not null default '{}'` (`supabase/migrations/20261023000100_v1_tables.sql:69`). It is a single row (`id = 1`). Nothing in the schema distinguishes "never set" from "Ming set it to empty". Both are `{}`, so the fallback rule must be "empty means use the seeded calendar", as the ticket says. The ticket's "dates Ming has stored are kept" is then a code rule, not a schema one.
- **`data_gaps`** has `id, symbol (null = market-wide), data_type, from_ts, to_ts (timestamptz, to_ts >= from_ts), detected_at, source, fetched_at, resolved_at`. There is no reason column. The only index is `(symbol, from_ts)`.
- **Resolution already exists.** `planPriceGaps` in `packages/core/src/market/price-gaps.ts` computes the trading days of each open gap using `tradingDaysBetween(vnDate(from), vnDate(to), holidays)`. It resolves the gap when every one of those days is stored. If the day list is empty (all weekend or holiday), `every` is vacuously true, so the gap resolves. This is the "added later: no longer expected" case noted in the comment at line 49. A gap that still contains a real unstored trading day stays open, which meets the R4 criterion.
- **`resolveGaps`** (`packages/db/src/repos/data-gaps.ts:41`) sets `resolved_at` only where `resolved_at is null`, so it is idempotent and rows are never deleted.
- **The gap bounds are VN-day bounds** in UTC (`vnDayBoundsUtc`), and the planner converts back with `vnDateOf`. A cleanup must use the same helpers. Do not cast `from_ts::date` in SQL, because that uses UTC and is off by one day.

**Recommendations**

1. **No schema change for resolution.** `resolved_at` is the record. The acceptance criterion "with a recorded reason" can be met without a column in either of two ways:
   - Record the reason in the `impl-log`, a worker log line, or the job summary. The reason is derivable: a resolved gap whose days are all holidays/weekends and have no `prices_daily` rows.
   - If a persisted reason is truly required, add a nullable `resolution text` column (check in `('stored','non_trading_day')`). That is additive and low risk, but it is a hand-applied migration. It needs a rollback file, an update to `scripts/db-check/checks.sql` (which asserts columns and the table list), and the `OpenGapRow` mapper left untouched. I recommend asking Ming, or the planner choosing, the smaller option, which is no column. Do not backfill a reason onto old rows.
2. **Seed the calendar in code, not in a migration (R5, STK-046).** Put it in `packages/core` as a typed constant: ISO date, exchanges (or "all"), reason label, source citation, and a per-year `provisional` flag. Reasons:
   - A migration would write only one `settings` row, which may not exist yet (the other columns are `not null` without defaults).
   - It would have to overwrite or merge into Ming's stored dates.
   - It is applied by hand in production, so the app and the data could drift.
   - A code constant is testable, covers all of 2025-2027, and supports "empty means use seed". Resolution is then one cleanup path.
   - STK-047, the editor, will want to display the seed as the default.
3. **Fallback rule.** The effective holidays are `settings.holidays` when it is non-empty, else the seed. Ming's stored dates are never rewritten. Decide with the planner whether stored dates are unioned with the seed or replace it. Replacing matches the ticket's "empty or unset" wording. Unioning would silently ignore a deliberate removal. I recommend replace, with one pure function in core used by the EOD job, the backfill, signals and the chart.
4. **Gap cleanup query shape.** Do it as a pure core function plus the existing repos, with no SQL date logic:
   - Load open gaps with `listOpenGaps(db, PRICES_GAP_TYPE, symbols)`. Also call `listOpenMarketGaps`, which is separate because `symbol is null` is missed by `.in('symbol', ...)`.
   - Filter in code to gaps where `tradingDaysBetween(vnDateOf(from), vnDateOf(to), holidays)` is empty.
   - Pass those ids to `resolveGaps(db, ids, now)`.
   - Do not reuse `planPriceGaps` as is: it also resolves gaps whose days are all stored, which is fine but not "holiday only". Prefer a small function that is explicit about the holiday-only case. The criterion "a gap that also covers a real trading day is left open" is then tested directly, including a gap that spans a holiday plus a real day.
   - Scale is tiny (single user, hundreds of rows at most), so no new index is needed. An open-gap filter on `resolved_at is null` and `data_type` is a small scan. A partial index would be premature.
   - Where the cleanup runs (an EOD/backfill job step, or a one-off script) is the planner's call. It must be re-runnable. Note that once the EOD job passes the new holidays, the existing planner already resolves these gaps on the next run, so a separate step may be unnecessary. Confirm by checking how the job loads `holidays` in `apps/worker`; I did not read that code.
5. **RLS and grants are unchanged.** `data_gaps` and `settings` are already RLS-on with `service_role` select/insert/update/delete only. An update of `resolved_at` needs nothing new. If the optional column is added, table-level grants cover it.
6. **Weekend handling.** The seed must contain weekdays only (a test criterion). `tradingDaysBetween` presumably skips weekends already. Add a test that a weekend-only gap resolves, so the behaviour is explicit.

**Risks**

- A wrong or incomplete holiday list works against R4 in both directions. A missing holiday leaves a false gap. A wrong extra holiday would resolve a real gap as "no longer expected" and hide missing data. Hence the per-year `provisional` flag, citations, and a test that every seeded date is a weekday.
- 2027 is probably not officially published yet (today is 2026-11-04). It must be marked provisional and the values flagged as estimates. I did not research the dates; that is the finance/data consultants' job.
- Resolved rows lose their reason unless it is logged. A rerun cannot tell holiday-resolved from stored-resolved afterwards, but the data themselves show it.
- Resolving a gap makes `data_gaps:id` refs cited by past signals point at a resolved row. This is existing behaviour for resolved gaps, so it is not new.
- Un-resolving is not supported. If Ming later removes a holiday from `settings`, the already-resolved gap is not reopened. The planner would re-record the now-missing day as a new gap, which is acceptable.

**Open questions**

- Is a persisted resolution reason required, or is a log/impl-log record enough? (I recommend a log record and no migration.)
- Should stored `settings.holidays` replace the seed or be unioned with it?
- Are holidays per exchange or one list for all three? The `settings` column is a single flat `date[]`, which implies one shared list. Per-exchange differences would need `rule_configs`. HOSE, HNX and UPCoM normally share non-trading days.
- Does the worker already read `settings.holidays`, or does it pass `[]` somewhere? Check every call site of `tradingDaysBetween` and `planPriceGaps` for hard-coded `[]`.

Files read: /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql, /home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql, /home/user/stoktok/packages/core/src/market/price-gaps.ts, /home/user/stoktok/packages/db/src/repos/data-gaps.ts.

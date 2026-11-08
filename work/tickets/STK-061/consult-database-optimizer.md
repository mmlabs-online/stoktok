**STK-061 consult (database): schema for statement lines and ratios**

Read-only review. I read the ticket, `supabase/migrations/20261026000100_financials.sql`, its rollback file, `packages/db/src/repos/financials.ts`, `apps/worker/src/jobs/financials-sync.ts`, and the `financials` references in `scripts/db-check/checks.sql`. I did not open `medium-signals.ts` or the ADRs. I know the STK-015 readers only from the grep hits and the repo's `listFinancials` API.

## Findings

1. **`public.financials` is a narrow, strict table.**
   - Its primary key is `(symbol, period)`, with `period` matching `^[0-9]{4}Q[1-4]$`.
   - `eps`, `bvps`, `revenue` and `net_income` are all NOT NULL.
   - `listFinancials` compares `period` as text with `gte('period', fromPeriod)`. That only works because every period has the same shape.
   - `upsertFinancials` conflicts on `symbol,period` and overwrites every column, including `fetched_at`. ADR 0002 sets this restatement policy.
   - `financials-sync` records missing quarters in `data_gaps`, using `data_type = FINANCIALS_GAP_TYPE` and the quarter's `from_ts`/`to_ts`.
2. **Wide columns do not fit this ticket.**
   - Banks, securities firms and insurers report different statement lines from industrial companies. That means many nullable columns that only some symbols can fill.
   - NULL would have to mean "not applicable", "gap" or "not fetched". That muddies R4, "a gap is never written as zero".
   - Adding a line means a migration (a High-tier path).
3. **A long table fits better.** One row per (symbol, period, line) means a missing line is simply a missing row. That is the R4 behaviour with no extra work. A new line only needs a mapper entry in `packages/core`.
4. **The db-check script lists tables explicitly.** `scripts/db-check/checks.sql` line 34 asserts the exact table list, so new tables will fail it until it is updated.

## Recommendations

**Tie to AC 4 and AC 5 unless noted.**

1. **Leave `public.financials` untouched.**
   - Do not turn it into a view, rename columns or loosen NOT NULL. STK-015's medium-signal readers, `repos/financials.ts` and the db-check assertions depend on it as it is.
   - The STK-015 readers keep working because nothing they read changes. Only additive tables go in the new migration.

2. **Add `public.financial_lines` for statement lines.**
   - Columns: `symbol`, `period_kind`, `period`, `statement`, `line`, `value`, `source`, `fetched_at`.
   - `symbol`: same regex check as `financials`.
   - `period_kind`: `text check (period_kind in ('quarter','year'))`.
   - `period`: `text check (period ~ '^[0-9]{4}(Q[1-4])?$')`. Add a table check that ties the two columns together: quarter requires `Q[1-4]`, year requires four digits only.
   - `statement`: `text check (statement in ('income','balance','cashflow'))`.
   - `line`: `text check (line ~ '^[a-z][a-z0-9_]{1,63}$')`. Use a regex rather than an enum, so adding a line needs no migration. Keep the allowed-line registry in `packages/core` config (R5).
   - `value`: `bigint not null`, in VND (R2). No sign check, because cash flow, capex and some profits can legitimately be negative. Do the sanity checks in the core mapper.
   - `source`: `text not null check (source <> '')`. `fetched_at`: `timestamptz not null` (R4).
   - Primary key: `(symbol, period_kind, period, line)`. This is the upsert conflict target.
   - Keep `statement` out of the key. A line name should belong to exactly one statement, and core should enforce that.

3. **Annual versus quarterly periods.**
   - Use the separate `period_kind` column. Do not encode annual as a different period string inside one sort order.
   - Unfiltered text comparison would put `'2025'` before `'2025Q1'`. So every reader must filter `period_kind` first and then `period >=`. Put that into the repo function signature.
   - Annual gaps need their own `data_type`, for example `financials_annual`. Annual `from_ts`/`to_ts` span the fiscal year.
   - Quarterly TTM and cumulative-versus-discrete cash-flow semantics must be pinned down in the mapper and in a column comment. Vietnamese sources often publish cumulative YTD cash flow. If the source gives YTD, either store YTD with a clear line name or de-cumulate in core. Do not mix the two.

4. **Add `public.financial_ratios` for ratios.**
   - Same key shape: `(symbol, period_kind, period, ratio)`.
   - Columns: `value_bp bigint not null`, `basis text check (basis in ('source','derived'))`, `source`, `fetched_at`.
   - Use basis points for percentage ratios (ROE, ROA, margins, YoY, debt/equity). For multiples such as P/E and P/B, "basis points" is awkward. Pick a documented fixed scale, for example multiple × 10,000, and define it once in core config (R2, R5).
   - A negative or meaningless ratio (P/E on a loss) should produce no row, which is a gap rather than a zero.
   - P/E and P/B depend on price, so a stored value goes stale daily. Either add `as_of date` and the price source, or compute them at read time in core from stored EPS/BVPS and the latest price.
   - My leaning is to store only the financials-derived ratios (ROE, ROA, margins, debt/equity, YoY). Compute P/E and P/B on read. R1 is satisfied either way, as long as the arithmetic lives in core.
   - Derived rows still need `source` and `fetched_at`. Use `source` such as `derived:<lines source>` and the `fetched_at` of the sync run.

5. **Keep the old and new data consistent.**
   - The same sync run should write both `financials` and `financial_lines`, from the same fetch. The overlap is revenue and net income.
   - Use separate line names to avoid conflation. The ticket says "net income attributable to the parent", while `financials.net_income` has an unverified basis per ADR 0002. Name the new line `net_income_parent` so nobody assumes they are equal.
   - Add a consistency check to the worker tests, for example when `financials.revenue` and the `revenue` line both exist, they match for a fixture period.

6. **Idempotent upsert.**
   - Mirror `upsertFinancials`: dedupe in memory by the full key, last duplicate wins, chunk at 500, no `.select()`, `onConflict: 'symbol,period_kind,period,line'`.
   - Overwrite all columns, including `fetched_at`, as under the ADR 0002 restatement policy.
   - Extend the restatement log to report which lines changed.
   - Row volume is small, roughly 20 lines times about 20 periods, or about 400 rows per symbol.
   - Delete nothing on re-sync. A line that disappears from the source stays as the last stored value, and the gap planner decides what to flag.

7. **RLS and grants pattern (AC 5).**
   - For each new table, in the same migration file as the table: `alter table … enable row level security; revoke all on … from anon, authenticated; grant select, insert, update, delete on … to service_role;`. Add no policies.
   - Say in a comment that the global grants loop in `20261023000200` does not cover later tables. The `financials` migration already notes this.
   - Name the migration with a timestamp after `20261105000100`.
   - This is a High-tier path, so Ming reviews the PR.

8. **Rollback file.**
   - Add `supabase/rollback/<same timestamp>_<name>.down.sql`.
   - Drop `financial_ratios` and `financial_lines`, in that order, with `drop table if exists`.
   - Do not touch `financials` or `symbols`.

9. **Update `scripts/db-check/checks.sql`.**
   - Extend the table-list assertion at line 34 and add column-shape assertions (`pg_temp.assert_col`) for the new tables.
   - Add service_role read/write and anon/authenticated denial checks.
   - Add negative inserts: a bad `period_kind`/`period` combination, an empty `source`, a bad `line` regex.

10. **Indexes.**
    - The primary key `(symbol, period_kind, period, line)` already serves the main read: symbols `in (…)`, one kind, `period >=`.
    - No FK, so no extra index is needed. Skip secondary indexes until a real query needs one.
    - Do not add a FK to `symbols`. `financials` has none, and sync can see symbols before they are registered.

11. **Query shape for AI context reads (STK-064 and STK-066).**
    - One round trip per request:
      `select symbol, period_kind, period, statement, line, value, source, fetched_at from financial_lines where symbol = any($1) and period_kind = $2 and period >= $3`
      Run the same pattern against `financial_ratios`. Do not issue one query per symbol (N+1).
    - Pivot in core, not SQL, so the model gets a compact structure.
    - R9 needs a stable citation ID per input. The composite key rendered as `SYM|kind|period|line` is deterministic and enough. Avoid adding a surrogate id column.
    - Pass `source` and `fetched_at` through to the AI context. Pass absence explicitly, for example "line not available", never zero.
    - Cap the window, for example 8 quarters plus 5 years. That is a few hundred rows per symbol and needs no pagination.

## Risks

- **Cumulative cash-flow data.** YTD versus discrete quarters is the most likely silent-wrong-number trap. The fixture and mapper tests must cover Q1 to Q4 explicitly.
- **Company-type differences.** The VCI source may report banks and securities firms under different line sets. The existing "unsupported company type" reject path in `financials-sync` should carry over, with the unsupported list reported, not failed.
- **Duplicated numbers.** Revenue and net income now live in two places. If the two writes are not in the same run, readers can see different restatement states.
- **Stale price-dependent ratios.** If P/E and P/B are stored, they go stale. Prefer computing them on read.
- **Annual gaps.** Annual data is usually available only after year-end. Gap planning needs a publish-lag window for annual periods, so a missing current-year row is not flagged too early.
- **Source terms.** The terms check for VCI/TCBS is a plan item per AC 3. The schema is neutral on it.
- **Migration policy.** This is a High-tier path under the PR-tier rule, so it needs Ming's review. It should not be bundled with unrelated changes.

## Open questions

1. Do cash-flow lines come cumulative (YTD) or discrete from the chosen source? Default: store discrete, de-cumulate in core, and keep the YTD figure out of the table.
2. Should P/E and P/B be stored or computed on read? Default: compute on read, store only the financial-statement-derived ratios.
3. What is the ratio scale for multiples (P/E, P/B, debt/equity)? Default: ×10,000 for every ratio, so basis points for percentages and the same scale for multiples. One documented scale lives in core config.
4. Are annual figures from the source's own annual endpoint, or summed from four quarters? Default: take the source's annual figure with its own provenance. Never sum quarters silently.
5. Is `net_income_parent` the same figure as `financials.net_income`? ADR 0002 says its basis is unverified. Default: keep them as separate lines and do not claim they match until verified against the live samples.

Files for reference:
- `D:\mmlabs\spaceM\projects\stoktok\supabase\migrations\20261026000100_financials.sql`
- `D:\mmlabs\spaceM\projects\stoktok\supabase\rollback\20261026000100_financials.down.sql`
- `D:\mmlabs\spaceM\projects\stoktok\packages\db\src\repos\financials.ts`
- `D:\mmlabs\spaceM\projects\stoktok\apps\worker\src\jobs\financials-sync.ts`
- `D:\mmlabs\spaceM\projects\stoktok\scripts\db-check\checks.sql`

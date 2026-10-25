# consult-data-engineer — STK-011

STK-011 consult (data-engineer, read-only). No live sources checked. Everything about the VN tick table and TCBS responses is from background knowledge.

## Findings
- **Schema.** `watchlist(symbol pk, group_name default 'watching', added_at)` has no exchange column. `prices_daily(symbol, trade_date, open, high, low, close, volume, foreign_net, source, fetched_at)` has none either. The `Exchange` type and `priceLimitPpm` (HOSE 70000, HNX 100000, UPCOM 150000) exist in core `settings/market-rules.ts`. `priceTone` and `changeTone` exist in `tone.ts` and need integer ref/ceiling/floor. `watchlist.group_name` is unused. Holdings are derived, so the Holdings group should not be stored.
- **EOD sync set.** `apps/worker/src/jobs/eod-sync.ts` already syncs `listWatchlistSymbols()` ∪ `listHeldSymbols`, normalized, deduped and sorted. The acceptance criterion "adding a symbol makes it part of the EOD sync set" is therefore already true with no worker change. It only needs a test that proves it. The fetch window is `lookbackTradingDays` back from the target date, so a newly added symbol gets history on the next run.
- **Stored prices.** `getLatestCloses` returns only the latest close per symbol, one query per symbol, as a `PriceQuote` (symbol, tradeDate, close, source, fetchedAt). It does not return volume, and it does not return the previous close. `upsertPricesDaily` is a worker-side write and STK-011 does not need it.
- **Price data caveat.** The ADR says prices are "assumed raw" (UNVERIFIED), and the TCBS source is unverified too. Raw means the previous close in the table is the unadjusted close.
- **STK-031.** It is BACKLOG. `data_gaps` is never written and there is no gap reader. `priceStatus(quote, expectedDate)` in `freshness.ts` only reports `fresh`, `stale` or `missing`, using the latest trade date against `expectedPriceDate`.

## Recommendations

**1. Reference price (R4, R7)**
- The reference is the close of the session immediately before the last stored session for that symbol. Take the last two rows by `trade_date` from `prices_daily` (`last`, `prev`). Compute ref, ceiling and floor for the session on `last.tradeDate`, not for tomorrow.
- Do not guess the reference when the prior row is not the previous trading day. If `prev.tradeDate !== previousTradingDay(last.tradeDate, holidays)`, there is a gap. Return `ref: null` and show "no reference" (flag it as gapped). Use the calendar helper, not `last - 1`.
- Only one stored row (a newly added symbol) also means `ref: null`. Do not fall back to the open or to the last close as the reference.
- Corporate actions: the exchange sets the reference at the ex-date as the adjusted theoretical price, not the previous close. Cash dividend: previous close minus dividend. Stock dividend: close × den / (den + num). On the ex-date the previous raw close is therefore wrong as a reference, and it would produce a false ceiling/floor and a false change percentage. This is UNVERIFIED for the exact formula, and it also differs for rights issues, which v1 does not model.
- Minimal option: when `last.tradeDate` equals a `corporate_actions.ex_date` for that symbol (the table has `symbol, ex_date`), mark the reference as `ref_unreliable` and show change and % as "n/a" for that session, with a flag. Reading `corporate_actions` already has a repo (`listCorporateActions`).
- Computing the theoretical reference in core is possible, and it is a follow-up. Computing it silently is risky: the rounding to the tick is not verified, and the exchange's published reference is the truth. Do not add it under R7.
- A simpler alternative if the board must be always-correct: add `reference_price` to a later EOD-sync schema from the source. That is a migration plus a worker change, out of scope for STK-011.

**2. Exchange of a symbol (R5, R7)**
- Three options:
  - (a) A new `watchlist.exchange` column.
  - (b) Derive it from the TCBS response.
  - (c) A symbol-to-exchange map in settings `rule_configs`.
- Held symbols that are not on the watchlist have no row in `watchlist`, so (a) does not cover the Holdings group.
- The TCBS `bars-long-term` response is a price series. I do not recall any exchange field in it, UNVERIFIED. Option (b) is not feasible without new source calls, and the web must not call TCBS.
- Minimal option for R7: **a nullable `exchange` text column on `watchlist` plus an optional exchange field on the add form**, checked against `EXCHANGES`. It needs one migration with `check (exchange in ('HOSE','HNX','UPCOM'))`, nullable and no default. The RLS grants migration may need a look.
- For held symbols not on the watchlist: the Holdings group has no stored exchange. Either show them without ceiling/floor, or (cleaner) add them to the watchlist with an exchange. I recommend showing ceiling/floor only when an exchange is known. A separate follow-up is a `symbols` table keyed by symbol with an exchange, used by both groups. Ming decides.
- When the exchange is unknown: show last close, change, %, volume and freshness, but ceiling/floor as "-". Do not default to HOSE. A wrong 7% limit is a false claim. `priceTone` against a null ceiling/floor must fall back to `changeTone`.

**3. Rounding of ceiling/floor to the tick (integer math only)**
- Prices are integer VND (R2) and the limit is in ppm. Compute `rawCeiling = ref + ref * ppm / 1_000_000` and `rawFloor = ref - ref * ppm / 1_000_000` as integers with no floats. `ref * ppm` is at most about 10^7 × 1.5×10^5 = 1.5×10^12, which is a safe integer.
- The exchange rule, as I best know it (UNVERIFIED, verify against HOSE/HNX rules before go-live): ceiling is rounded **down** to the tick and floor is rounded **up** to the tick, so both stay inside the limit.
- HOSE ticks for stocks, UNVERIFIED: under 10,000 VND the step is 10 VND, from 10,000 to under 50,000 it is 50 VND, from 50,000 up it is 100 VND. Ceiling and floor are rounded to the tick of the price band they land in. A band edge needs care: use the tick of the band that the rounded value falls in, and recheck after rounding.
- HNX and UPCoM stock tick, UNVERIFIED: 100 VND at all prices. The ticket's own wording agrees with this. HNX and UPCoM also have other products (ETF, covered warrants, bonds) with different ticks, and they are out of scope.
- HOSE ETFs and covered warrants use a 10 VND tick, UNVERIFIED, and are out of scope. Odd-lot and some other cases are not relevant to the reference.
- The tick table is market config (R5). Add it to `market-rules.ts` next to `priceLimitPpm` (for example `tickBands: Record<Exchange, {upTo, step}[]>`, parsed with the same fallbacks), not hard-coded in the helper. The default must be clearly marked UNVERIFIED and added to the go-live checklist, like the existing market defaults.
- Do not reuse `DEFAULT_PRICE_SANITY.priceStepVnd` (10). It is a sanity guard for source data, not the exchange tick, and it is wrong for HNX/UPCoM and above 10,000 on HOSE.
- Rounding: floor-division `Math.floor(x / step) * step` for the ceiling, and `Math.ceil` for the floor, with integer `x`. With positive integers, a `%` form also avoids float surprises.
- Also check `ref` is a valid tick price (`assertVnd`), and that `floor <= ref <= ceiling` holds, since `priceTone` throws otherwise.

**4. Change and %**
- `change = last.close - ref` (integer VND, can be negative), in core. `changePctPpm = round(change * 1_000_000 / ref)` as an integer in ppm, or in basis points, formatted only by the UI (R1, R2). Define the rounding mode once (round half away from zero is conventional, UNVERIFIED for the display) and test negative values.
- `ref` zero or null gives null change and %. The UI formats and displays only, with `changeTone` for color.
- Use the settings and tone helper: `priceTone` on the last close against ref/ceiling/floor, falling back to `changeTone` when there is no ceiling/floor.
- New core helper, for example `portfolio/price-board.ts` or `market/price-board.ts`: `buildPriceBoardRow({ symbol, last, prev, exchange, rules, expectedDate, holidays, exDates })` returning ref, ceiling, floor, change, changePctPpm, tone, status and flags. This is what the acceptance criterion needs as "the core reference/ceiling/floor helper" with unit tests.

**5. Adding a symbol and the EOD sync set**
- The sync set already includes the watchlist (see Findings). The acceptance criterion needs only a unit test, in the worker or at the `eod-sync` level, with a fake store, showing a newly added watchlist symbol is in `summary.symbols`.
- Do not trigger an immediate fetch from the web. R3 and the worker owns TCBS. Show the row as "no data yet" (`status: 'missing'`) until the next scheduled EOD run, with a visible "will update after the next EOD sync" note.
- If an immediate fetch is wanted later, the right way is a worker-side trigger, for example a request row or a CLI/manual job run, as a separate ticket. Not for STK-011 (R7).
- Validate and normalize the symbol with core `normalizeSymbol` in the server action, so what is stored matches what the worker normalizes. Duplicate add gives `CONFLICT` from the repo, and a symbol that is already held is still allowed on the Watching list (decide whether to hide duplicates in the UI: show it in Holdings only, I suggest).

**6. Freshness and gap flag without STK-031**
- Use `priceStatus(quote, expectedPriceDate(now, holidays, cutoff))` for fresh/stale/missing, which exists today and needs only the latest close.
- Add a derived "gapped" flag from the last two stored rows (see 1): if `prev.tradeDate` is not `previousTradingDay(last.tradeDate)`, set `gapped` true. This only detects a hole directly before the latest bar. A hole deeper in the history is not seen, and a hole at the end shows up as `stale`.
- Better, and still cheap: read the open `data_gaps` rows for the symbols (`resolved_at is null`) and OR that into the flag. The table is empty until STK-031 ships, so this is harmless today and becomes accurate later. If no repo exists, a `listOpenGaps(db, symbols)` is a small read, but it is optional under R7. I would only do the derived flag now, and note in the plan that STK-031 will feed the flag.
- State clearly in the UI and the plan that "not flagged" does not mean "no gaps" until STK-031 is done. Never present a price board as complete without the freshness badge (R4). A `missing` or `stale` symbol must not feed any signal, which is not relevant here as there are no signals yet.
- Show `fetchedAt` as the last update time (the quote already carries `source` and `fetchedAt`, so R4 is satisfied by displaying them).

**7. Repo functions needed**
- `getLastTwoCloses(db, symbols)` (or `getRecentBars(db, symbols, n = 2)`) in `packages/db/src/repos/prices-daily.ts`. Return, per symbol, the last N rows with `trade_date, close, volume, source, fetched_at`, newest first.
  - A single query: `select ... in('symbol', symbols) and trade_date >= (expectedDate − ~10 calendar days)`, ordered by `symbol, trade_date desc`, then take the first N per symbol in code. The fake client supports `gte`, `eq`, `select` and maybe not `in`, so check `packages/db/test/fake-client.ts` before choosing between `in` and one query per symbol (matching the existing `getLatestCloses` pattern).
  - Calling it with a bounded date window avoids a full table scan. Mapping rows to a core `PriceBar` type belongs in `mappers.ts`, and volume must be mapped from bigint (a safe integer check, since supabase may return a number).
- Extend or add the quote type to carry `volume` (the existing `COLS` does not select `volume`, and `PriceQuote` has no volume). Do not break existing `getLatestCloses` callers (the worker `getLatestCloses` store method expects `Record<string, number>`).
- `listWatchlist` already exists and `addToWatchlist` takes only `symbol`. With the exchange column, extend the repo signature to `addToWatchlist(db, symbol, exchange?)`, and update `WatchlistRow`, `WatchlistEntry`, the mapper and `COLS` (and the `assets-watchlist.test.ts` fake-client tests).
- For held symbols, `listHeldSymbols(db, asOf)` returns `Result<string[]>`, so the page must handle the error case (ledger error) explicitly instead of showing an empty Holdings group.
- The corporate-action ex-dates for the ex-date flag come from `listCorporateActions` (existing).
- Holidays come from settings (`settings.holidays`) and the cutoff from `DEFAULT_PRICE_CUTOFF_MINUTES_VN`.

## Risks
- A wrong or unknown exchange gives a wrong limit. Defaulting to HOSE would show false ceiling and floor colors (purple/cyan on the wrong price), so unknown must stay unknown.
- Ex-date sessions: a raw previous close gives a false reference, change and ceiling/floor, so a stock dividend would look like a big drop. The flag is essential.
- The HOSE tick table and the rounding direction are UNVERIFIED. If either is wrong, ceiling/floor can be one tick off, and the ceiling/floor color would be wrong on the very day the stock hits its limit. Put it on the go-live list.
- Raw vs adjusted prices are UNVERIFIED in the ADR. If TCBS returns adjusted history, the previous close in the table is already adjusted after an ex-date and the reference would differ from the exchange's. Check a real symbol once with live access.
- The gap flag is partial until STK-031 (see 6). Do not let the UI imply completeness.
- A migration (the exchange column) crosses into the `db` area: the ticket's areas are `ui, data`, so the plan should add `db` or get Ming's OK. The security auditor runs for migrations. The table has RLS grants in `20261023000200_v1_rls_grants.sql`, which should cover a new column on the existing table, but check that the grants are not column-level.
- The ticket's "behind auth (R6)" is waived under the current R6 suspension. Do not add auth code, and keep the actions server-side so `requireUser()` can be added later.
- Holdings group symbols not on the watchlist have no exchange. Unless a `symbols` table is added, they show no ceiling/floor (a UX gap to accept).

## Open questions
1. Ming: is a nullable `watchlist.exchange` (with the optional exchange selector on the add form) acceptable, with ceiling/floor shown as "-" when it is unknown? Or should it be required on add? And is a migration allowed in this ticket (add `db` to areas)?
2. Ming: for held symbols that are not on the watchlist, accept no ceiling/floor, or should the exchange be captured elsewhere (a `symbols` table or the transaction entry)?
3. Someone with live access should verify the HOSE/HNX/UPCoM tick table, the rounding direction (ceiling down, floor up), the ex-date reference rule, and whether TCBS returns raw or adjusted prices and the exchange.
4. Should the ex-date session simply flag the reference as unreliable (my recommendation), or should core compute the theoretical reference from `corporate_actions` as a follow-up ticket?
5. Is a "last updated" display of the quote's `fetchedAt` enough for the freshness badge, or is a market-wide "last EOD sync" time also wanted?

Files read: /home/user/stoktok/work/tickets/STK-011/ticket.md, /home/user/stoktok/work/tickets/STK-031/ticket.md, /home/user/stoktok/work/tickets/STK-005/consult-data-engineer.md, /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql, /home/user/stoktok/packages/db/src/repos/watchlist.ts, /home/user/stoktok/packages/db/src/repos/prices-daily.ts, /home/user/stoktok/packages/db/src/holdings.ts, /home/user/stoktok/apps/worker/src/jobs/eod-sync.ts, /home/user/stoktok/apps/worker/src/sources/tcbs.ts, /home/user/stoktok/packages/core/src/market/daily-bar.ts, /home/user/stoktok/packages/core/src/market/config.ts, /home/user/stoktok/packages/core/src/portfolio/freshness.ts, /home/user/stoktok/packages/core/src/settings/market-rules.ts, /home/user/stoktok/packages/core/src/tone.ts, /home/user/stoktok/packages/core/src/calendar.ts, /home/user/stoktok/docs/adr/0001-eod-price-source.md (grep only). I did not read the STK-005 plan.md, review.md, or the database-optimizer consult, packages/db/test/fake-client.ts, or the RLS grants migration.

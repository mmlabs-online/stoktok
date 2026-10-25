Status: READY

# Plan — STK-011: Watchlist screen

## Spec summary
- docs/spec-v1.md §3 F3 Watchlist:
  > - Two groups: **Holdings** (auto from portfolio) and **Watching** (manual).
  > - Price, change, volume, last update time, data-freshness badge.
- §2.1: "All values below are **configuration, not hard-coded**, and must be verified against current exchange and TCBS rules before go-live." The relevant row is "Daily price limits | HOSE ±7%, HNX ±10%, UPCoM ±15% | Ceiling/floor distort technical signals; flag limit-hit sessions".
- §5 data model: "`watchlist` | symbol, group, added_at".
- §4.4: "EOD OHLCV sync | After market close". v1.0 is "EOD data only" (§ phases).
- CLAUDE.md R1 (no calculation in UI), R2 (integer VND), R3 (server-only DB), R4 (`source` + `fetched_at`, stale/gapped flagged), R5 (price limits per exchange are configuration), R7. Price colors: "up green, down red, reference yellow, ceiling purple, floor cyan".
- Ticket Notes, Ming 2026-10-25: "add a small `symbols` table (symbol → exchange, nullable exchange) via a migration, shared by held and watched symbols. Ming picks the exchange when adding a symbol (may leave it blank). Unknown exchange → ceiling/floor shown as "—", never defaulted to HOSE."
- R6 is suspended (CLAUDE.md), so AC1's "behind auth (R6)" is waived. No auth code is added. All DB access stays in server code (R3).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | The Holdings group is derived from current holdings and is not stored. The Watching group supports add and remove of a symbol through server actions (auth waived, R6 suspended). | `load-watchlist.test.ts › holdings come from the ledger, not the watchlist table` and `› held+watched symbol shown once in Holdings`. `watchlist/handlers.test.ts › add: success / invalid symbol / duplicate / bad exchange` and `› remove: success, NOT_FOUND treated as success`. `git grep "insert" apps/web/server/watchlist` shows that only `watchlist` and `symbols` are written. Holdings are never written. `app/(app)/watchlist/actions.ts` has `'use server'` and calls only `server/watchlist/handlers.ts` with `getDb()`. |
| 2 | The price board shows, per symbol: last close, change and %, volume, and reference/ceiling/floor computed in core from the configured exchange limits (R5). | `price-board.test.ts` (core) covers every case listed under Tests. `grep -rn "70000\|0\.07\|priceLimitPpm" apps/web` finds no limit values in web code. The loader passes `getMarketRules(db)` into core. The board component test renders TC/Trần/Sàn/Giá/+/-/%/KL from a row. |
| 3 | Colors: up green, down red, reference yellow, ceiling purple, floor cyan. | `watchlist.test.tsx › tones`: a ceiling row has `text-price-ceiling` plus the "Trần" tag and the sr label. A floor row has `text-price-floor` plus "Sàn". TC cells use `text-price-ref`. Up and down use `text-price-up` / `text-price-down`. Every class comes from `TONE_STYLES`, and no new tone map is added. |
| 4 | Each symbol shows its last update time and a DataFreshnessBadge. Stale or gapped symbols are visibly flagged (R4). | `price-board.test.ts › status fresh/stale/missing`, `› gapped when prev is not the previous trading day`, `› ex-date session flagged`. `watchlist.test.tsx › stale row shows "Dữ liệu cũ"`, `› gapped row shows the gap warning text`, `› row shows "Cập nhật …" from fetchedAt and the source`, `› missing row shows "Chưa có dữ liệu" and no zeros`. |
| 5 | Adding a symbol puts it in the EOD price sync set. | The existing `apps/worker/src/jobs/eod-sync.test.ts › syncs watchlist U held…` already proves that the sync set is watchlist ∪ held. A new `apps/worker/src/store.test.ts › listWatchlistSymbols reads listWatchlist` proves the store wiring. `watchlist/handlers.test.ts › add inserts into watchlist` proves that the action writes the table the worker reads. No worker logic changes. |
| 6 | Unit tests for the core reference/ceiling/floor helper. | `pnpm --filter @stoktok/core test` → `market/price-board.test.ts › priceLimits …` and `› tickSize …` (cases listed under Tests). |
| — | Migration is valid (R8 and the `db` area) | `pnpm db:check` passes. It applies the migrations, runs `checks.sql` (new `symbols` assertions), rolls back to 0 tables, then re-applies. |
| — | Checks green (R8) | `pnpm typecheck && pnpm lint && pnpm test` all pass. `apps/web/test/no-calc-in-ui.test.ts` passes unchanged. |

## Files to create / modify
Grouped by slice (see Split proposal). Each slice leaves the repo green on its own.

**Slice 1: db + core**
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261025000100_symbols.sql` | create | Create `public.symbols(symbol text pk check '^[A-Z0-9]{1,20}$', exchange text null check in ('HOSE','HNX','UPCOM'), created_at, updated_at timestamptz not null default now())`. The same file adds a comment on `exchange` ("NULL = unknown; never default to HOSE; mirrors core EXCHANGES"), enables RLS, revokes all from anon/authenticated, and grants select/insert/update/delete to service_role. | Ming's decision (Notes), AC2 |
| `supabase/rollback/20261025000100_symbols.down.sql` | create | `drop table if exists public.symbols;` | db:check rollback step |
| `scripts/db-check/checks.sql` | modify | Add `'symbols'` to `tables_exist` (sorted: `…,'settings','symbols','transactions','watchlist'`). Add a `symbols_columns` block (symbol text NOT NULL, exchange text nullable). In `rejects_bad_rows`, add 3 cases that each expect 23514: `'vnm'`, exchange `'HSX'`, exchange `'hose'`. Add a positive insert of `('VNM', null)` and a service_role insert/select/delete on `symbols`. | db:check fails without the table list change, and the constraints need tests |
| `packages/core/src/market/config.ts` | modify | Add `TickBand { below: number \| null; step: number }` and `DEFAULT_TICK_BANDS: Record<Exchange, readonly TickBand[]>`. Defaults: HOSE `[{below:10000,step:10},{below:50000,step:50},{below:null,step:100}]`, HNX `[{below:null,step:100}]`, UPCOM `[{below:null,step:100}]`. The doc comment says **UNVERIFIED, verify before go-live** and gives the rounding direction. | R5 (the tick table is market config), consult decision |
| `packages/core/src/market/price-board.ts` | create | `tickSize`, `isOnTick`, `priceLimits`, `buildPriceBoardRow`, `splitWatchlistGroups`, plus the types `StoredClose` and `PriceBoardRow` (see Approach) | AC2, AC4, AC6, R1 |
| `packages/core/src/market/price-board.test.ts` | create | Unit tests (see Tests) | AC6, R8 |
| `packages/core/src/entry/validate-watchlist.ts` | create | `parseExchangeInput(raw)` and `validateWatchlistInput({symbol, exchange})` using `normalizeSymbol` and `EXCHANGES` | AC1 validation lives in core |
| `packages/core/src/entry/validate-watchlist.test.ts` | create | Unit tests | R8 |
| `packages/core/src/entry/messages-vi.ts` | modify | Add codes `EXCHANGE_INVALID` ("Chọn sàn HOSE, HNX, UPCoM hoặc để trống.") and `WATCHLIST_DUPLICATE` ("Mã đã có trong danh sách theo dõi.") | AC1 error messages |
| `packages/core/src/index.ts` | modify | Export the new functions, types and `DEFAULT_TICK_BANDS` | wiring |
| `packages/db/src/rows.ts` | modify | Add `SymbolRow { symbol; exchange: string \| null }` and `PriceCloseRow` (= `PriceDailyRow` + `volume: Int8`) | repo typing |
| `packages/db/src/mappers.ts` | modify | Add `symbolExchangeFromRow`, which validates `exchange` against `EXCHANGES`. An invalid non-null value throws `RowMappingError`. Add `storedCloseFromRow` (reuses `priceQuoteFromRow`, plus `toSafeInt(volume)` ≥ 0) | R4, R2 |
| `packages/db/src/repos/symbols.ts` | create | `getSymbolExchanges(db, symbols): Promise<Record<string, Exchange \| null>>` makes one `.in()` query, returns `{}` for empty input, and omits symbols without a row. `setSymbolExchange(db, symbol, exchange: Exchange \| null)` upserts `{symbol, exchange, updated_at}` with `onConflict 'symbol'` and no `.select()` | AC2 |
| `packages/db/src/repos/symbols.test.ts` | create | Fake-client tests | R8 |
| `packages/db/src/repos/prices-daily.ts` | modify | Add `getRecentCloses(db, symbols, n = 2): Promise<Record<string, StoredClose[]>>`. It makes one query per symbol (the `getLatestCloses` pattern): `.eq('symbol').order('trade_date', desc).limit(n)`, returning the rows newest first. `getLatestCloses` is unchanged. | AC2 (reference = previous close), AC4 |
| `packages/db/src/repos/prices-daily.test.ts` | modify | Add tests for `getRecentCloses` | R8 |
| `packages/db/test/fake-client.ts` | modify | Add `'in'` to `METHODS` | needed to test `getSymbolExchanges` |
| `packages/db/src/index.ts` | modify | Export `getSymbolExchanges`, `setSymbolExchange`, `getRecentCloses` | wiring |

**Slice 2: read-only board (web)**
| File | Change | Required because |
|---|---|---|
| `apps/web/server/watchlist/load-watchlist.ts` | create | Loader: reads stored data, calls core, returns view data (see Approach) | AC1–AC4, R1, R3 |
| `apps/web/server/watchlist/load-watchlist.test.ts` | create | Tests modeled on `load-dashboard.test.ts` (mock `../db`) | R8 |
| `apps/web/components/watchlist/price-board.tsx` | create | Server component. The desktop table (`hidden md:table`) and the mobile cards (`md:hidden`) render `PriceBoardRow[]`, with formatting only. It takes optional `rowActions` render props so slice 3 can plug in forms. | AC2–AC4 |
| `apps/web/app/(app)/watchlist/page.tsx` | modify | Replace the placeholder with: load via `loadWatchlist(getDb(), nowInstant())`, then two stacked sections, empty states, and the header note | AC1–AC4 |
| `apps/web/components/watchlist/watchlist.test.tsx` | create | `renderToStaticMarkup` tests (see Tests) | R8 |
| `apps/worker/src/store.test.ts` | create | Mock `@stoktok/db`, then assert that `createDbEodStore(db).listWatchlistSymbols()` returns the symbols from `listWatchlist` | AC5 |

**Slice 3: actions (web)**
| File | Change | Required because |
|---|---|---|
| `apps/web/server/watchlist/handlers.ts` | create | `handleAddWatch(db, fd)`, `handleRemoveWatch(db, symbolRaw)`, `handleSetExchange(db, symbolRaw, fd)`. Each uses `FormState` / `failForm` / `fieldErrors` from `server/transactions/handlers.ts` | AC1, plus the edit-exchange decision |
| `apps/web/server/watchlist/handlers.test.ts` | create | Tests (mock `../db`) | R8 |
| `apps/web/app/(app)/watchlist/actions.ts` | create | `'use server'`: `addWatchAction(prev, fd)`, `removeWatchAction(symbol)`, `setExchangeAction(symbol, prev, fd)`. Each calls its handler with `getDb()`, then `revalidatePath('/watchlist')` on ok, with no redirect. Include the R6-suspended comment. | AC1 |
| `apps/web/components/watchlist/add-symbol-form.tsx` | create | `'use client'` inline form: symbol input plus an exchange select ("Chưa rõ"/HOSE/HNX/UPCoM). Same pattern as `AssetForm` (onSubmit + `startTransition`, `useActionState`) | AC1 |
| `apps/web/components/watchlist/row-forms.tsx` | create | `'use client'` `RemoveWatchButton` and `ExchangeForm` (select + "Lưu") | AC1, edit exchange |
| `apps/web/components/watchlist/watchlist.test.tsx` | modify | Add form render tests | R8 |
| `apps/web/app/(app)/watchlist/page.tsx` | modify | Wire the forms into `PriceBoard` | AC1 |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `price-board.test.ts › tickSize: HOSE 9_990→10, 10_000→50, 49_950→50, 50_000→100; HNX/UPCOM any→100` | tick bands (R5) |
| `price-board.test.ts › tickSize/priceLimits throw RangeError on invalid bands (empty, non-ascending, last.below not null, a band edge that is not a multiple of the next step, step ≤ 0)` | config guard |
| `price-board.test.ts › priceLimits HOSE ±7% round ref: ref 20_000 → ceiling 21_400, floor 18_600` | AC6 |
| `price-board.test.ts › priceLimits HOSE tick rounding: ref 25_400 → raw 27_178/23_622 → ceiling 27_150 (down), floor 23_650 (up)` | AC6, rounding direction |
| `price-board.test.ts › priceLimits HOSE crossing band edge: ref 9_500 → raw ceiling 10_165 → 10_150 (step 50 above 10_000), floor 8_835 → 8_840 (step 10); ref 10_500 → floor raw 9_765 → 9_770 (step 10); ref 53_000 → floor raw 49_290 → 49_300 (step 50)` | AC6, band edges |
| `price-board.test.ts › priceLimits HNX ±10% (ref 15_000 → 16_500/13_500), UPCOM ±15% (ref 12_300 → raw 14_145/10_455 → 14_100/10_500)` | AC6 |
| `price-board.test.ts › priceLimits uses rules input: custom priceLimitPpm HOSE 50_000 changes the result; DEFAULT_MARKET_RULES gives the defaults` | R5 (no hard-coded rate) |
| `price-board.test.ts › priceLimits ppm 0 → ceiling = floor = ref; non-integer, ≤ 0, or off-tick ref throws RangeError` | AC6 edge cases |
| `price-board.test.ts › priceLimits result round-trips through priceTone: price = ceiling → 'ceiling', = floor → 'floor', = ref → 'ref'` | AC3 consistency |
| `price-board.test.ts › buildPriceBoardRow no bars → status 'missing', all values null, tone null` | AC4 |
| `price-board.test.ts › one bar → close/volume/fetchedAt set, ref/change/limits null, flags.noReference` | AC2 (no fabricated reference) |
| `price-board.test.ts › two consecutive bars, HOSE → ref = prev.close, change, changePctPpm (half-up via mulDiv), limits, tone` | AC2 |
| `price-board.test.ts › negative change: changePctPpm rounding half away from zero` | R2 |
| `price-board.test.ts › gapped: prev.tradeDate ≠ previousTradingDay(last, holidays) → flags.gapped, ref/change/limits null; a holiday between bars is NOT a gap` | AC4 |
| `price-board.test.ts › ex-date: last.tradeDate in exDates → flags.exDate, ref/change/limits null, close shown` | ex-date decision |
| `price-board.test.ts › exchange null → change/% set, ceiling/floor null, tone = changeTone, flags.exchangeUnknown` | Ming's "never default to HOSE" |
| `price-board.test.ts › stale status: a ceiling/floor tone is downgraded to changeTone; limits still returned` | AC4 assumption |
| `price-board.test.ts › ref off its tick (e.g. HOSE 10_030) → limits null, flags.refOffTick, no throw` | robustness |
| `price-board.test.ts › splitWatchlistGroups: held ∩ watched only in holdings plus alsoWatched; sorted; empty inputs` | AC1, "show once" |
| `validate-watchlist.test.ts › symbol ' vnm ' → 'VNM'; '' → REQUIRED; 'V!' → SYMBOL_INVALID; exchange '' → null; 'HOSE'/'hnx'/'UPCOM' accepted; 'HSX'/'UPCoM ' with other junk → EXCHANGE_INVALID` | AC1 |
| `symbols.test.ts › getSymbolExchanges: empty input → {} with no query; one .in('symbol', list) call; null exchange kept; invalid stored exchange → mapping error; DB error → DataError` | AC2 |
| `symbols.test.ts › setSymbolExchange: upsert payload {symbol, exchange, updated_at} with onConflict 'symbol'; null exchange writes null; error → DataError` | edit exchange |
| `prices-daily.test.ts › getRecentCloses: per-symbol eq/order desc/limit 2; maps volume; missing source → mapping error; symbol with 0 rows → []; empty input → {}` | AC2, R4 |
| `load-watchlist.test.ts › holdings come from the ledger, not the watchlist table` | AC1 |
| `load-watchlist.test.ts › held+watched symbol shown once in Holdings, listed in alsoWatched` | AC1 |
| `load-watchlist.test.ts › passes getMarketRules + exchanges + ex-dates + holidays into rows (HOSE row has limits, unknown row has none)` | AC2, R5 |
| `load-watchlist.test.ts › ledger error → holdings error, watching rows still returned` | robustness |
| `load-watchlist.test.ts › no symbols → no price queries, empty groups` | edge case |
| `watchlist.test.tsx › tones (ceiling "Trần" plus text-price-ceiling; floor "Sàn" plus text-price-floor; TC text-price-ref; up/down)` | AC3 |
| `watchlist.test.tsx › stale row "Dữ liệu cũ"; gapped row warning; ex-date row warning; missing row "Chưa có dữ liệu" with "—" and no "0"` | AC4 |
| `watchlist.test.tsx › "Cập nhật" time and source shown per row; unknown exchange shows "—" for Trần/Sàn` | AC4, Notes |
| `watchlist.test.tsx › holding-only row has no remove control; watching row and held+watched row have "Bỏ theo dõi {symbol}"` (slice 3) | AC1 |
| `watchlist.test.tsx › empty states render; the add form stays visible when Watching is empty` | UX |
| `handlers.test.ts › add: success calls setSymbolExchange (when exchange given) then addToWatchlist with the normalized symbol` | AC1, AC5 |
| `handlers.test.ts › add with blank exchange does not call setSymbolExchange` | does not wipe a known exchange |
| `handlers.test.ts › add: invalid symbol → fieldErrors.symbol; bad exchange → fieldErrors.exchange; no repo call` | AC1 |
| `handlers.test.ts › add duplicate (DataError CONFLICT) → formError WATCHLIST_DUPLICATE, values kept` | AC1 |
| `handlers.test.ts › remove: success; NOT_FOUND → ok; invalid symbol → no repo call, SYMBOL_INVALID` | AC1 |
| `handlers.test.ts › setExchange: 'HNX' → setSymbolExchange('VNM','HNX'); '' → null (explicit clear); invalid → fieldError` | edit exchange |
| `handlers.test.ts › non-DataError is rethrown` | pattern parity |
| `store.test.ts (worker) › listWatchlistSymbols returns listWatchlist symbols` | AC5 |

## Approach
1. **Migration (db).** Write `20261025000100_symbols.sql` exactly as described in the files table (database-optimizer rec. 1). RLS and grants go in the same file so it cannot be applied half-done. The grants loop in `20261023000200` covers only existing tables, so this file must do its own `enable row level security`, revoke and grant. Add no FKs and no extra index, because the PK covers the lookups. Do not backfill. Update `checks.sql` and add the rollback. Run `pnpm db:check` locally (Postgres 16 is available) and record the output in impl-log.

2. **Core tick config (R5).** Put `DEFAULT_TICK_BANDS` in `market/config.ts`, next to `DEFAULT_PRICE_SANITY`, as a default passed in by callers. The helper never reads a global. Do **not** add it to `MarketRules` or `rule_configs`: that would ripple into the settings parser, the merge, the form and many tests. Making it user-configurable is a follow-up. Do not reuse `DEFAULT_PRICE_SANITY.priceStepVnd`. That field is a feed-sanity guard, not the exchange tick.

3. **Core helpers** (`market/price-board.ts`, pure, integers only, R1/R2):
   - `tickSize(price, bands)` validates the bands. They must be ascending, with the last `below` null, every step a positive safe integer, and every `below` a multiple of both its own step and the next band's step. Invalid bands throw `RangeError`. It returns the step of the first band where `below === null || price < below`.
   - `isOnTick(price, bands)` checks `price % tickSize(price) === 0`.
   - `priceLimits({ ref, exchange, rules: Pick<MarketRules,'priceLimitPpm'>, tickBands })` returns `{ ceiling, floor }`. `ref` must be a positive safe integer and on its tick, or it throws `RangeError`. With `ppm = rules.priceLimitPpm[exchange]` and BigInt math, `rawC = floorDiv(ref·(1e6+ppm), 1e6)` and `rawF = ceilDiv(ref·(1e6−ppm), 1e6)`. Then `ceiling = floor(rawC / tick(rawC)) · tick(rawC)` (rounded **down**) and `floor = ceil(rawF / tick(rawF)) · tick(rawF)` (rounded **up**). The band-edge invariant keeps both results on a valid tick. It asserts `floor ≤ ref ≤ ceiling`. Rounding direction: ceiling down, floor up, documented as UNVERIFIED (data-engineer rec. 3).
   - `StoredClose = PriceQuote & { volume: number }`.
   - `buildPriceBoardRow({ symbol, bars /* newest first, 0..2 */, exchange: Exchange | null, rules, tickBands, expectedDate, holidays, exDates: readonly string[] })` returns a `PriceBoardRow`: `{ symbol, exchange, close, tradeDate, volume, source, fetchedAt, ref, ceiling, floor, change, changePctPpm, tone: PriceTone | null, status: PriceStatus, flags: { noReference, gapped, exDate, exchangeUnknown, refOffTick } }`. The steps, in order:
     - (a) `status = priceStatus(bars[0], expectedDate)`. With no bars, return all nulls.
     - (b) If `bars[0].tradeDate ∈ exDates`, set `exDate` and stop (ref null).
     - (c) If there is no `bars[1]`, set `noReference`.
     - (d) If `bars[1].tradeDate !== previousTradingDay(bars[0].tradeDate, holidays)`, set `gapped` (ref null).
     - (e) Otherwise `ref = bars[1].close`, `change = close − ref`, and `changePctPpm = mulDiv(change, 1_000_000, ref)` (core's half-up rounding). When ref is 0, change and pct are null.
     - (f) If the exchange is null, set `exchangeUnknown`. If ref is not on its tick, set `refOffTick` with limits null. Otherwise call `priceLimits`.
     - (g) `tone = limits ? priceTone(...) : change !== null ? changeTone(change) : null`.
     - (h) If `status === 'stale'` and the tone is ceiling or floor, `tone = changeTone(change)`.
   - The function never throws on mapped repo data.
   - `splitWatchlistGroups(held: string[], watched: string[])` returns `{ holdings: string[]; watching: string[]; alsoWatched: string[] }`, all sorted. A symbol in both lists appears only in `holdings` and in `alsoWatched`.

4. **Core validation.** `validateWatchlistInput` normalizes the symbol with `normalizeSymbol` (empty → REQUIRED, invalid → SYMBOL_INVALID). `parseExchangeInput` trims and uppercases. `''` maps to `null`, a value in `EXCHANGES` maps to the `Exchange`, and anything else is `EXCHANGE_INVALID`. Add the two message codes.

5. **Repos (db).** As listed in the files table. `getRecentCloses` uses option A from database-optimizer rec. 7 (N queries, consistent with the fake client and with `getLatestCloses`). `getSymbolExchanges` uses `.in()` (add `'in'` to the fake). `setSymbolExchange` always overwrites. The handler decides when to call it.

6. **Loader** (`load-watchlist.ts`, R1/R3, with a comment that `requireUser()` goes here when R6 returns):
   - Fetch `listTransactions`, `listCorporateActions`, `getEntrySettings`, `listWatchlist` and `getMarketRules` in parallel.
   - Call `buildLedger(…, vnDateOf(now))` and take the held symbols as quantity > 0, the same as the dashboard. On a ledger error, holdings becomes `{ ok: false, error }` and the Watching group still loads.
   - Call `splitWatchlistGroups`. Take `all` = holdings ∪ watching. If `all` is empty, skip the queries.
   - Call `getSymbolExchanges(db, all)` and `getRecentCloses(db, all, 2)` in parallel.
   - Build exDates per symbol from the corporate actions' `exDate`.
   - Compute `expected = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)`.
   - Rows: `buildPriceBoardRow({ …, rules, tickBands: DEFAULT_TICK_BANDS })`.
   - Return `{ holdings: { ok: true, rows } | { ok: false, error }, watching: rows, alsoWatched, expectedPriceDate }`.
   - The page uses `nowInstant()` from `server/clock.ts`.

7. **UI (format only, R1).** Two stacked sections, "Đang nắm giữ (n)" and "Đang theo dõi (n)", using `.length`.
   - Desktop columns: Mã, Sàn GD, TC, Trần, Sàn, Giá, +/-, %, KL, Cập nhật.
   - Mobile card lines:
     1. symbol and exchange (or exchange form)
     2. close plus `PriceChange`
     3. "TC · Trần · Sàn" strip, each with label and glyph, colored via `TONE_STYLES[...]`
     4. KL and freshness
   - Close text uses `TONE_STYLES[tone].text`. A ceiling or floor row gets `TONE_STYLES[tone].bg`.
   - Null values render "—".
   - Freshness: map `fresh→true, stale→false, missing→null` (duplicate the one-line mapping) into `DataFreshnessBadge`. Always show "Cập nhật {formatDateTime(fetchedAt)} · {source}", plus "giá {formatDate(tradeDate)}" when it differs from `expectedPriceDate`. The comparison is done in the loader as a boolean field, not in the component.
   - Flags render as `text-warn` text with an AlertTriangle:
     - gapped: "Thiếu phiên trước, chưa tính tham chiếu"
     - exDate: "Phiên GDKHQ: tham chiếu chưa xác định"
     - noReference: "Chưa có phiên trước"
     - exchangeUnknown: Trần/Sàn "—" with a muted "Chưa rõ sàn"
     - refOffTick: "Giá tham chiếu lệch bước giá"
   - Header note: "Giá đóng cửa phiên gần nhất, cập nhật sau mỗi lần đồng bộ cuối ngày."
   - Below Holdings: "Tự động theo danh mục".
   - Empty states use `EmptyState`.
   - Do not use `Math.`, `/100` or `new Date(` (no-calc-in-ui).

8. **Actions (slice 3).**
   - **Add** validates the input, calls `setSymbolExchange` **only if** an exchange was chosen, then `addToWatchlist(symbol)`. CONFLICT maps to `WATCHLIST_DUPLICATE`, and the exchange upsert still applies (harmless and idempotent). A held symbol may be added. It then appears once, in Holdings, marked "Đang theo dõi".
   - **Remove** calls `removeFromWatchlist` and swallows NOT_FOUND. It does not delete from `symbols`.
   - **Set exchange** is an explicit choice, including clearing it. It calls `setSymbolExchange` for any displayed row in either group.
   - All three run `revalidatePath('/watchlist')` and do not redirect.
   - A newly added row shows "Chưa có dữ liệu" plus the hint "Giá sẽ có sau lần đồng bộ cuối ngày tiếp theo". The web never fetches TCBS (R3; the worker owns the source).

9. **Rules.**
   - R1: all arithmetic is in core, and the components only format.
   - R2: integers and BigInt, with rounding via `mulDiv`.
   - R3: the DB is reached only through `server/db.ts` `getDb()`.
   - R4: source and fetched_at are shown, stale/missing/gapped are flagged, and the reference is never fabricated.
   - R5: limits come from `getMarketRules` and ticks from the core config default.
   - R6: suspended, so no auth code.
   - R7: only the listed files change.
   - R8: tests are listed above, and `db:check` runs.
   - R10: no brokerage calls.

## Specialist input used
- **database-optimizer**
  - Adopted: the migration shape with RLS and grants in one file (rec. 1), the rollback (rec. 2), the `checks.sql` additions (rec. 3), the repo functions with exchange validation in the mapper (rec. 4), `'in'` in the fake (rec. 5), the add-handler order and the rule that blank never wipes a known exchange (rec. 6), and option A for the last two closes (rec. 7).
  - Rejected: the composite `addWatchedSymbol` in db, because two calls in the handler are enough.
  - Its open questions: the edit-exchange action is in scope (Q2). Re-adding stays CONFLICT, and the separate edit action covers changes (Q3). No backfill (Q4). Both timestamps are kept (Q1).
- **data-engineer**
  - Adopted: the reference is the previous stored close, and a gap or a single row gives a null ref (rec. 1). The ex-date session is flagged and no theoretical reference is computed (rec. 1, minimal option). The tick table is in core config and marked UNVERIFIED, with ceiling rounded down and floor up, using integer math (rec. 3). Change and pct are in ppm via core rounding (rec. 4). No immediate fetch on add (rec. 5). The derived gapped flag is used now and `data_gaps` is left to STK-031 (rec. 6). Volume is mapped as a safe integer (rec. 7). The Holdings ledger error is handled explicitly (rec. 7).
  - Superseded by Ming's decision: `watchlist.exchange`, replaced by the `symbols` table.
  - Rejected for now: reading `data_gaps`, because the table is empty until STK-031 (optional per the consult).
- **data-visualization-engineer**
  - Adopted: two stacked sections instead of tabs, the plain input instead of a combobox, the dual table/card layout, the TC/Trần/Sàn label+glyph cells colored via `TONE_STYLES`, a row tint only at ceiling/floor, no confirm on remove, idempotent remove, held+watched shown once in Holdings, no tooltips, the empty states, the "Chưa có dữ liệu" plus EOD hint, the header wording "Giá đóng cửa phiên gần nhất" instead of "trễ vài phút", and the test list.
  - Adapted: a held+watched row gets a "Đang theo dõi" marker and a "Bỏ theo dõi" button, so a hidden stored row can still be removed. Stale rows keep their values, but a ceiling/floor tone is downgraded.
  - Rejected: a page-level "last refresh" max. The criterion asks for per-symbol time, so this stays out under R7.

## Assumptions
Non-blocking. Ming delegated UI/UX choices, and the caller gave defaults.
1. **Edit exchange is in scope.** It is a small per-row select plus "Lưu" in both groups. Without it, held symbols could never show ceiling/floor. An explicit choice overwrites the stored value, including clearing it. Adding with a blank exchange never wipes a known one.
2. **Ex-date:** the session is flagged as unreliable (ref, change, % and limits shown as "—"). No theoretical adjusted reference is computed, and that is a follow-up.
3. **Tick table** is `DEFAULT_TICK_BANDS` in core `market/config.ts`, marked UNVERIFIED (HOSE 10/50/100 at 10,000/50,000; HNX and UPCoM 100). It is not yet editable in settings.
4. **Held + watched** symbols are shown once, in Holdings, with a "Đang theo dõi" marker and a remove button. Adding a symbol that is already held is accepted.
5. **No immediate price fetch on add.** The row shows "Chưa có dữ liệu" until the next EOD run.
6. **Reference = previous stored close** for the last stored session. This relies on raw prices (UNVERIFIED in ADR 0001). A gap, a single row, or an off-tick ref gives no reference and no limits, never a guess.
7. **Stale rows** keep their last values, labeled with the trade date and "Dữ liệu cũ". A ceiling/floor tone is downgraded to up/down/ref.
8. **"Gapped"** is only the derived flag (prev ≠ previous trading day). It depends on the configured holidays, so a missing holiday gives a false gap, which is the conservative failure. "Not flagged" does not mean "no gaps" until STK-031 feeds `data_gaps`.
9. **Labels:** the exchange column is "Sàn GD", the floor column is "Sàn", and the exchange select options are "Chưa rõ"/HOSE/HNX/UPCoM (values '', HOSE, HNX, UPCOM).
10. `normalizeSymbol` (3–10 chars) is stricter than the DB check (1–20), and that is intended.
11. `group_name` in `watchlist` stays unused, with the DB default 'watching'.

## Blocking questions
None.

## Split proposal
Estimated total: ~1,500 changed lines, including tests. That is over the ~400 guide, although it is a single spec feature (F3). The plan covers the whole ticket, in three slices that each pass `typecheck/lint/test` (and `db:check` for slice 1) on their own:
1. **Slice 1: db + core** (~700 lines, mostly tests). Migration, checks and rollback, tick config, the `price-board.ts` helpers, watchlist validation, messages, and the `symbols` / `getRecentCloses` repos with the fake `in`. Completes AC6 and the core part of AC2.
2. **Slice 2: read-only board** (~500 lines). Loader, `PriceBoard`, page, component tests, and the worker store test. Completes AC2–AC5 for display, with the Holdings group (AC1 part 1).
3. **Slice 3: actions** (~350 lines). Handlers, server actions, add/remove/exchange forms, and their tests. Completes AC1 part 2 and the edit exchange.

Recommended split point if the orchestrator wants smaller cycles: after slice 1 (core + db). Otherwise implement all three in order in one cycle.

Follow-ups (not in this diff, R7):
- Make `tickBands` configurable through `rule_configs` and the settings UI.
- Compute a theoretical ex-date reference from `corporate_actions`, or store the source's reference price.
- OR the open `data_gaps` rows into the gapped flag (STK-031).
- Add a go-live verification item for the tick table, the rounding direction, and raw vs adjusted prices.
- Replace the N-query `getRecentCloses` with a single `.in()` query if the symbol count grows.

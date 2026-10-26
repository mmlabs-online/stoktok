Status: READY

# Plan — STK-015: Medium-term signal rules and job

> **Scope of this plan: slice A of 2** (see `## Split proposal`). Slice A covers the core rules, the rule parameters read from `settings`, the `signals` migration, the repos and the worker job. The Settings-screen section (the "editable in a new signal-rules section" half of AC2) is slice B, a new ticket.

## Spec summary
- docs/spec-v1.md §3 F4, medium-term row: "Medium term (1–6 months) | P/E and P/B vs sector, earnings growth trend, plan completion vs annual target, price vs 50/200-day MA | Daily OHLCV, quarterly financials".
- §3 F4: "Signals are suppressed if the underlying data is stale or has gaps." / "Each signal stores its inputs (snapshot) so it can be audited later."
- §4.4: "Signal computation | After each intraday poll (short term) and after EOD (medium term)".
- §5: "`signals` | id, symbol, rule_id, horizon, value, inputs_snapshot, data_fresh, created_at".
- §6.1: "1. **Rules (code)** produce signals from data. Deterministic, testable. 2. **Suggestion engine (code)** turns signals + portfolio context into an action and quantity."
- §2.2: "Gaps must be detected, not silently interpolated."
- CLAUDE.md R1, R2, R4, R5, R8, R9 ("AI explains rule-based signals; it never decides the action"), R10.
- docs/adr/0002 §UNVERIFIED: "**STK-015 must read the recorded EPS basis once it is verified and must not assume one.**"
- Ticket notes (Ming, 2026-10-26): MA rules "suppress with `insufficient_history` until 200 closes exist"; "minimum **5** peers in the same sector … fewer → suppress with `peers_insufficient` (configurable, R5)".

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Rules in `packages/core`: P/E and P/B vs sector, earnings growth trend, price vs 50/200-day MA. Each is a pure function with unit tests, including edge cases (missing quarters, negative EPS). | `packages/core/src/signals/{valuation,growth,moving-average}.ts` export `peVsSector`, `pbVsSector`, `earningsGrowthTrend`, `priceVsMa`. They take no clock and do no I/O (signalDate is an input). Run `pnpm --filter @stoktok/core test`; the tests listed below under valuation/growth/moving-average pass, including "missing middle quarter → financials_gap", "TTM EPS ≤ 0 → eps_non_positive", and "negative base → loss/turnaround, no %". |
| 2 | Rule parameters are configurable in `settings` (R5) *(this slice)*. They are editable in a new signal-rules section of the Settings screen *(slice B)*. | This slice: `parseSignalRules` reads `settings.rule_configs.signals.medium`, and each key falls back to its own default (`signals/config.test.ts`). `getSignalRules(db)` feeds the job (`settings.test.ts`, `medium-signals.test.ts › uses rules from store`). No rule threshold is a literal in the rule files: grep for `200000`, `20000`, `50`, `200` in `signals/*.ts` other than `config.ts`. The Settings UI is verified in slice B. |
| 3 | No signal is produced when price or financials data is stale or has gaps, and the suppression reason is recorded (R4). | Core tests listed below: each stale/gap case returns `status:'suppressed'`, `value:null`, `label:null`, the reason code, and `dataFresh:false`. Job test `writes suppressed rows with reason_codes`. db:check `rejects_bad_rows`: a suppressed row with a value fails, and an ok row with `data_fresh=false` fails. |
| 4 | Migration adds `signals` (symbol, rule_id, horizon, value, inputs_snapshot, data_fresh, created_at) with RLS on and server-only access. | `supabase/migrations/20261026000200_signals.sql`. `pnpm db:check` is green: `tables_exist` includes `signals`, plus the RLS, no-policies, no-grants, anon/authenticated-denied loops, `signals_columns`, `service_role_can_read_write_signals` and the new `rejects_bad_rows` cases. The rollback drops it (db:check expects 0 tables after rollback). The extra columns are justified under Specialist input. |
| 5 | Worker job runs after the EOD sync, is idempotent per symbol and day, and stores the inputs snapshot for audit. | `pnpm worker:signals [--dry-run]`. The README schedule places it after `eod-prices` and `financials`. Job tests: `two runs give identical rows`, `upsert onConflict 'symbol,rule_id,horizon,signal_date'`, `weekend re-run uses Friday's signal_date`, `dry-run writes nothing`. Repo test `upsertSignals dedupes, chunks, onConflict`. The snapshot contains every ref and the params (`evaluate.test.ts › snapshot lists refs with source and fetchedAt, and params`). |
| 6 | "Plan completion vs annual target" is out of scope unless the data source provides it (listed as a follow-up). | ADR 0002 lists the stored fields (EPS, BVPS, revenue, net income, sector), and none of them is a plan or target. No rule is implemented for it. The impl-log Follow-ups list contains it. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/signals/types.ts` | new: `SignalResult`, `SignalStatus`, `SignalLabel`, `ReasonCode` union, `REASON_ORDER`, `DATA_REASONS`, `EpsBasis`, input types (`StoredFinancials`, `SectorInfo`, `GapRef`), `RULE_IDS`, `RULE_VERSION` | AC1, AC3: one shared shape |
| `packages/core/src/signals/config.ts` | new: `SignalRules`, `DEFAULT_SIGNAL_RULES`, `SIGNAL_RULE_BOUNDS`, `parseSignalRules` | AC2, R5 (slice B reuses the bounds) |
| `packages/core/src/signals/inputs.ts` | new: `resolveSignalDate`, `vnDayBounds`, `gapOverlaps`, `checkLatestPrice`, `checkPriceWindow`, `requiredQuarters`, `checkFinancials`, `ttmEps`, `medianInt`, `safeRatioPpm`, `finalizeResult` | AC3: freshness/gap checks defined once |
| `packages/core/src/signals/valuation.ts` | new: `peVsSector`, `pbVsSector` (one shared `valuationVsSector`) | AC1 |
| `packages/core/src/signals/growth.ts` | new: `earningsGrowthTrend` | AC1 |
| `packages/core/src/signals/moving-average.ts` | new: `priceVsMa` | AC1 |
| `packages/core/src/signals/evaluate.ts` | new: `evaluateMediumSignals` (whole universe → `SignalResult[]`, builds peer sets) | AC1, AC5: pure orchestration of the rules, keeps the job thin |
| `packages/core/src/signals/*.test.ts` | new: `config`, `inputs`, `valuation`, `growth`, `moving-average`, `evaluate` | R8 |
| `packages/core/src/market/config.ts` | add `DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS = 45` | R5: one value shared by the financials sync and the signal freshness check |
| `packages/core/src/index.ts` | export the signals API and the new constant | consumed by db and worker |
| `supabase/migrations/20261026000200_signals.sql` | new table, constraints, comments, RLS, revoke, grants (table and sequence) | AC4 |
| `supabase/rollback/20261026000200_signals.down.sql` | `drop table if exists public.signals;` | db:check applies the rollbacks |
| `scripts/db-check/checks.sql` | `tables_exist` array, `signals_columns`, `service_role_can_read_write_signals`, `rejects_bad_rows` cases | db:check must stay green and cover the new table |
| `packages/db/src/rows.ts` | add `SignalInsert`, `SymbolSectorRow` | repo payload types |
| `packages/db/src/mappers.ts` | add `symbolSectorFromRow` | R4: sector must carry provenance |
| `packages/db/src/repos/signals.ts` | new: `upsertSignals` | AC4/AC5 |
| `packages/db/src/repos/signals.test.ts` | new | R8 |
| `packages/db/src/repos/symbols.ts` (+ `.test.ts`) | add `listSymbolSectors(db, symbols)` | peer sets need sector + provenance in one query |
| `packages/db/src/repos/data-gaps.ts` (+ `.test.ts`) | add `listOpenMarketGaps(db, dataType)` (`.is('symbol', null)`) | AC3: market-wide gaps must suppress too; `listOpenGaps` filters `in('symbol')` and misses them |
| `packages/db/src/repos/settings.ts` (+ `.test.ts`) | add `getSignalRules(db)` (mirrors `getMarketRules`) | AC2 |
| `packages/db/src/index.ts` | export the new functions and types | worker wiring |
| `apps/worker/src/jobs/medium-signals.ts` | new: `runMediumSignals`, `SignalsStore`, `PRICES_GAP_TYPE = 'prices_daily'` | AC5 |
| `apps/worker/src/jobs/medium-signals.test.ts` | new | R8 |
| `apps/worker/src/store.ts` (+ `store.test.ts`) | add `createDbSignalsStore` (financials read chunked by symbols) | wiring through @stoktok/db only; avoids the PostgREST 1000-row cap |
| `apps/worker/src/cli.ts` (+ `cli.test.ts`) | add job `signals` | runnable job |
| `apps/worker/src/config.ts` | `publishLagDays: DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS`; add `SIGNALS_JOB_CONFIG { upsertChunkSize: 500, financialsSymbolChunk: 50 }` | R5, one source for the lag |
| `apps/worker/src/sources/tcbs-financials.ts` | add `TCBS_FINANCIALS_SOURCE_NAME = 'tcbs-public'` (the class `name` uses it) and `TCBS_FINANCIALS_EPS_BASIS: EpsBasis = 'unverified'` next to `TCBS_FINANCIALS_UNITS` | the EPS basis is a property of the source (ADR 0002) |
| `apps/worker/README.md` | new "Medium-term signals (`signals`)" section: command, schedule after EOD + financials, the EPS-basis flip, output | AC5 "runs after the EOD sync" |
| `package.json` (root) | add `"worker:signals": "pnpm --filter @stoktok/worker run job signals"` | matches the existing job scripts |

No web files change in this slice.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `signals/config.test.ts › null/{} → DEFAULT_SIGNAL_RULES` | AC2 defaults (minPeers 5) |
| `signals/config.test.ts › each invalid key falls back on its own (string, float, below/above bound)` | R5 parsing |
| `signals/config.test.ts › minConsecutive > comparisons → both default; shortDays ≥ longDays → both default` | cross-field |
| `signals/config.test.ts › other rule_configs keys (market) ignored` | namespace isolation |
| `signals/inputs.test.ts › resolveSignalDate: data date = expected → that date; data older than expected → expected; data newer → data date; no closes → expected` | signal_date rule |
| `signals/inputs.test.ts › resolveSignalDate: Saturday and Sunday re-runs (expectedPriceDate) → Friday` | idempotency key |
| `signals/inputs.test.ts › checkLatestPrice: none → price_missing; older → price_stale; equal → ok` | AC3 |
| `signals/inputs.test.ts › checkPriceWindow: N bars on N expected days → ok; N−1 stored → insufficient_history; N stored but a weekday missing → price_gap with missingDates; configured holiday in window → no gap; unconfigured holiday → price_gap` | AC3, Ming's insufficient_history |
| `signals/inputs.test.ts › open gap (symbol) overlapping window → price_gap_recorded; market-wide gap (symbol null) → price_gap_recorded; gap outside window → ok; resolved gaps never passed` | AC3, market-wide gaps |
| `signals/inputs.test.ts › checkFinancials: no rows → financials_missing; latest < latestExpectedPeriod → financials_stale; missing middle quarter → financials_gap; only 3 of 4 → financials_gap; open financials gap on a present quarter → financials_gap_recorded; market-wide financials gap → financials_gap_recorded; fetchedAt older than max age → financials_fetch_stale` | AC1 missing quarters, AC3 |
| `signals/inputs.test.ts › ttmEps: same rows give quarterly = sum of 4, ttm = latest, unverified = null; mixed/unknown source → unverified` | EPS basis |
| `signals/inputs.test.ts › medianInt odd, even (roundDiv half-up), negative-free; safeRatioPpm overflow → null` | R2 |
| `signals/valuation.test.ts › epsBasis unverified → suppressed eps_basis_unverified, dataFresh true when data is fresh` | default today |
| `signals/valuation.test.ts › (basis quarterly) premium ≤ −discount → bullish; ≥ premium → bearish; between → neutral; boundaries inclusive` | AC1 labels |
| `signals/valuation.test.ts › TTM EPS exactly 0 → eps_non_positive; negative TTM with one positive quarter → eps_non_positive; BVPS ≤ 0 → bvps_non_positive` | AC1 negative EPS |
| `signals/valuation.test.ts › exactly minPeers valid peers → ok; minPeers−1 → peers_insufficient with peerCount and excluded list` | Ming's min 5 |
| `signals/valuation.test.ts › stale peer, loss-making peer, peer without basis excluded with reasons; subject excluded from its own median; all peers loss-making → peers_insufficient` | peer rules |
| `signals/valuation.test.ts › sector null → sector_missing; different sector label → not a peer` | peers |
| `signals/valuation.test.ts › stale price and stale financials both reported in REASON_ORDER` | all reasons recorded |
| `signals/valuation.test.ts › P/B uses latest quarter bvps and does not depend on EPS basis` | P/B |
| `signals/growth.test.ts › base>0: g ≥ threshold up, ≤ −threshold down, else flat (inclusive)` | AC1 |
| `signals/growth.test.ts › base>0 → current ≤0 = to_loss (down); base ≤0 → current>0 = turnaround (up, no %); both ≤0 = loss (down)` | AC1 negative earnings |
| `signals/growth.test.ts › tiny positive base below minBasePpmOfRevenue treated as non-positive` | outliers |
| `signals/growth.test.ts › last minConsecutive up → bullish, value +streak; down → bearish, value −streak; flat breaks streak → neutral, value 0` | labels/value |
| `signals/growth.test.ts › fewer than comparisons+4 quarters → financials_gap; missing latest → financials_stale` | AC1 missing quarters |
| `signals/moving-average.test.ts › close exactly at ma ± band → bullish/bearish (inclusive); inside → neutral` | AC1 |
| `signals/moving-average.test.ts › 20 stored bars, N=200 → insufficient_history, dataFresh false` | Ming's note |
| `signals/moving-average.test.ts › latest bar yesterday → price_stale; ma = roundDiv(sum,N); value integer` | AC3, R2 |
| `signals/evaluate.test.ts › emits one result per (symbol, enabled rule): pe, pb, growth, ma_50, ma_200; disabled rule → no result` | AC5 |
| `signals/evaluate.test.ts › deterministic: two calls deep-equal; every value Number.isSafeInteger or null` | AC5, R2 |
| `signals/evaluate.test.ts › snapshot lists refs (prices_daily:SYM:date, financials:SYM:YYYYQn, symbols:SYM:sector, data_gaps:id) each with source and fetchedAt, plus params and epsBasis` | AC5, R4, R9 |
| `signals/evaluate.test.ts › dataFresh false iff a DATA_REASONS code is present; ok ⇒ reasons [] and label + value set` | AC3 invariant (matches the DB check) |
| `db/repos/signals.test.ts › upsertSignals dedupes (later wins), 3 chunks for 5 rows at chunkSize 2, onConflict string, no select; empty → no call; 23514 → VALIDATION` | AC4/5 |
| `db/repos/symbols.test.ts › listSymbolSectors in(symbols), maps provenance; sector without source → MAPPING; empty → no call` | peers |
| `db/repos/data-gaps.test.ts › listOpenMarketGaps eq data_type, is symbol null, is resolved_at null` | market-wide gaps |
| `db/repos/settings.test.ts › getSignalRules: no row → defaults; stored signals namespace parsed` | AC2 |
| `worker/jobs/medium-signals.test.ts › universe = watchlist ∪ held, normalized; ledger error → ok false` | job |
| `worker/jobs/medium-signals.test.ts › uses rules from store (minPeers changed → result changes)` | AC2 |
| `worker/jobs/medium-signals.test.ts › writes suppressed rows with reason_codes, status, data_fresh; ok rows with label/value; computed_at = now` | AC3, AC5 |
| `worker/jobs/medium-signals.test.ts › two runs give identical rows (except computed_at); weekend re-run uses Friday's signal_date; EOD missing today → signal_date today, price rules price_stale` | AC5 idempotency |
| `worker/jobs/medium-signals.test.ts › reads prices_daily and financials gaps for symbols and market-wide` | AC3 |
| `worker/jobs/medium-signals.test.ts › dry-run writes nothing; summary counts suppressedByReason` | job |
| `worker/store.test.ts › createDbSignalsStore chunks listFinancials by financialsSymbolChunk` | 1000-row cap |
| `worker/cli.test.ts › signals / signals --dry-run parse` | CLI |
| `db:check › signals_columns, service_role_can_read_write_signals, rejects_bad_rows (signals cases)` | AC4 |

## Approach
Rules applied: R1 (all math in core, no UI in this slice), R2 (ppm integers via `mulDiv`/`roundDiv`, BigInt), R3 (worker uses the service client only), R4 (refs carry source + fetched_at; gaps never produce signals), R5 (params in settings, publish lag and cutoff are core constants), R7, R8, R9/R10 (label is a direction, never an action). R6 is suspended, so no auth code.

1. **Core types (`signals/types.ts`).**
   - `SignalResult = { symbol, ruleId, ruleVersion: 1, horizon: 'medium', signalDate, status: 'ok'|'suppressed', label: 'bullish'|'bearish'|'neutral'|null, value: number|null, dataFresh: boolean, reasons: ReasonCode[], inputs: Record<string, unknown> }`.
   - `RULE_IDS`: `pe_vs_sector`, `pb_vs_sector`, `earnings_growth_trend`, and `price_vs_ma_${n}` for the configured short and long periods (defaults → `price_vs_ma_50`, `price_vs_ma_200`).
   - `ReasonCode` and the fixed `REASON_ORDER`:
     - **Data** reasons (`DATA_REASONS`, these set `dataFresh=false`): `price_missing`, `price_stale`, `insufficient_history`, `price_gap`, `price_gap_recorded`, `financials_missing`, `financials_stale`, `financials_gap`, `financials_gap_recorded`, `financials_fetch_stale`, `sector_missing`.
     - **Rule** reasons (`dataFresh` stays true): `eps_basis_unverified`, `eps_non_positive`, `bvps_non_positive`, `peers_insufficient`, `value_out_of_range`.
   - Every rule runs all data checks, then the rule checks, and reports **all** reasons found, sorted by `REASON_ORDER`.
   - `finalizeResult`: any reason → `suppressed`, label/value null. Otherwise `ok` with label and value.
2. **Config (`signals/config.ts`).**
   - Defaults:
     ```
     signals.medium = {
       peVsSector:     { enabled: true, minPeers: 5, discountPpm: 200000, premiumPpm: 200000 },
       pbVsSector:     { same },
       earningsGrowth: { enabled: true, comparisons: 4, minConsecutive: 2, growthThresholdPpm: 100000, minBasePpmOfRevenue: 10000 },
       priceVsMa:      { enabled: true, shortDays: 50, longDays: 200, neutralBandPpm: 20000 },
       freshness:      { financialsMaxFetchAgeDays: 7 }
     }
     ```
   - `SIGNAL_RULE_BOUNDS`:
     - minPeers 3–50
     - discount/premium/growthThreshold/minBase 0–1,000,000
     - comparisons 1–8, minConsecutive 1–comparisons
     - MA days 5–250 with short < long
     - neutralBand 0–200,000
     - maxFetchAgeDays 1–90
   - `parseSignalRules` mirrors `parseMarketRules`: each invalid key falls back to its own default. A cross-field violation resets both fields of the pair.
3. **Shared checks (`signals/inputs.ts`).**
   - **signal_date (data-derived).** `resolveSignalDate(expectedDate, latestTradeDates)` returns `max(newest stored trade_date in the universe, expectedDate)`.
     - The worker computes `expectedDate = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN)`. That is the existing R4 reference, and it is calendar-stable: a weekend or after-midnight re-run gives the previous trading day.
     - Core itself never reads the clock.
     - The floor is there so that a failed EOD sync can't re-stamp Friday's data as Monday's and overwrite Friday's `ok` rows. Instead Monday gets new rows with `price_stale`.
   - **Price checks.**
     - `checkLatestPrice`: the latest bar must equal signalDate.
     - `checkPriceWindow(N)`:
       - fewer than N bars on or before signalDate → `insufficient_history` (no list of missing dates);
       - otherwise the expected dates `subtractTradingDays(signalDate, N-1, holidays)..signalDate` must all be present → else `price_gap`, with `missingDates` (first 20) in the snapshot.
   - **Recorded gaps.** Open gaps (`symbol = S` or `symbol IS NULL`) whose `[fromTs,toTs]` overlaps the VN-day bounds of the window → `price_gap_recorded` (data_type `prices_daily`; this is active once STK-031 writes them). The financials equivalent uses `quarterBounds` → `financials_gap_recorded`.
   - **Financials window.** `latestPeriod = latestExpectedPeriod(signalDate, DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS)`. `requiredQuarters` per rule:
     - PE: 4 quarters (quarterly/unverified basis) or 1 (ttm);
     - PB: 1;
     - growth: `comparisons + 4`.
   - **`checkFinancials`:**
     - no rows in range → `financials_missing`;
     - newest stored < latestPeriod → `financials_stale`;
     - another required quarter absent → `financials_gap`;
     - a recorded gap overlaps → `financials_gap_recorded`;
     - the VN date of any required row's `fetchedAt` is older than signalDate minus `financialsMaxFetchAgeDays` calendar days → `financials_fetch_stale`.
   - **`ttmEps(rows, basis)`:** quarterly → sum of 4; ttm → latest; unverified → null. The basis is the source's declared basis; if the rows mix sources or a source is unknown, it is `unverified`.
   - **Integer helpers.** `medianInt` (even count → `roundDiv(a+b, 2)`). `safeRatioPpm(a, b)` catches the `RangeError` from `mulDiv` → null → `value_out_of_range`.
4. **Valuation (`signals/valuation.ts`).**
   - **Subject P/E.** `pePpm = mulDiv(close, PPM, ttmEps)`, only if TTM EPS > 0 (else `eps_non_positive`).
   - **Subject P/B.** `pbPpm = mulDiv(close, PPM, bvps)` on the latest quarter, only if BVPS > 0 (else `bvps_non_positive`).
   - **Peers.** Peers are the other universe symbols with exactly the same `symbols.sector`, each passing the same price/financials/basis/sign checks.
     - Peers that fail go to the snapshot `excluded: [{symbol, reasons}]`.
     - Fewer than `minPeers` valid peers → `peers_insufficient`, with `peerCount` in the snapshot.
   - **Value.** `value = premiumPpm = (ratio − median) × PPM / median`.
   - **Label.** `≤ −discountPpm` → bullish, `≥ premiumPpm` → bearish, else neutral. The snapshot `classification` is `cheap`/`expensive`/`in_line`.
   - **Today's state.** While `TCBS_FINANCIALS_EPS_BASIS = 'unverified'`, every `pe_vs_sector` row is `suppressed` with `eps_basis_unverified` (plus `peers_insufficient`, because the peers also lack a basis).
5. **Growth (`signals/growth.ts`).**
   - Uses quarterly `net_income`, compared year-on-year for each of the last `comparisons` quarters.
   - Classification follows the finance consult: up, down, flat, turnaround (up), to_loss (down), loss (down). A base below `minBasePpmOfRevenue` of that quarter's revenue, or a base ≤ 0, gives a direction only, with no %.
   - **Value.** `value` = signed streak (+k = the k most recent quarters up, −k = down, 0 = latest flat). It is always defined, so an `ok` row always has a value. The per-quarter `growthPpm` (or null) and class are in the snapshot.
   - **Label.** The last `minConsecutive` all up → bullish; all down → bearish; else neutral.
6. **MA (`signals/moving-average.ts`).**
   - `ma = roundDiv(Σclose, N)`; `value = mulDiv(close − ma, PPM, ma)`.
   - Label: `≥ band` → bullish, `≤ −band` → bearish, else neutral.
   - **Snapshot.** The window object `{table:'prices_daily', symbol, fromDate, toDate, count, closes:[…], sources:[…], minFetchedAt, maxFetchedAt}` and `ma`.
7. **`evaluateMediumSignals(input)`.**
   - Input: `{ signalDate, holidays, rules, publishLagDays, symbols, closes: Record<sym, StoredClose[]>, financials: StoredFinancials[], sectors: Record<sym, SectorInfo>, priceGaps: GapRef[], financialsGaps: GapRef[], epsBasisBySource: Record<string, EpsBasis> }`.
   - It computes each symbol's peer candidates once per sector, then returns the results sorted by (symbol, ruleId).
   - The snapshot always includes `params` (the rule's parsed params) and `epsBasis` where relevant, so later settings changes don't break the audit.
8. **Migration `20261026000200_signals.sql`.**
   ```
   id bigint generated always as identity primary key,
   symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
   rule_id text not null check (rule_id ~ '^[a-z0-9_]{1,60}$'),
   horizon text not null check (horizon = 'medium'),
   signal_date date not null,
   status text not null check (status in ('ok','suppressed')),
   label text check (label in ('bullish','bearish','neutral')),
   value bigint,
   data_fresh boolean not null,
   reason_codes text[] not null default '{}',
   inputs_snapshot jsonb not null,
   rule_version smallint not null check (rule_version >= 1),
   computed_at timestamptz not null,
   created_at timestamptz not null default now(),
   unique (symbol, rule_id, horizon, signal_date),
   check ((status = 'ok' and label is not null and value is not null and cardinality(reason_codes) = 0)
       or (status = 'suppressed' and label is null and value is null and cardinality(reason_codes) > 0)),
   check (data_fresh or status = 'suppressed'),
   check (cardinality(reason_codes) <= 20 and array_position(reason_codes, null) is null
          and (cardinality(reason_codes) = 0 or array_to_string(reason_codes, ',') ~ '^[a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*$')),
   check (jsonb_typeof(inputs_snapshot) = 'object' and pg_column_size(inputs_snapshot) <= 32768)
   ```
   - Add `comment on column` for `value` with the unit per rule_id (ppm premium; ppm vs MA; signed quarter streak), for `label` ("direction of a rule, never an action (R9/R10)"), and for `signal_date` ("data date, see plan").
   - Then:
     ```
     enable row level security
     revoke all on table and on sequence signals_id_seq from anon, authenticated
     grant select, insert, update, delete on table to service_role
     grant usage, select on sequence signals_id_seq to service_role
     ```
   - No index beyond PK/unique (there is no reader yet).
9. **checks.sql.**
   - `tables_exist`: insert `'signals'` between `'settings'` and `'symbols'`.
   - `signals_columns`: `value bigint`, `signal_date date NN`, `data_fresh boolean NN`, `inputs_snapshot jsonb NN`, `reason_codes ARRAY NN`, `computed_at timestamptz NN`, `status text NN`.
   - `service_role_can_read_write_signals`: insert an ok row as `service_role`, select it, upsert the same key with `on conflict (symbol,rule_id,horizon,signal_date) do update`, and assert that `id` is unchanged and the count is 1.
   - `rejects_bad_rows`, each expecting 23514 unless noted:
     - lowercase symbol
     - bad rule_id
     - horizon `long`
     - label `buy`
     - ok with null value
     - ok with reasons
     - suppressed with value
     - suppressed without reasons
     - `data_fresh=false` with status ok
     - reason `Bad Code`
     - snapshot as an array
     - null snapshot (23502)
     - null data_fresh (23502)
     - duplicate key (23505)
10. **db repos.**
    - `upsertSignals(db, rows, {chunkSize=500})`: copy of `upsertFinancials`, key `symbol|rule_id|horizon|signal_date`, `onConflict: 'symbol,rule_id,horizon,signal_date'`. The payload omits `id` and `created_at`.
    - `listSymbolSectors(db, symbols)`: `select('symbol,sector,sector_source,sector_fetched_at').in(...)`.
    - `listOpenMarketGaps(db, dataType)`: `.eq('data_type').is('symbol', null).is('resolved_at', null)`.
    - `getSignalRules(db)`: like `getMarketRules`.
    - Use only fake-client methods (no `lt`/`gt`/`not`/`or`).
11. **Worker job `runMediumSignals(deps)`.**
    - **Deps:** `{store, now, config, log, dryRun, epsBasisBySource}`.
    - **Steps:**
      1. holidays + rules from the store;
      2. universe = watchlist ∪ held (normalize, sort, ledger error → ok=false, as the other jobs do);
      3. expectedDate → `getRecentCloses(symbols, rules.priceVsMa.longDays)` → `resolveSignalDate`;
      4. `fromPeriod = addQuarters(latestPeriod, −(max(4, comparisons+4) − 1))`;
      5. read financials (store chunks by 50 symbols), sectors, and open gaps (`prices_daily` and `financials`, per symbol + market-wide);
      6. `evaluateMediumSignals`;
      7. map to `SignalInsert`, with `computed_at = now.toISOString()` and `inputs_snapshot = result.inputs`;
      8. upsert unless dry-run.
    - **Summary:** `{ok, dryRun, signalDate, expectedDate, symbols, results, okCount, suppressedCount, suppressedByReason, rowsUpserted, ledgerError?}`. Suppressed rows don't make the run fail.
    - **Purity:** the job doesn't read signals back. All math is in core.
12. **CLI, config, source constant, README, root script.**
    - Job name `signals`. The CLI passes `epsBasisBySource = { [TCBS_FINANCIALS_SOURCE_NAME]: TCBS_FINANCIALS_EPS_BASIS }`.
    - **README schedule:**
      ```
      TZ=Asia/Ho_Chi_Minh
      55 18 * * 1-5 cd <repo> && pnpm worker:signals
      15 21 * * 1-5 cd <repo> && pnpm worker:signals   # after the 21:00 EOD catch-up
      ```
      A re-run on the same data date overwrites the same rows (idempotent).
    - **README note:** flip `TCBS_FINANCIALS_EPS_BASIS` after the financials dry-run confirms the basis, and update ADR 0002.
13. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm db:check`.

## Specialist input used
- **Signals column set: the finance shape is adopted, with DB-consult constraints.** Columns: `status` + `reason_codes text[]` (finance) instead of a single `suppressed_reason` (DB), because the finance consult's "report every reason" makes the audit complete (stale price *and* stale financials both visible) and the DB format check still applies element-wise. `signal_date` name and a data-derived meaning (DB) instead of `as_of_date`. `label` restricted to `bullish/bearish/neutral` (DB, and the orchestrator's R9/R10 direction), replacing finance's per-rule `cheap/expensive/above/…` labels; those go into the snapshot as `classification`. Deviations from the ticket/spec column list (`signal_date`, `status`, `label`, `reason_codes`, `rule_version`, `computed_at`) are needed for daily idempotency (a `created_at` timestamptz can't key a day), auditable suppression (AC3) and the R1 rule that the UI must not derive the label. The spec's `id` is kept (identity PK, stable across upserts) so later suggestions can cite signal IDs (R9). The natural key is a unique constraint.
- **Rejected:** DB `source` column. R4 targets market-data records; a signal's provenance is `rule_id` + `rule_version` + `computed_at`, and the inputs' source/fetched_at are in the snapshot. Also rejected: `updated_at` (finance); `computed_at` covers it, and `created_at` survives upserts.
- **Not applicable status (finance):** merged into `suppressed`. Ming's notes use "suppress" for `peers_insufficient`, and `data_fresh=true` tells the rule-level reasons apart from data reasons.
- **Adopted (finance):**
  - net income, not EPS, for growth (EPS-basis-independent and immune to stock-dividend share jumps);
  - EPS basis declared next to the source units, suppressing with `eps_basis_unverified`;
  - TTM handling for all three bases (tested so the flip is one line);
  - peer rules (subject excluded, invalid peers excluded and listed);
  - growth classification table;
  - ppm integer math;
  - params in the snapshot;
  - the default parameter values;
  - moving `publishLagDays` to one core constant.
- **Adopted (DB):**
  - the PostgREST 1000-row cap: per-symbol closes, chunked financials;
  - the market-wide gap hole: new `listOpenMarketGaps`;
  - the `listSymbolSectors` batched read;
  - the db:check additions;
  - the fake-client-only query methods;
  - the overflow guard (`value_out_of_range`);
  - the snapshot size check;
  - the rollback file.
- **Deferred to follow-ups (R7, not in the AC):**
  - finance's raw-price guards (`corporate_action_in_window`, `price_jump_beyond_limit`), the MA trend field and the limit-hit session count. They are inert while MA rules return `insufficient_history`; see Assumptions A6;
  - the peer universe setting;
  - `pe_vs_own_history`;
  - scorecard scoring on label changes;
  - immutability of cited rows;
  - a `signals_date_idx` and a list reader (no consumer yet).
- **The two consults agree on:** suppressed rows are stored, the params are snapshotted, and the label is stored rather than derived in the UI.

## Assumptions
- **A1 — EPS basis.** The constant `TCBS_FINANCIALS_EPS_BASIS = 'unverified'` sits next to `TCBS_FINANCIALS_UNITS`, with no DB column. `pe_vs_sector` is suppressed with `eps_basis_unverified` (`data_fresh` reflects the real data) until the financials dry-run verifies the basis. We never proceed on an assumed basis, because ADR 0002 says "must not assume one". A wrong guess skews P/E about 4×. A source swap must declare its own basis; an unknown source → `unverified`.
- **A2 — Gaps.** Price gaps are self-detected from the calendar (`subtractTradingDays` plus `settings.holidays`). Open `data_gaps` are also read for `prices_daily` (STK-031's announced type; the constant `PRICES_GAP_TYPE` lives in the job and STK-031 should reuse it) and for `financials`, both per-symbol and market-wide (`symbol IS NULL`). An incomplete holiday list over the ~10-month MA200 window yields `price_gap` (fail-safe, noisy).
- **A3 — Growth uses quarterly net income** (`shareHolderIncome`, `yearly=0`). The rule is named `earnings_growth_trend`. EPS growth can follow after the basis is verified.
- **A4 — Label is a direction** (`bullish`/`bearish`/`neutral`), never buy/sell. The DB check rejects anything else (R9/R10).
- **A5 — signal_date** = max(newest stored trade_date in the universe, `expectedPriceDate`). It is data-derived, and the calendar floor (not wall-clock time) prevents a failed sync from overwriting earlier `ok` rows. Core is pure: the worker passes `expectedDate`.
- **A6 — Raw prices (ADR 0001).** Corporate-action and limit-jump guards are not in this slice. They must land with or before STK-032 (backfill), which is when MA rules start producing `ok` rows. Recorded as a follow-up for the orchestrator to attach to STK-032.
- **A7 — Peers** come from the job universe (watchlist ∪ held), with exact `symbols.sector` equality (labels are already normalized on write). `minPeers` counts other valid symbols, excluding the subject. Default 5, bounds 3–50.
- **A8 — "Runs after the EOD sync"** is met by the documented cron order (the same convention as the financials job, which has no scheduler code) plus the data-derived signal_date. No chaining inside `eod-prices`.
- **A9 — Disabled rule** → no row written for that rule (not a suppression).
- **A10 — The growth `value`** is the signed streak (quarters), so `ok` rows always have a value. The YoY ppm per quarter is in the snapshot.
- **A11 — No signal reader / UI** in this slice. STK-016 (symbol detail) reads signals and filters `status = 'ok'`.

## Blocking questions
None.

## Split proposal
The full ticket is roughly 2,000 changed lines across core, migration, db, worker and web. It is too big for one cycle as written. Two slices:

- **Slice A — this plan (STK-015):** core rules + `parseSignalRules` (settings-backed, R5) + `signals` migration/db:check + repos + worker `signals` job.
  - Covers AC1, AC3, AC4, AC5, AC6, and AC2's "configurable in `settings`" half.
  - Estimate: about 1,700 lines, most of them tests. That is large but one coherent pipeline, comparable to STK-014.
  - **Fallback split point, if the orchestrator wants it smaller:** cut after step 7 (core only: AC1, AC3 logic, AC2 parsing) and move steps 8–12 (migration, repos, job: AC4, AC5) to their own ticket. The core API (`evaluateMediumSignals`, `SignalResult`) is the stable seam.
- **Slice B — new ticket, "Signal-rules section on the Settings screen"** (areas: ui, finance). It covers the AC2 half: "editable in a new signal-rules section of the Settings screen". Contents:
  - `validateSignalRulesInput` in core, using `SIGNAL_RULE_BOUNDS` and the cross-field checks, with all errors reported together;
  - `signalRulesToFormValues`;
  - `mergeSignalRules(existing, rules)` that keeps the `market` and other keys, and an update so `settingsInputToRow`/`saveAppSettings` write both namespaces in one read-modify-write;
  - `AppSettings.signalRules`;
  - a "Quy tắc tín hiệu (trung hạn)" card in `settings-form.tsx`: per-rule enable toggles, % inputs for ppm fields, integers for counts and days, Vietnamese labels, and a help note that P/E stays suppressed until the EPS basis is verified;
  - handler and form tests following the STK-010 patterns.
  - It depends on slice A (`DEFAULT_SIGNAL_RULES`, `SIGNAL_RULE_BOUNDS`, `parseSignalRules`). Ming has delegated UI choices.

**Follow-ups to record (not in either slice):**
- raw-price guards before/with STK-032 (A6);
- plan completion vs annual target (AC6, no data source);
- a peer-universe setting;
- `pe_vs_own_history`;
- the EPS-basis flip after the financials dry-run, plus an ADR 0002 update;
- STK-031 to reuse `PRICES_GAP_TYPE`;
- scorecard scoring of medium signals on label change only;
- making cited `ok` rows immutable (STK-02x);
- a `signals` reader and date index for STK-016;
- bounded concurrency for per-symbol close reads if the universe grows;
- a limit-hit session flag (spec §2.1).

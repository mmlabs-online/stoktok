# consult-finance-investment-researcher — STK-015

# STK-015 consult: finance-investment-researcher (medium-term signal rules)

## Findings

1. **We can't tell yet whether stored EPS is quarterly or TTM.** `financials.eps` has no basis column. `TCBS_FINANCIALS_UNITS` in `/home/user/stoktok/apps/worker/src/sources/tcbs-financials.ts` declares units only. ADR 0002 says "STK-015 must … not assume one", and the recalled values look TTM-like. If we sum four quarters of a TTM series, TTM EPS comes out about 4x too high and P/E about 4x too low, so almost everything would read "cheap".
2. **Net income does not have this problem.** `net_income` comes from the quarterly income statement (`yearly=0`), so it is a per-quarter figure whatever the EPS basis is. BVPS is a point-in-time value, so it is also unaffected.
3. **There isn't enough price history for a 200-day MA.** `EOD_SYNC_CONFIG.lookbackTradingDays = 20` (`/home/user/stoktok/apps/worker/src/config.ts`). A historical backfill is only an STK-005 follow-up. Today every MA50 and MA200 signal would be suppressed.
4. **Price gaps are never written to `data_gaps`.** STK-031 (price gap detection) is still BACKLOG, so there are no `data_gaps` rows with `data_type 'prices_daily'`. The rule therefore has to find gaps itself, by checking the stored bars against the trading calendar (`subtractTradingDays` plus `settings.holidays`). Financials gaps do exist (`data_type 'financials'`, quarter bounds from `quarterBounds`).
5. **Prices are raw, not adjusted for corporate actions** (ADR 0001). A stock dividend or rights ex-date inside the MA window drops the price permanently, which corrupts the MA and the P/E. `corporate_actions` only holds what Ming enters for held symbols (cash and stock dividends only, no rights issues), so watched symbols are not covered.
6. **The peer set is small.** Sector is the TCBS `industry` label on `symbols`. Peers can only come from watchlist ∪ held symbols. ADR 0002 already says P/E vs sector is weak evidence with one or two peers.
7. **Banks will have no financials.** ADR 0002 rejects partial quarters, and its own example is a bank layout. So banks, the sector where P/B matters most, will likely store no financials at all, and their rules will be suppressed.
8. **The ticket's column list can't support daily idempotency.** `created_at` is a timestamptz, so (symbol, rule, day) can't be keyed on it. An explicit `as_of_date` column is needed.
9. **The quarterly-report lag is defined in the worker.** `publishLagDays: 45` sits in the worker config, but the core freshness check needs the same value. R5 says it must be defined in one place.

## Recommendations

### Common shape (AC1, AC3, AC5, R9)
Every rule is a pure function, `(input, params) => SignalResult`:
```ts
type SignalStatus = 'ok' | 'suppressed' | 'not_applicable';
interface SignalResult {
  ruleId: string; ruleVersion: 1; horizon: 'medium'; asOfDate: string;   // trade date
  status: SignalStatus;
  dataFresh: boolean;              // false if any suppression reason is a stale/gap reason
  value: number | null;            // integer ppm, meaning defined per rule
  label: string | null;            // per-rule enum, null unless ok
  reasons: ReasonCode[];           // all reasons found, in a fixed order; reasons[0] is the primary one
  inputs: InputsSnapshot;          // refs + values + params used
}
```
- **Order of checks.** Run the stale/gap checks first (they give `suppressed` and `dataFresh = false`). Then run the not-applicable checks (they give `not_applicable` and `dataFresh = true`). Report every reason found, not just the first one.
- **Input IDs.** Use stable string refs:
  - prices: `prices_daily:FPT:2026-10-23`
  - financials: `financials:FPT:2026Q3`
  - sector: `symbols:FPT:sector`
  - gaps: `data_gaps:<id>`

  Each ref carries `source` and `fetched_at` (R4).
- **MA windows.** Don't list 200 refs. Store `{table:'prices_daily', symbol, fromDate, toDate, count, closes:[…], sources:[…], minFetchedAt, maxFetchedAt}`.
- **Params.** Store the params actually used inside `inputs`, so a later settings change doesn't break the audit trail.
- **Integer math.** Use `mulDiv`/`roundDiv` and ppm only (R2). For the median of an even count, use `roundDiv(a+b, 2)`. The overflow risk is negligible: close ≤ 1e7 × 1e6 is far below 2^53, and `mulDiv` uses BigInt anyway.

### Rule 1: `pe_vs_sector`
1. **Freshness of the subject.** The subject needs a fresh close on `asOfDate`, where `asOfDate = expectedPriceDate(now, holidays, cutoff)`.
2. **TTM EPS** depends on a declared `epsBasis: 'quarterly' | 'ttm' | 'unverified'`. Declare it next to `TCBS_FINANCIALS_UNITS`; it is a property of the source, not a user setting. Pass it into core.
   - `quarterly`: sum the 4 consecutive quarters ending at `latestExpectedPeriod(today, publishLagDays)`. Every quarter must be present.
   - `ttm`: use the latest quarter's `eps`.
   - `unverified` (today's default): suppress with `eps_basis_unverified`. Never guess.
3. **Negative or zero EPS.** If TTM EPS ≤ 0, return `not_applicable` with `eps_non_positive` and value null. Don't show a negative P/E.
4. **P/E.** `pePpm = mulDiv(close, PPM, ttmEps)`.
5. **Peers.** Peers are the other symbols with exactly the same sector label (whitespace already normalized), excluding the subject itself. Each peer must pass the same price and financials checks and have EPS > 0.
   - Peers that fail are excluded, and the snapshot lists them as `{symbol, reason}`.
   - If fewer than `minPeers` valid peers remain, return `not_applicable` with `insufficient_peers`, and record `peerCount` and the excluded list.
6. **Premium.** `median = median(peer pePpm)`, then `premiumPpm = mulDiv(pePpm - median, PPM, median)`.
7. **Label.** `cheap` if `premiumPpm ≤ -discountPpm`, `expensive` if `≥ premiumPpm`, otherwise `neutral`. `value = premiumPpm`.
8. **Snapshot.** Include close, the 4 EPS refs (or 1), ttmEps, pePpm, the peer list (symbol, pePpm, refs), median and the sector ref.

### Rule 2: `pb_vs_sector`
- Same structure as Rule 1, using the latest expected quarter's `bvps`. This doesn't depend on the EPS basis.
- BVPS ≤ 0 (negative equity) gives `not_applicable` with `bvps_non_positive`.
- `pbPpm = mulDiv(close, PPM, bvps)`. Same peer rules, median, premium and labels as Rule 1.

### Rule 3: `earnings_growth_trend` (use quarterly `net_income`, not EPS)
- Using `net_income` avoids the EPS basis problem and the share-count jumps from stock dividends. Label it in the UI as "tăng trưởng LNST" (after-tax profit growth). If Ming wants EPS growth, add it after the EPS basis is verified.
- **Data needed.** `comparisons` YoY pairs, which means `comparisons + 4` consecutive quarters ending at the latest expected period. With the default `comparisons = 4`, that is 8 quarters.
- **Classifying each quarter q against q-4, with base = NI(q-4):**
  - base > 0: `g = mulDiv(NI_q - base, PPM, base)`. It is `up` if g ≥ `growthThresholdPpm`, `down` if g ≤ −threshold, otherwise `flat`.
  - base ≤ 0 and NI_q > 0: `turnaround`, which counts as up. No percentage.
  - base > 0 and NI_q ≤ 0: `to_loss`, which counts as down.
  - base ≤ 0 and NI_q ≤ 0: `loss`, which counts as down. Don't compute a percentage from a negative base.
  - Small positive base: if `base < minBaseVnd`, or |base| is below `minBasePpmOfRevenue` of that quarter's revenue, treat it as non-positive (direction only, no %). This stops ±5000% outliers.
- **Output.**
  - `value` = latest g, or null if it had no defined percentage.
  - `streak` = number of the most recent consecutive quarters in the same direction.
  - Label: `growing` if the last `minConsecutive` are all up or turnaround, `declining` if all down, `to_loss` or `loss`, otherwise `mixed`.
- **Snapshot.** The 8 financials refs with `net_income`, and the per-quarter classification.

### Rule 4: `price_vs_ma` (two instances: `price_vs_ma_50`, `price_vs_ma_200`)
- **Window.** Exactly N stored bars on the N expected trading days ending at `asOfDate`. Compute the expected dates with `subtractTradingDays(asOfDate, N-1, holidays)` and check that every one is present. Allow no missing days: R4 says gapped data never produces a signal, so this must not be a setting.
- **Results.**
  - `ma = roundDiv(sum, N)`.
  - `value = mulDiv(close - ma, PPM, ma)`.
  - Label: `above` if value ≥ `neutralBandPpm`, `below` if ≤ −band, otherwise `near`.
- **Snapshot extras.** Add MA50 and MA200 when both are available. Add a `trend` field: `up` if close > MA50 > MA200, `down` if close < MA50 < MA200, otherwise `mixed`. The MA200 instance carries it. Add the number of ceiling/floor sessions in the window (spec §2.1 says to flag limit-hit sessions).
- **Raw-price guard.** Suppress if either of these holds:
  - A `stock_dividend` ex-date in `corporate_actions` falls inside the window: `corporate_action_in_window`.
  - Any close-to-close move exceeds the exchange's `priceLimitPpm` plus one tick: `price_jump_beyond_limit`. This catches ex-rights adjustments on watched symbols. If the exchange is unknown, use the widest configured limit for this check only, and flag it.

  This stays in place until an adjusted series exists (follow-up).

### Suppression reason codes (AC3, R4)
| Code | Input | Condition | dataFresh |
|---|---|---|---|
| `price_missing` | prices | no bar on or before asOfDate | false |
| `price_stale` | prices | latest bar's tradeDate < asOfDate (`priceStatus`) | false |
| `price_history_insufficient` | prices | fewer than N bars stored at all (not backfilled or newly listed) | false |
| `price_gap_in_window` | prices | an expected trading day in the window has no bar (record the missing dates) | false |
| `price_gap_recorded` | data_gaps `prices_daily` | an open gap overlaps the window (active once STK-031 lands) | false |
| `corporate_action_in_window` / `price_jump_beyond_limit` | prices + corporate_actions | see Rule 4 | false |
| `financials_missing` | financials | no rows | false |
| `financials_stale` | financials | latest period < `latestExpectedPeriod(today, publishLagDays)` | false |
| `financials_gap` | financials | a required quarter is absent, or an open `financials` gap matches it | false |
| `financials_fetch_stale` | financials | max `fetched_at` of the required rows is older than `financialsMaxFetchAgeDays` (the sync rewrites `fetched_at` daily, so this catches a broken source or missed restatements) | false |
| `eps_basis_unverified` | source metadata | basis not declared | false |
| `sector_missing` | symbols | sector null | false |
| `eps_non_positive` / `bvps_non_positive` | — | see Rules 1–2 | true |
| `insufficient_peers` | peers | valid peers < minPeers | true |

Write suppressed and not-applicable results as rows: `value` null, `label` null, reasons in a column. That makes "suppression recorded" auditable in the same table, and the same day can't be computed twice. Downstream (suggestions, UI) must filter on `status = 'ok'`.

### Migration (AC4)
The ticket lists `signals(symbol, rule_id, horizon, value, inputs_snapshot, data_fresh, created_at)`. Add these columns, and note the deviation from the ticket list in the plan:
- `as_of_date date not null`
- `status text check in ('ok','suppressed','not_applicable')`
- `label text`
- `reason_codes text[] not null default '{}'`
- `rule_version smallint`
- `updated_at`

Other details:
- `value bigint` (ppm, R2: not numeric).
- `horizon` check in `('short','medium')`.
- `unique (symbol, rule_id, horizon, as_of_date)`.
- RLS on, revoke from anon and authenticated, grant to service_role. Grants go in the same file, as the symbols and financials migrations did.

### Idempotency (AC5)
- The key is (symbol, rule_id, horizon, as_of_date), and `as_of_date` is the trade date from `expectedPriceDate`, not the wall-clock date. A weekend or holiday re-run therefore maps to the same key.
- Upsert with `onConflict` and DO UPDATE, so a re-run after late data replaces a suppressed row with an ok row. The PK stays the same.
- The job computes everything first (core), then upserts once per run. It doesn't read signals back.

### Horizon
- `medium` means 1–6 months (spec F4), and the scorecard checks medium signals at 3 and 6 months (F7).
- A medium signal is a **state**, re-evaluated after each EOD. It is not an event. Valuation and growth inputs change about quarterly; the MA inputs change daily.
- The scorecard should score medium signals only when they change label, or the daily repeats will count the same call many times. Flag this for STK-02x.

### Defaults: `settings.rule_configs.signals` (R5)
```json
{ "medium": {
  "peVsSector":   { "enabled": true, "minPeers": 5, "discountPpm": 200000, "premiumPpm": 200000 },
  "pbVsSector":   { "enabled": true, "minPeers": 5, "discountPpm": 200000, "premiumPpm": 200000 },
  "earningsGrowth": { "enabled": true, "comparisons": 4, "minConsecutive": 2, "growthThresholdPpm": 100000, "minBasePpmOfRevenue": 10000 },
  "priceVsMa":    { "enabled": true, "periods": [50, 200], "neutralBandPpm": 20000 },
  "freshness":    { "financialsMaxFetchAgeDays": 7 } } }
```
- **Why these values.** ±20% vs the peer median and a ±2% MA band are conventional starting points. They are medium-conviction defaults and are meant to be tuned from the F7 hit rates.
- **Parsing.** `parseSignalRules` should mirror `parseMarketRules`: each invalid key falls back to its own default.
- **Settings screen validation.** Bounds checked in core `validateSettings`:
  - minPeers 3–50
  - ppm thresholds 0–1,000,000
  - comparisons 1–8, minConsecutive 1 to comparisons
  - MA periods integers 5–250, short < long
- **Merging.** Add a `mergeSignalRules` that keeps the `market` key, and check that `mergeRuleConfigs` keeps `signals` (it already spreads `base`).
- **publishLagDays.** Move it to a core constant or settings so the sync and the rule share one value.

### Peer set: own DB only
- **v1.** Peers come from watchlist ∪ held. Suppress with `insufficient_peers` when there are fewer than 5. Never fall back to a market-wide or source-provided sector P/E, and never to a smaller minimum. Show the peer count in the UI so "neutral" isn't mistaken for evidence.
- **Follow-up A: peer universe.** Add a setting listing extra symbols that are synced for prices and financials only and not shown in the watchlist (for example VN30 plus 5–10 names per sector Ming holds). That is about 4 requests per symbol per day; 100 symbols is roughly 7 minutes at a 1 s delay.
- **Follow-up B: P/E vs own history.** A separate rule, `pe_vs_own_history`, comparing P/E with its own 3–5-year median. It has its own rule_id and is not a substitute for the sector rule.

### Test edge cases (R8)
- **Missing data:**
  - Missing middle quarter, missing latest quarter (stale), only 3 of 4 quarters.
  - Open `financials` gap even though the row now exists (gap not yet resolved).
  - `fetched_at` older than the max age.
- **EPS and P/E:**
  - `epsBasis` set to `unverified`, `ttm` and `quarterly`: the same rows must give the expected different TTM EPS.
  - TTM EPS exactly 0, negative TTM with one positive quarter, BVPS ≤ 0.
- **Peers:**
  - Exactly minPeers versus minPeers − 1.
  - A stale peer excluded; the subject excluded from its own median.
  - Even and odd peer counts (median rounding); all peers loss-making.
  - Sector null; sector labels differing only in whitespace.
- **Growth:**
  - Base positive → current negative; base negative → current positive; both negative.
  - Tiny positive base; growth exactly at the threshold (boundary inclusive).
  - Streak broken by a `flat` quarter; fewer than 8 quarters.
- **MA:**
  - Exactly N bars; N−1 bars.
  - A holiday in the window: no gap if it is configured, a gap if it isn't.
  - A missing weekday; latest bar from yesterday (stale).
  - Close exactly at MA ± band.
  - Stock-dividend ex-date in the window; a jump beyond the limit; exchange null.
- **Runs and idempotency:**
  - asOfDate on a weekend re-run equals Friday's.
  - Running twice gives identical results (determinism), and the upsert key is stable.
- **Snapshot and parsing:**
  - The snapshot contains every ref used, and the params.
  - Integer-only outputs: `Number.isSafeInteger` on every value.
  - Settings parse falls back per key.

## Risks
- **P/E is dead until the EPS basis is verified.** It stays suppressed until the dry-run confirms the basis. A wrong declaration would mislabel every symbol, roughly by 4x. Mitigation: an implied-shares consistency check, `netIncome / eps` stable across quarters, which supports a quarterly basis. Use it as a test-time sanity aid only, never at runtime.
- **The MA rules depend on a backfill.** Without at least 200 bars per symbol, which needs a backfill ticket, the MA rules only ever give `price_history_insufficient`. The holiday list must also cover about 10 months, including Tết, or every MA200 is suppressed. That fails safe, but it is noisy.
- **Raw prices.** The guard catches large stock dividends and rights issues but not small cash dividends, which distort the MA slightly. For about 4 quarters after a big stock dividend, P/E is understated because EPS was published on the pre-dilution share count. Flag `corporate_action_in_ttm` in the snapshot.
- **Peer coverage.** With the TCBS industry label and a small watchlist, most valuation signals will be `insufficient_peers`. The labels are also coarse ("Bất động sản" mixes developers and industrial parks), so the median can be biased.
- **Banks and brokers** may have no stored financials at all (ADR 0002 rejects partial quarters), so their valuation and growth signals never appear.
- **Overwriting rows.** An in-place upsert could change a signal row that a later suggestion cites (R9). That is safe while suggestions run after signals on the same day. Consider making `ok` rows immutable once a suggestion references them (a STK-02x concern).
- **Evidence quality.** These are standard heuristics, not validated alpha. Conviction is low to medium until the F7 scorecard has 3–6 months of data.

## Open questions (for Ming or the planner)
1. Where should the EPS basis live: a constant beside the source units (recommended), or a new `financials.eps_basis` column, which needs a migration but survives a source swap? Until it is verified, is `eps_basis_unverified` suppression acceptable?
2. Should the planner add a historical price backfill (at least 200 trading days) to this ticket, or is it a prerequisite ticket? Without it the MA rules are inert.
3. Should STK-015 depend on STK-031, or is self-detection from the calendar enough (recommended: self-detect now, also read open `prices_daily` gaps when they exist)?
4. Default `minPeers`: 5, or 3 for a personal watchlist? I recommend 5. Lower makes the median essentially one or two stocks.
5. Should we use net income (recommended) or EPS for the growth trend?
6. Should a peer universe be a follow-up, or is valuation vs sector acceptable as mostly-suppressed in v1?
7. Are the extra `signals` columns (`as_of_date`, `status`, `label`, `reason_codes`, `rule_version`) acceptable as a deviation from the ticket's column list?

Key files: `/home/user/stoktok/docs/adr/0002-financials-source.md`, `/home/user/stoktok/apps/worker/src/config.ts`, `/home/user/stoktok/apps/worker/src/sources/tcbs-financials.ts`, `/home/user/stoktok/packages/core/src/market/quarters.ts`, `/home/user/stoktok/packages/core/src/portfolio/freshness.ts`, `/home/user/stoktok/packages/core/src/settings/market-rules.ts`, `/home/user/stoktok/supabase/migrations/20261026000100_financials.sql`.

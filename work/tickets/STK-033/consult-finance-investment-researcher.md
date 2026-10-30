## STK-033 consult: finance-investment-researcher

### Findings

**1. All medium parameters** (`packages/core/src/signals/config.ts`: `DEFAULT_SIGNAL_RULES`, `SIGNAL_RULE_BOUNDS`, `parseSignalRules`). There are 17 fields. Bounds are inclusive.

| Path (`signals.medium.…`) | Default | Bound key / range | Unit to show |
|---|---|---|---|
| `peVsSector.enabled` | true | bool | toggle |
| `peVsSector.minPeers` | 5 | `minPeers` 3–50 | mã (count) |
| `peVsSector.discountPpm` | 200 000 | `ratioPpm` 0–1 000 000 | % below the peer median (20%) |
| `peVsSector.premiumPpm` | 200 000 | `ratioPpm` 0–1 000 000 | % above the peer median (20%) |
| `pbVsSector.*` | same as P/E | same | same |
| `earningsGrowth.enabled` | true | bool | toggle |
| `earningsGrowth.comparisons` | 4 | `comparisons` 1–8 | quý (YoY comparisons) |
| `earningsGrowth.minConsecutive` | 2 | 1 to `comparisons.max`, and ≤ comparisons | quý liên tiếp |
| `earningsGrowth.growthThresholdPpm` | 100 000 | `ratioPpm` 0–100% | % YoY (10%) |
| `earningsGrowth.minBasePpmOfRevenue` | 10 000 | `ratioPpm` 0–100% | % of revenue (1%) |
| `priceVsMa.enabled` | true | bool | one toggle covers both MAs |
| `priceVsMa.shortDays` | 50 | `maDays` 5–250, short < long | phiên (trading sessions, not calendar days) |
| `priceVsMa.longDays` | 200 | `maDays` 5–250 | phiên |
| `priceVsMa.neutralBandPpm` | 20 000 | `neutralBandPpm` 0–200 000 | ±% from the MA (2%) |
| `freshness.financialsMaxFetchAgeDays` | 7 | `maxFetchAgeDays` 1–90 | ngày (calendar days) |

**2. Cross-field constraints.** The parser has two pair rules, and when either is broken it resets both fields of the pair to their defaults without any warning:
- `minConsecutive ≤ comparisons`
- `shortDays < longDays` (strict)

There is one more rule-level relationship: `discountPpm` and `premiumPpm` are independent and may differ.

**3. The parser and the form validator must accept exactly the same values.** `parseSignalRules` quietly falls back to the default for floats, non-integers, out-of-range values and broken pairs. The validator must reject every one of those with an error. If the validator accepts something the parser drops, Ming saves a value and the job silently uses the default instead.

**4. Edge semantics inside the bounds.** These values are legal but change behaviour a lot:
- **0 thresholds:**
  - `discountPpm = 0`: every symbol at or below the peer median is bullish, so there is no neutral zone on that side. When the subject equals the median, bullish is checked first and wins.
  - `growthThresholdPpm = 0`: any YoY change ≥ 0 counts as "up", so "flat" never happens.
  - `neutralBandPpm = 0`: no neutral label at all.
- **`discountPpm = 1 000 000` (100%)**: this can never be reached because the ratio is > 0, so it effectively disables bullish.
- **`minBasePpmOfRevenue` high**: most bases become "direction only" (turnaround/loss), so the growth rule turns into a sign test.

**5. Changing the MA lengths changes the rule IDs.** `maRuleId(days)` gives `price_vs_ma_${days}`. If Ming changes 50 to 20, new rows are written under `price_vs_ma_20` and the `price_vs_ma_50` history stops; old rows are not migrated. `RULE_VERSION` stays 1. The params are snapshotted in `inputs.params`, so the audit trail survives. Today only worker tests hard-code `price_vs_ma_50/200`; STK-016 or the scorecard must not hard-code them either.

**6. The bounds fit the data depth, just.**
- `comparisons` max 8 needs 8 + 4 = 12 quarters, which is exactly the worker's `lookbackQuarters: 12` (`apps/worker/src/config.ts:34`).
- `longDays` up to 250 needs 250 stored closes. Without them the rule is suppressed as `insufficient_history`, which is safe.

**7. Turning a rule off writes nothing.** A disabled rule produces no row (STK-015 A9), not a suppressed row, so older rows for that rule stay in the table.

**8. STK-036 guards have no settings of their own.**
- `checkRawPriceWindow` reads `ctx.priceLimitPpm` from `rule_configs.market`. That value is already editable on `/settings` as "Biên độ HOSE/HNX/UPCoM (%)", bounded 1–30% (`SETTINGS_BOUNDS.priceLimitPpm`).
- The other guard inputs are not settings: the rule that any non-cash corporate action in the window suppresses, the strict "beyond the limit" comparison, and the widest-limit fallback for a null exchange.
- Inputs that are not in `SignalRules` and must stay code or source properties: `publishLagDays` (`DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS`), `epsBasisBySource` / `TCBS_FINANCIALS_EPS_BASIS` (STK-015 consult: "a property of the source, not a user setting"), the price cutoff, and `RULE_VERSION`.

### Recommendations

- **R-1 (AC1).** Show all 17 fields, grouped into P/E, P/B, Tăng trưởng LN, Giá vs MA and Dữ liệu. Show each default as the placeholder or a hint.
  - ppm fields: show as % using the existing `parseRatePercentInput` / `formatRatePercentInput`, the same path as fee and tax. Do not write a new converter (R1, R2).
  - Counts and days: use `parseIntegerInput`. Units: "mã", "quý", "phiên", "ngày".
  - Help notes:
    - P/E stays suppressed while the EPS basis is unverified.
    - Peers are counted only from watchlist ∪ held.
    - The MA lengths are trading sessions, and changing them starts a new series.
- **R-2 (AC2).** `validateSignalRulesInput` in core should read `SIGNAL_RULE_BOUNDS` directly, not copy the numbers (R5).
  - Report every error at once, in Vietnamese.
  - Put cross-field errors on the dependent field: the error for `minConsecutive > comparisons` goes on `minConsecutive`; the error for `shortDays >= longDays` goes on `longDays`.
  - Reject the whole save, market fields included, if any field fails.
  - Add a round-trip unit test (validate → merge → `parseSignalRules` returns the same values) at the min/max of every bound and at the pair edges (short = long − 1, minConsecutive = comparisons). This closes Finding 3 (R8).
- **R-3 (AC3).** `mergeSignalRules` should write only `signals.medium.*`. Keep `signals.<other>` (for example a future `long`) and `market`. Test both directions: a market save keeps `signals`, and a signals save keeps `market`. `mergeRuleConfigs` already spreads `base`.
- **R-4 (AC1, all bounds safe).** Every field is safe for Ming to edit within its bounds, because none of them can create an `ok` signal from bad data (R4). For `financialsMaxFetchAgeDays`, add a warning hint, since raising it loosens a data-freshness guard (see Open question 1). Do not add soft warnings for the 0% edge cases unless the planner wants them; they are legal by STK-015's bounds, and a help line is enough.
- **R-5 (AC4).** The wiring test: save non-default values (for example minPeers 8, short/long 20/100, band 5%), then call `getSignalRules` and run `runMediumSignals` with the memory store. Assert that the row keys are `price_vs_ma_20` and `price_vs_ma_100`, and that `inputs.params` reflects the saved values.
- **R-6 (R7, R4, R5). Expose no new STK-036 guard settings.** No guard on/off toggle, no tolerance above the limit, and no `cashDividendMaxPpm` (that is the STK-036 follow-up). Turning a guard off would let distorted raw prices produce `ok` rows, which goes against R4 and ADR 0001.
  - The guard's only setting is the market price limit, which is already editable.
  - At most, add a hint under the price limits saying they also drive the MA guard. That is just a hint, and the planner can drop it under R7.
  - Do not expose `publishLagDays`, the EPS basis, the cutoff or `RULE_VERSION`.

### Risks

- **Parser and validator drift (Finding 3).** A saved value could be silently replaced by its default. Severity: medium, because Ming would believe a setting is in effect when it is not. R-2's round-trip test mitigates it.
- **The MA series breaks on a length change (Finding 5).** This affects history and any future scorecard hit rates. Low risk in v1, which has no reader yet.
- **Tuning on few data points.** The F7 hit rates do not exist yet. With an average universe of fewer than about 10 names per sector, lowering `minPeers` to 3 makes the median of 3 peers noisy. The bound allows it, so put a help note on the field.
- **Disabled rules leave old rows (Finding 7).** STK-016 could show an old label as current unless it filters by the latest `signal_date`.
- **Loosening the data guard.** Raising `financialsMaxFetchAgeDays` to 90 lets financials go up to 90 days without a refresh before `financials_fetch_stale` fires. That is less protective, but still within the STK-015 bounds.

### Open questions (for Ming or the planner)

1. Should `freshness.financialsMaxFetchAgeDays` be editable or read-only? It is a data-quality guard rather than a signal threshold. AC1 says "every medium parameter", so I lean editable with a warning hint.
2. Should P/E and P/B share one set of thresholds in the UI, or keep separate fields? The storage keeps them separate. I recommend separate fields: P/B dispersion in VN banks and property differs from P/E.
3. Should the price-limit fields in the market section get a hint that they also drive the MA guard, or is that out of scope (R7)?

Key files:
- /home/user/stoktok/packages/core/src/signals/config.ts
- /home/user/stoktok/packages/core/src/signals/raw-price-guard.ts
- /home/user/stoktok/packages/core/src/signals/moving-average.ts
- /home/user/stoktok/packages/core/src/signals/growth.ts
- /home/user/stoktok/packages/core/src/signals/valuation.ts
- /home/user/stoktok/packages/core/src/signals/types.ts (`maRuleId`)
- /home/user/stoktok/packages/core/src/settings/validate-settings.ts
- /home/user/stoktok/packages/core/src/settings/market-rules.ts
- /home/user/stoktok/apps/worker/src/jobs/medium-signals.ts
- /home/user/stoktok/apps/worker/src/config.ts (`lookbackQuarters: 12`)

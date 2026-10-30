# STK-036 finance consult: raw-price guards for MA rules

## Findings
1. **The schema already picks the date.** `public.corporate_actions` has `ex_date date not null` and `record_date date` (nullable) (`supabase/migrations/20261023000100_v1_tables.sql:25-45`). There is an index on `(symbol, ex_date)`. The core `CorporateAction` and its mapper use `exDate`, and the price board already marks "no reference" sessions by ex-date (`packages/core/src/market/price-board.ts:153`). Spec §5 still says `record_date`, so it lags the schema STK-003 built. That gap is only in the docs; no scope question depends on it.
2. **VN convention.** With T+2 settlement, the ex-rights date (ngày GDKHQ) is the trading day just before the record date (ngày ĐKCC). The raw close drops on the ex-date, not on the record date. So the ex-date is the correct boundary for price distortion.
3. **Allowed action types are only `cash_dividend` and `stock_dividend`.** This is enforced by the DB check, the core union type and `validateCorporateAction` (`CA_TYPE_UNSUPPORTED` for `rights_issue`). Bonus shares (cổ phiếu thưởng) work the same way and are entered as `stock_dividend`. **A rights issue cannot be stored today**, so AC1's "rights issue falls inside the window" can only be caught by the jump guard.
4. **`corporate_actions` only covers what Ming enters for held symbols.** For watched symbols, the jump guard is the only protection.
5. **Price limits.** `MarketRules.priceLimitPpm` gives HOSE 70000 / HNX 100000 / UPCOM 150000 (R5). `priceLimits()` already does tick snapping: ceiling rounds down, floor rounds up. It **throws** on an off-tick reference price, and it needs tick bands.
6. **No migration is needed.** The `signals` table only checks the format of `reason_codes` (`^[a-z0-9_]{1,60}`), not a list of allowed values.
7. **New inputs.** Signals currently get no exchange and no corporate actions (`EvaluateInput` has neither). The worker will need to pass `symbols.exchange` (nullable; the column comment says it must never default to HOSE), the market rules, and `corporate_actions` for the universe.

## Recommendations

**R-A: window membership uses `ex_date` (AC1).**
- Trigger when `fromDate < ex_date ≤ toDate` of the N-bar window that is actually used.
- Reason: the MA is distorted only if the window holds bars from both before and after the ex-date.
  - `ex_date == fromDate`: all bars are after the ex-date, so the window is consistent.
  - `ex_date == toDate`: the latest close is ex-date and the rest are pre-ex, so it triggers.
  - A future `ex_date` is ignored.
- Compare plain date strings, so an ex-date wrongly entered on a non-trading day is still handled.
- Do not fall back to `record_date`. It is never needed because `ex_date` is NOT NULL.
- Pin the boundary with tests for `ex_date = fromDate` (no trigger) and `ex_date = toDate` (trigger).
- If the planner prefers inclusive `[fromDate, toDate]` for simplicity, it costs one extra suppressed day per action and is acceptable. Pick one and test it.
- Add a spec-doc follow-up: change §5 to `ex_date, record_date` (doc only, R7).

**R-B: action types (AC1).**
- Trigger on every type **except `cash_dividend`**, i.e. fail-safe: anything new, such as a future `rights_issue`, is covered automatically.
- Do not set a ratio threshold for stock dividends. Even 100:5 causes a ~4.8% raw drop, which is more than the 2% `neutralBandPpm`.
- **Cash dividends do not trigger.** A VN single payment is typically 1–3% of price, and most payers pay 1–2× a year. Suppressing them would kill almost every MA200, whose window is about 10 months.
  - The worst-case MA bias is about D/P × the pre-ex share of the window, which can be ≤3%. That can move a label across the ±2% band, so it is a real but bounded distortion.
- Optional, low cost: list cash dividends in the window (`ref`, `exDate`, `amountPerShare`) in the snapshot.
- Follow-up: a threshold or adjusted series (`cashDividendMaxPpm`, or an adjusted close series per ADR 0001).
- Planner should note the AC1 conflict: rights issues can't be stored, so "rights" is covered by the jump guard only (see Finding 3).

**R-C: jump test, and exactly-at-limit days (AC1, AC4, R2, R5).**
- Use a strict raw comparison in BigInt: trigger when `|close_t − close_{t−1}| × PPM > limitPpm × close_{t−1}`. Do not call `priceLimits()`.
- For an on-tick close this is **exactly the same as `close > tick-snapped ceiling` or `close < tick-snapped floor`**:
  - snapped ceiling ≤ raw ceiling < snapped ceiling + one tick;
  - the floor side is symmetric.
- It also never throws on an off-tick or adjusted-looking previous close, and needs no tick bands.
- Only compare pairs where both bars are in the window and they are adjacent trading days (`previousTradingDay`). Skip pairs where `close_{t−1} ≤ 0`.
  - The first bar's move from the bar before the window is excluded, for the same reason as R-A.
  - Pairs across a gap are skipped; the gap is already reported as `price_gap`.
- Test vectors (values checked against existing `priceLimits` tests):
  - HOSE ref 20,000 → close 21,400 (exactly +7.0000%): no trigger. Close 21,450: trigger. Floor 18,600: no trigger. 18,550: trigger.
  - HOSE ref 25,400: the raw ceiling is 27,178 and the snapped one is 27,150. Close 27,150: no trigger (legit ceiling day). Close 27,200 (ceiling plus one tick): trigger. This proves the raw test matches tick rounding.
  - HNX ref 15,000 → 16,500: no trigger. UPCoM ref 12,300 → 14,100: no trigger.

**R-D: null exchange (AC2).**
- Use `limitPpm = max(...Object.values(rules.priceLimitPpm))`, computed from config and never the literal `UPCOM`/150000.
- Put `exchangeUnknown: true` and `limitPpmUsed` in the guard result and the snapshot.
- Flag it in the snapshot, but do **not** make it a suppression reason. AC2 says "flagged", and a null exchange on its own doesn't distort prices.
- Test: a +12% move with a null exchange gives no trigger plus the flag; +16% triggers. Also check that a changed config max is respected.

**R-E: reason codes and order (AC3).**
- Add `corporate_action_in_window` then `price_jump_beyond_limit`, in that order (a known cause before an inferred one).
- Put them in `RULE_REASONS` ahead of `eps_basis_unverified`, so `dataFresh` stays **true**. The data is fresh and complete; the raw series just isn't fit for an MA.
- This departs from the STK-015 consult table, which put them under `dataFresh=false`. The `signals.data_fresh` column comment ("stale, gap, missing, insufficient history") supports treating them as rule reasons. Planner decides; record it in the plan.
- Run the guard on whatever bars are in the window and report every reason found, in line with the STK-015 convention.

**R-F: guard shape (R1, R9).**
- Pure `packages/core/src/signals/raw-price-guard.ts`.
- Input: `(window: StoredClose[], exchange: Exchange|null, rules: Pick<MarketRules,'priceLimitPpm'>, actions: CorporateAction[], holidays)`.
- Output: `{ reasons, exchangeUnknown, limitPpmUsed, actionRefs: ['corporate_actions:<id>'], jumps: [{date, prevClose, close, movePpm}] }`.
- `priceVsMa` adds the reasons and puts the guard result under `inputs.guard`. The worker passes the inputs in; core does no I/O.

## Risks
- **Small stock dividends on watched symbols go undetected.** Without a `corporate_actions` row, the jump guard only catches raw drops above the limit. The smallest stock dividend caught is about 8% on HOSE, 11% on HNX and 18% on UPCoM, so a 100:5 bonus on a watched HOSE name corrupts MA50/MA200 silently for 50/200 days.
  - Mitigation: an adjusted series, or a corporate-action feed for watched symbols (follow-up). Until then, conviction in MA signals for watched names is low.
- **False positives are fail-safe but noisy.**
  - UPCoM's reference price is the previous session's VWAP, not its close, so a legitimate limit day can be more than 15% close-to-close on illiquid names.
  - First listing days and resumptions after suspension have wider limits.
  - Each such jump suppresses up to 200 sessions of MA200.
- **Every large stock dividend blanks MA200 for about 10 months.** MA200 returns no `ok` rows until the event leaves the window. This is expected; an adjusted series is the real fix.
- **A wrong or missing `ex_date` entry by Ming** means the corporate-action path misses it. The jump guard is the backstop only for moves above the limit.
- **Cash-dividend bias** (≤ about 3%) remains in `ok` rows near the ±2% band.

## Open questions
1. Window boundary: half-open `(fromDate, toDate]` as recommended, or inclusive?
2. Should the new reasons set `dataFresh` true (recommended) or false (the STK-015 consult's original position)?
3. Should AC1's "rights issue" stay covered by the jump guard only (recommended), or does Ming want `rights_issue` added to the schema? That would be a separate ticket, since it touches the ledger and cost basis.
4. Should cash dividends in the window be recorded in the snapshot now (cheap), or left entirely to the follow-up?
5. Spec §5 update to `ex_date`: should the orchestrator log it as a doc follow-up?

Key files:
- /home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql
- /home/user/stoktok/packages/core/src/market/price-board.ts
- /home/user/stoktok/packages/core/src/settings/market-rules.ts
- /home/user/stoktok/packages/core/src/signals/moving-average.ts
- /home/user/stoktok/packages/core/src/signals/types.ts
- /home/user/stoktok/packages/core/src/signals/evaluate.ts
- /home/user/stoktok/supabase/migrations/20261025000100_symbols.sql
- /home/user/stoktok/supabase/migrations/20261026000200_signals.sql

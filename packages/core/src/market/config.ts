import type { Exchange } from '../settings/market-rules';

/** Plausibility bounds for stored prices (R5: market config, defined once). */
export interface PriceSanity {
  /** Lowest plausible price. Guards a thousand-VND feed read as VND (e.g. 61.5 or 61). */
  minPriceVnd: number;
  /** Highest plausible price. Guards a VND feed read as thousand VND (61,500 x 1000). */
  maxPriceVnd: number;
  /** Prices are multiples of this step; a feed in the wrong unit or with adjusted prices usually is not. */
  priceStepVnd: number;
  /** Max ratio between a new close and the last stored close (either direction). Allows splits, catches 1000x unit errors. */
  maxCloseJumpRatio: number;
}

export const DEFAULT_PRICE_SANITY: PriceSanity = {
  minPriceVnd: 100,
  maxPriceVnd: 10_000_000,
  priceStepVnd: 10,
  maxCloseJumpRatio: 5,
};

/** One price band of an exchange tick table: prices below `below` move in steps of `step`. */
export interface TickBand {
  /** Exclusive upper bound in VND; null for the last (open-ended) band. */
  below: number | null;
  step: number;
}

/**
 * Tick (price step) table per exchange, ascending bands, last band open-ended (R5: market config).
 * UNVERIFIED, verify before go-live. Used to round computed ceiling/floor to a valid price:
 * the ceiling is rounded down and the floor up, so neither exceeds the real daily limit.
 */
export const DEFAULT_TICK_BANDS: Record<Exchange, readonly TickBand[]> = {
  HOSE: [
    { below: 10_000, step: 10 },
    { below: 50_000, step: 50 },
    { below: null, step: 100 },
  ],
  HNX: [{ below: null, step: 100 }],
  UPCOM: [{ below: null, step: 100 }],
};

/** Plausibility bounds for stored quarterly financials (R5: market config, defined once). All values in integer VND. */
export interface FinancialsSanity {
  /** Highest plausible |EPS| in VND per share. Guards raw-VND or other scale errors in per-share fields. */
  maxAbsEpsVnd: number;
  /** Lowest plausible |BVPS|. Guards per-share values sent in thousand VND (25.3 read as 25 VND). EPS and BVPS share an endpoint, so one guard covers the period. */
  minAbsBvpsVnd: number;
  maxAbsBvpsVnd: number;
  /** Lowest plausible non-zero revenue. Guards billions of VND read as VND. */
  minNonZeroRevenueVnd: number;
  /** Highest plausible |revenue| and |net income|. With the safe-integer check, guards raw VND or millions read as billions. */
  maxAbsTotalVnd: number;
  /** Reject revenue 0 as `zero_revenue`. Off by default (TCBS unchanged); on for sources whose "not applicable" column reads 0 (STK-042). */
  rejectZeroRevenue?: boolean;
}

export const DEFAULT_FINANCIALS_SANITY: FinancialsSanity = {
  maxAbsEpsVnd: 1_000_000,
  minAbsBvpsVnd: 100,
  maxAbsBvpsVnd: 10_000_000,
  minNonZeroRevenueVnd: 1_000_000,
  maxAbsTotalVnd: 1_000_000_000_000_000,
};

/** Days after quarter end by which a quarterly report is expected (VN deadline, 30/45 days). Shared by the financials sync and the signal freshness check. */
export const DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS = 45;

/** Plausibility bound for stored statement lines (R5). Integer VND. */
export interface StatementLinesSanity {
  /** Highest plausible |line value|. Balance-sheet totals of the largest banks reach about 3e15 VND, above the quarterly-financials bound, so this sits just under Number.MAX_SAFE_INTEGER (about 9.007e15); a 1000x scale error on any large line is then rejected here or by the safe-integer check. */
  maxAbsTotalVnd: number;
}

export const DEFAULT_STATEMENT_LINES_SANITY: StatementLinesSanity = {
  maxAbsTotalVnd: 9_000_000_000_000_000,
};

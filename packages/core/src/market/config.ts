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

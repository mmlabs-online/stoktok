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

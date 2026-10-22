import { assertVnd, mulDiv } from '../money';
import type { Holding } from './types';

export interface ValuedHolding extends Holding {
  marketPrice: number | null;
  marketValue: number | null;
  /** marketValue - totalCost. Estimated exit fee/tax are not subtracted. */
  unrealizedPnl: number | null;
}

/** A symbol without a price yields null values, never 0. */
export function valueHoldings(
  holdings: readonly Holding[],
  prices: Readonly<Record<string, number>>,
): ValuedHolding[] {
  return holdings.map((h) => {
    const raw = prices[h.symbol];
    if (raw === undefined) {
      return { ...h, marketPrice: null, marketValue: null, unrealizedPnl: null };
    }
    const marketPrice = assertVnd(raw, `price[${h.symbol}]`);
    const marketValue = mulDiv(h.quantity, marketPrice, 1);
    return { ...h, marketPrice, marketValue, unrealizedPnl: marketValue - h.totalCost };
  });
}

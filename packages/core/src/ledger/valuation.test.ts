import { describe, expect, it } from 'vitest';
import type { Holding } from './types';
import { valueHoldings } from './valuation';

const holding = (symbol: string, quantity: number, totalCost: number): Holding => ({
  symbol,
  quantity,
  sellableQuantity: quantity,
  totalCost,
  averageCost: quantity > 0 ? totalCost / quantity : null,
  realizedPnl: 0,
  dividendCashNet: 0,
});

describe('valueHoldings', () => {
  it('unrealized P&L from price map', () => {
    const [v] = valueHoldings([holding('FPT', 1000, 100_000_000)], { FPT: 105_000 });
    expect(v).toMatchObject({ marketPrice: 105_000, marketValue: 105_000_000, unrealizedPnl: 5_000_000 });
  });
  it('missing price gives null, not 0', () => {
    const [v] = valueHoldings([holding('VNM', 100, 7_000_000)], {});
    expect(v).toMatchObject({ marketPrice: null, marketValue: null, unrealizedPnl: null });
  });
});

import { addVnd, roundDiv, toSafe } from '../money';
import { valueHoldings } from '../ledger/valuation';
import type { ValuedHolding } from '../ledger/valuation';
import type { Holding } from '../ledger/types';
import { priceStatus } from './freshness';
import type { PriceStatus } from './freshness';

const PPM = 1_000_000n;

/** Latest stored close of a symbol. Every market-data record carries source and fetchedAt (R4). */
export interface PriceQuote {
  symbol: string;
  /** Integer VND. */
  close: number;
  /** 'YYYY-MM-DD'. */
  tradeDate: string;
  source: string;
  fetchedAt: string;
}

export interface PortfolioRow extends ValuedHolding {
  priceDate: string | null;
  fetchedAt: string | null;
  priceStatus: PriceStatus;
  /** Unrealized P&L / total cost in ppm; null when unpriced or the cost is 0. */
  unrealizedPnlPpm: number | null;
  /** Share of priced holdings' market value in ppm; null when unpriced or the total is 0. */
  weightPpm: number | null;
  /** Integer 0..100 for a bar; null when weightPpm is null. */
  weightBarPct: number | null;
  overConcentration: boolean;
}

export interface PortfolioTotals {
  /** null when holdings are open but none is priced (value unknown, not 0). */
  holdingsMarketValue: number | null;
  holdingsCostPriced: number;
  unrealizedPnl: number | null;
  unrealizedPnlPpm: number | null;
  /** All holdings, including fully sold ones. */
  realizedPnl: number;
  dividendCashNet: number;
  cash: number;
  otherAssets: number;
  /** cash + otherAssets. */
  nonStockAssets: number;
  assetCount: number;
  netWorth: number;
  pricedCount: number;
  missingCount: number;
  staleCount: number;
  /** False when some open holding has no price, so totals and weights are partial. */
  complete: boolean;
  thresholdPpm: number;
  overConcentrated: string[];
}

export interface Portfolio {
  rows: PortfolioRow[];
  totals: PortfolioTotals;
}

export interface BuildPortfolioInput {
  holdings: readonly Holding[];
  quotes: Readonly<Record<string, PriceQuote>>;
  assets: readonly { type: 'cash' | 'other'; value: number }[];
  expectedPriceDate: string;
  concentrationThresholdPpm: number;
}

export function buildPortfolio(input: BuildPortfolioInput): Portfolio {
  const prices: Record<string, number> = {};
  for (const [symbol, q] of Object.entries(input.quotes)) prices[symbol] = q.close;
  const open = valueHoldings(
    input.holdings.filter((h) => h.quantity > 0),
    prices,
  );

  const priced = open.filter((h) => h.marketValue !== null);
  const denom = addVnd(0, ...priced.map((h) => h.marketValue ?? 0));
  const threshold = BigInt(input.concentrationThresholdPpm);

  const rows: PortfolioRow[] = open.map((h) => {
    const quote = input.quotes[h.symbol];
    const mv = h.marketValue;
    const unrealizedPnlPpm =
      h.unrealizedPnl !== null && h.totalCost > 0
        ? toSafe(roundDiv(BigInt(h.unrealizedPnl) * PPM, BigInt(h.totalCost)))
        : null;
    const weightPpm = mv !== null && denom > 0 ? toSafe(roundDiv(BigInt(mv) * PPM, BigInt(denom))) : null;
    return {
      ...h,
      priceDate: quote?.tradeDate ?? null,
      fetchedAt: quote?.fetchedAt ?? null,
      priceStatus: priceStatus(quote, input.expectedPriceDate),
      unrealizedPnlPpm,
      weightPpm,
      weightBarPct: weightPpm === null ? null : toSafe(roundDiv(BigInt(weightPpm), 10_000n)),
      overConcentration: mv !== null && denom > 0 && BigInt(mv) * PPM > threshold * BigInt(denom),
    };
  });

  rows.sort((a, b) => {
    if (a.marketValue === null && b.marketValue === null) return a.symbol.localeCompare(b.symbol);
    if (a.marketValue === null) return 1;
    if (b.marketValue === null) return -1;
    return b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol);
  });

  const pricedRows = rows.filter((r) => r.marketValue !== null);
  const holdingsCostPriced = addVnd(0, ...pricedRows.map((r) => r.totalCost));
  const unrealizedPnl = addVnd(0, ...pricedRows.map((r) => r.unrealizedPnl ?? 0));
  const cash = addVnd(0, ...input.assets.filter((a) => a.type === 'cash').map((a) => a.value));
  const otherAssets = addVnd(0, ...input.assets.filter((a) => a.type === 'other').map((a) => a.value));
  const missingCount = rows.length - pricedRows.length;
  const nothingPriced = rows.length > 0 && pricedRows.length === 0;

  return {
    rows,
    totals: {
      holdingsMarketValue: nothingPriced ? null : denom,
      holdingsCostPriced,
      unrealizedPnl: nothingPriced ? null : unrealizedPnl,
      unrealizedPnlPpm:
        holdingsCostPriced > 0 ? toSafe(roundDiv(BigInt(unrealizedPnl) * PPM, BigInt(holdingsCostPriced))) : null,
      realizedPnl: addVnd(0, ...input.holdings.map((h) => h.realizedPnl)),
      dividendCashNet: addVnd(0, ...input.holdings.map((h) => h.dividendCashNet)),
      cash,
      otherAssets,
      nonStockAssets: addVnd(cash, otherAssets),
      assetCount: input.assets.length,
      netWorth: addVnd(denom, cash, otherAssets),
      pricedCount: pricedRows.length,
      missingCount,
      staleCount: rows.filter((r) => r.priceStatus === 'stale').length,
      complete: missingCount === 0,
      thresholdPpm: input.concentrationThresholdPpm,
      overConcentrated: rows.filter((r) => r.overConcentration).map((r) => r.symbol),
    },
  };
}

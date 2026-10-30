/** Test helpers for the signal rules. Not exported from the package. */
import { subtractTradingDays } from '../calendar';
import type { StoredClose } from '../market/price-board';
import { addQuarters } from '../market/quarters';
import { DEFAULT_MARKET_RULES } from '../settings/market-rules';
import { DEFAULT_SIGNAL_RULES } from './config';
import type { EpsBasis, RuleContext, StoredFinancials, SymbolData } from './types';

export const SIGNAL_DATE = '2026-10-26'; // Monday; latest expected quarter is 2026Q2
export const LATEST_PERIOD = '2026Q2';
export const FETCHED = '2026-10-25T10:00:00.000Z';

export function tradingDates(end: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(subtractTradingDays(end, i, []));
  return out;
}

export function closes(symbol: string, end: string, n: number, close: (i: number) => number = () => 10_000): StoredClose[] {
  return tradingDates(end, n).map((tradeDate, i) => ({
    symbol,
    tradeDate,
    close: close(i),
    volume: 1000,
    source: 'fake-prices',
    fetchedAt: '2026-10-26T11:30:00.000Z',
  }));
}

export function fin(symbol: string, period: string, over: Partial<StoredFinancials> = {}): StoredFinancials {
  return { symbol, period, eps: 1000, bvps: 10_000, revenue: 1_000_000_000, netIncome: 100_000_000, source: 'fake-fin', fetchedAt: FETCHED, ...over };
}

/** `n` consecutive quarters ending at `end`, oldest first. */
export function quarters(symbol: string, end: string, n: number, over: (i: number) => Partial<StoredFinancials> = () => ({})): StoredFinancials[] {
  const out: StoredFinancials[] = [];
  for (let i = 0; i < n; i++) out.push(fin(symbol, addQuarters(end, -(n - 1 - i)), over(i)));
  return out;
}

export function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    signalDate: SIGNAL_DATE,
    holidays: [],
    rules: DEFAULT_SIGNAL_RULES,
    publishLagDays: 45,
    priceGaps: [],
    financialsGaps: [],
    epsBasisBySource: { 'fake-fin': 'quarterly' as EpsBasis },
    priceLimitPpm: DEFAULT_MARKET_RULES.priceLimitPpm,
    ...over,
  };
}

/** A symbol with fresh price, `nq` quarters and a sector. */
export function symbolData(symbol: string, o: { close?: number; eps?: number; bvps?: number; nq?: number; sector?: string | null } = {}): SymbolData {
  return {
    closes: closes(symbol, SIGNAL_DATE, 3, () => o.close ?? 15_000),
    financials: quarters(symbol, LATEST_PERIOD, o.nq ?? 4, () => ({ eps: o.eps ?? 1000, bvps: o.bvps ?? 10_000 })),
    sector: o.sector === null ? { sector: null, source: null, fetchedAt: null } : { sector: o.sector ?? 'Banks', source: 'fake-fin', fetchedAt: FETCHED },
    exchange: 'HOSE',
    corporateActions: [],
  };
}

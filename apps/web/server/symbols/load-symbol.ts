import {
  resolveConcentrationThreshold,
  DEFAULT_CHART_RANGE,
  DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  DEFAULT_TICK_BANDS,
  FINANCIALS_GAP_TYPE,
  PRICES_GAP_TYPE,
  buildChartSeries,
  buildLedger,
  buildPortfolio,
  buildPriceBoardRow,
  chartWindow,
  expectedPriceDate,
  expectedRuleIds,
  presentMediumSignals,
  vnDateOf,
} from '@stoktok/core';
import type {
  ChartRange,
  ChartSeries,
  Holding,
  LedgerError,
  Lot,
  PortfolioRow,
  SignalsSectionVM,
  Transaction,
} from '@stoktok/core';
import { listHref } from '../../lib/transaction-list-query';
import {
  getEntrySettings,
  getMarketRules,
  getFirstPriceDates,
  getRecentCloses,
  getSignalRules,
  getSymbolExchanges,
  listCloseHistory,
  listCorporateActions,
  listLatestSignals,
  listOpenGaps,
  listOpenMarketGaps,
  listTransactions,
  listWatchlist,
} from '../db';
import type { Db } from '../db';
import type { WatchRow } from '../watchlist/load-watchlist';

export const RECENT_TX_LIMIT = 10;

export type SymbolPosition =
  | { kind: 'ledgerError'; error: LedgerError }
  | { kind: 'none' }
  | { kind: 'closed'; holding: Holding }
  | { kind: 'open'; holding: Holding; row: PortfolioRow; lots: Lot[]; settlementDays: number };

export interface SymbolView {
  symbol: string;
  header: WatchRow;
  /** UPCoM reference is the previous close, an estimate (the real one is the previous average price). */
  refEstimated: boolean;
  position: SymbolPosition;
  /** Newest first, capped at RECENT_TX_LIMIT. */
  transactions: Transaction[];
  transactionCount: number;
  ledgerHref: string;
  chart: ChartSeries;
  chartRange: ChartRange;
  signals: SignalsSectionVM;
}

/**
 * Reads stored data and delegates every calculation to core (R1).
 * Callers must call requireUser() first (R6).
 * Returns null when the symbol is unknown everywhere (symbols, watchlist, ledger, corporate actions, prices).
 */
export async function loadSymbol(
  db: Db,
  symbol: string,
  now: Date,
  range: ChartRange = DEFAULT_CHART_RANGE,
): Promise<SymbolView | null> {
  const [txs, cas, entry, watchlist, rules, exchanges, closes, firstDates] = await Promise.all([
    listTransactions(db),
    listCorporateActions(db),
    getEntrySettings(db),
    listWatchlist(db),
    getMarketRules(db),
    getSymbolExchanges(db, [symbol]),
    getRecentCloses(db, [symbol], 2),
    getFirstPriceDates(db, [symbol]),
  ]);

  const symbolTxs = txs.filter((t) => t.symbol === symbol);
  const symbolCas = cas.filter((c) => c.symbol === symbol);
  const bars = closes[symbol] ?? [];
  const known =
    symbol in exchanges ||
    watchlist.some((w) => w.symbol === symbol) ||
    symbolTxs.length > 0 ||
    symbolCas.length > 0 ||
    bars.length > 0;
  if (!known) return null;

  const expected = expectedPriceDate(now, entry.settings.holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);
  const exchange = exchanges[symbol] ?? null;
  const board = buildPriceBoardRow({
    symbol,
    bars,
    exchange,
    rules,
    tickBands: DEFAULT_TICK_BANDS,
    expectedDate: expected,
    holidays: entry.settings.holidays,
    exDates: symbolCas.map((c) => c.exDate),
  });
  const header: WatchRow = { ...board, priceDateDiffers: board.tradeDate !== null && board.tradeDate !== expected };

  const win = chartWindow({ endDate: expected, range, firstStoredDate: firstDates[symbol] ?? null });
  const [history, priceSymbolGaps, priceMarketGaps, financialsSymbolGaps, financialsMarketGaps, signalRules] = await Promise.all([
    win.from > win.to ? [] : listCloseHistory(db, symbol, win.from, win.to),
    listOpenGaps(db, PRICES_GAP_TYPE, [symbol]),
    listOpenMarketGaps(db, PRICES_GAP_TYPE),
    listOpenGaps(db, FINANCIALS_GAP_TYPE, [symbol]),
    listOpenMarketGaps(db, FINANCIALS_GAP_TYPE),
    getSignalRules(db),
  ]);
  const priceGaps = [...priceSymbolGaps, ...priceMarketGaps];
  const chart = buildChartSeries({
    bars: history,
    openGaps: win.from > win.to ? [] : priceGaps,
    window: win,
    holidays: entry.settings.holidays,
  });

  const ruleIds = expectedRuleIds(signalRules);
  const signals = presentMediumSignals({
    ruleIds,
    rows: await listLatestSignals(db, symbol, ruleIds),
    ctx: {
      expectedDate: expected,
      holidays: entry.settings.holidays,
      publishLagDays: DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
      rules: signalRules,
      priceGaps,
      financialsGaps: [...financialsSymbolGaps, ...financialsMarketGaps],
    },
  });

  const ledger = buildLedger(txs, cas, entry.settings, vnDateOf(now));
  let position: SymbolPosition;
  if (!ledger.ok) {
    position = { kind: 'ledgerError', error: ledger.error };
  } else {
    const holding = ledger.value.holdings.find((h) => h.symbol === symbol);
    if (!holding) position = { kind: 'none' };
    else if (holding.quantity === 0) position = { kind: 'closed', holding };
    else {
      const last = bars[0];
      const row = buildPortfolio({
        holdings: [holding],
        quotes: last ? { [symbol]: last } : {},
        assets: [],
        expectedPriceDate: expected,
        concentrationThresholdPpm: resolveConcentrationThreshold(null),
      }).rows[0];
      position = {
        kind: 'open',
        holding,
        row: row as PortfolioRow,
        lots: ledger.value.lots.filter((l) => l.symbol === symbol && l.quantityRemaining > 0),
        settlementDays: entry.settings.settlementDays,
      };
    }
  }

  return {
    symbol,
    header,
    refEstimated: exchange === 'UPCOM',
    position,
    transactions: [...symbolTxs].reverse().slice(0, RECENT_TX_LIMIT),
    transactionCount: symbolTxs.length,
    ledgerHref: listHref({ page: 1, symbol }),
    chart,
    chartRange: range,
    signals,
  };
}

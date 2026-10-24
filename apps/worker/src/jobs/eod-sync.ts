import {
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  expectedPriceDate,
  normalizeSymbol,
  subtractTradingDays,
  vnDateOf,
} from '@stoktok/core';
import type { Result } from '@stoktok/core';
import type { PriceDailyInsert } from '@stoktok/db';
import type { EodSyncConfig } from '../config';
import type { PriceSource } from '../sources/price-source';

export interface EodStore {
  getHolidays(): Promise<readonly string[]>;
  listWatchlistSymbols(): Promise<string[]>;
  listHeldSymbols(asOf: string): Promise<Result<string[]>>;
  /** Latest stored close per symbol (integer VND); symbols without a row are omitted. */
  getLatestCloses(symbols: readonly string[]): Promise<Record<string, number>>;
  upsertPricesDaily(rows: PriceDailyInsert[]): Promise<number>;
}

export interface EodDeps {
  store: EodStore;
  source: PriceSource;
  now: Date;
  config: EodSyncConfig;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  dryRun: boolean;
}

export interface EodSummary {
  /** False on any source failure, skipped symbol, ledger error or rejected bar. */
  ok: boolean;
  dryRun: boolean;
  source: string;
  fetchedAt: string;
  targetDate: string;
  fromDate: string;
  symbols: string[];
  barsFetched: number;
  rowsUpserted: number;
  rejected: number;
  rejectedBySymbol: Record<string, { tradeDate?: string; reason: string }[]>;
  failedSymbols: string[];
  skippedSymbols: string[];
  symbolsWithoutBars: string[];
  ledgerError?: string;
}

/** Orchestration only: dates, validation and conversion live in core (R1, R2). */
export async function runEodSync(deps: EodDeps): Promise<EodSummary> {
  const { store, source, now, config, log } = deps;
  const holidays = await store.getHolidays();
  const targetDate = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);
  const fromDate = subtractTradingDays(targetDate, config.lookbackTradingDays - 1, holidays);
  const fetchedAt = now.toISOString();

  const raw = await store.listWatchlistSymbols();
  const held = await store.listHeldSymbols(vnDateOf(now));
  let ledgerError: string | undefined;
  if (held.ok) raw.push(...held.value);
  else ledgerError = held.error.code;
  const set = new Set<string>();
  for (const r of raw) {
    const s = normalizeSymbol(r);
    if (s) set.add(s);
    else log(`warn: skipping invalid symbol`);
  }
  const symbols = [...set].sort();

  const lastCloses = await store.getLatestCloses(symbols);
  const rows: PriceDailyInsert[] = [];
  const rejectedBySymbol: EodSummary['rejectedBySymbol'] = {};
  const failedSymbols: string[] = [];
  const skippedSymbols: string[] = [];
  const symbolsWithoutBars: string[] = [];
  let barsFetched = 0;
  let rejected = 0;
  let consecutiveFailures = 0;

  for (const [i, symbol] of symbols.entries()) {
    if (consecutiveFailures >= config.maxConsecutiveFailures) {
      skippedSymbols.push(symbol);
      continue;
    }
    if (i > 0) await deps.sleep(config.requestDelayMs);
    try {
      const ctx = lastCloses[symbol] !== undefined ? { lastClose: lastCloses[symbol] } : {};
      const res = await source.fetchDaily(symbol, fromDate, targetDate, ctx);
      consecutiveFailures = 0;
      barsFetched += res.bars.length;
      if (res.bars.length === 0) symbolsWithoutBars.push(symbol);
      if (res.rejected.length > 0) {
        rejected += res.rejected.length;
        rejectedBySymbol[symbol] = res.rejected;
      }
      for (const b of res.bars) {
        rows.push({
          symbol: b.symbol,
          trade_date: b.tradeDate,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          foreign_net: b.foreignNet,
          source: source.name,
          fetched_at: fetchedAt,
        });
      }
    } catch (e) {
      consecutiveFailures += 1;
      failedSymbols.push(symbol);
      log(`error: ${symbol}: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  const rowsUpserted = deps.dryRun ? 0 : await store.upsertPricesDaily(rows);
  return {
    ok: failedSymbols.length === 0 && skippedSymbols.length === 0 && rejected === 0 && ledgerError === undefined,
    dryRun: deps.dryRun,
    source: source.name,
    fetchedAt,
    targetDate,
    fromDate,
    symbols,
    barsFetched,
    rowsUpserted,
    rejected,
    rejectedBySymbol,
    failedSymbols,
    skippedSymbols,
    symbolsWithoutBars,
    ...(ledgerError !== undefined ? { ledgerError } : {}),
  };
}

import {
  DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  addQuarters,
  evaluateMediumSignals,
  expectedPriceDate,
  latestExpectedPeriod,
  normalizeSymbol,
  resolveSignalDate,
  vnDateOf,
} from '@stoktok/core';
import type { EpsBasis, Result, SectorInfo, SignalRules, StoredClose } from '@stoktok/core';
import type { FinancialRecord, OpenGapRecord, SignalInsert } from '@stoktok/db';
import { FINANCIALS_GAP_TYPE } from './financials-sync';

/** data_gaps.data_type for daily prices; the price backfill (STK-031) should reuse it. */
export const PRICES_GAP_TYPE = 'prices_daily';

export interface SignalsStore {
  getHolidays(): Promise<readonly string[]>;
  getSignalRules(): Promise<SignalRules>;
  listWatchlistSymbols(): Promise<string[]>;
  listHeldSymbols(asOf: string): Promise<Result<string[]>>;
  /** Last `n` stored closes per symbol, newest first. */
  getRecentCloses(symbols: readonly string[], n: number): Promise<Record<string, StoredClose[]>>;
  /** Stored quarters from `fromPeriod` on. */
  listFinancials(symbols: readonly string[], fromPeriod: string): Promise<FinancialRecord[]>;
  listSymbolSectors(symbols: readonly string[]): Promise<Record<string, SectorInfo>>;
  /** Open gaps of the symbols. */
  listOpenGaps(dataType: string, symbols: readonly string[]): Promise<OpenGapRecord[]>;
  /** Open market-wide gaps (symbol null). */
  listOpenMarketGaps(dataType: string): Promise<OpenGapRecord[]>;
  upsertSignals(rows: SignalInsert[]): Promise<number>;
}

export interface SignalsDeps {
  store: SignalsStore;
  now: Date;
  log: (message: string) => void;
  dryRun: boolean;
  /** EPS basis declared by each financials source (docs/adr/0002). */
  epsBasisBySource: Readonly<Record<string, EpsBasis>>;
}

export interface SignalsSummary {
  /** False only when the ledger could not be read. Suppressed signals do not fail a run. */
  ok: boolean;
  dryRun: boolean;
  signalDate: string;
  expectedDate: string;
  symbols: string[];
  results: number;
  okCount: number;
  suppressedCount: number;
  suppressedByReason: Record<string, number>;
  rowsUpserted: number;
  ledgerError?: string;
}

/** Orchestration only: every rule, check and date decision lives in core (R1, R2, R4). */
export async function runMediumSignals(deps: SignalsDeps): Promise<SignalsSummary> {
  const { store, now, log } = deps;
  const holidays = await store.getHolidays();
  const rules = await store.getSignalRules();
  const expectedDate = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);

  const raw = await store.listWatchlistSymbols();
  const held = await store.listHeldSymbols(vnDateOf(now));
  let ledgerError: string | undefined;
  if (held.ok) raw.push(...held.value);
  else ledgerError = held.error.code;
  const set = new Set<string>();
  for (const r of raw) {
    const s = normalizeSymbol(r);
    if (s) set.add(s);
    else log('warn: skipping invalid symbol');
  }
  const symbols = [...set].sort();

  const closes = await store.getRecentCloses(symbols, rules.priceVsMa.longDays);
  const newest = symbols.flatMap((s) => closes[s]?.map((c) => c.tradeDate) ?? []);
  const signalDate = resolveSignalDate(expectedDate, newest);

  const latestPeriod = latestExpectedPeriod(signalDate, DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS);
  const fromPeriod = addQuarters(latestPeriod, -(Math.max(4, rules.earningsGrowth.comparisons + 4) - 1));
  const financials = await store.listFinancials(symbols, fromPeriod);
  const sectors = await store.listSymbolSectors(symbols);
  const priceGaps = [
    ...(await store.listOpenGaps(PRICES_GAP_TYPE, symbols)),
    ...(await store.listOpenMarketGaps(PRICES_GAP_TYPE)),
  ];
  const financialsGaps = [
    ...(await store.listOpenGaps(FINANCIALS_GAP_TYPE, symbols)),
    ...(await store.listOpenMarketGaps(FINANCIALS_GAP_TYPE)),
  ];

  const results = evaluateMediumSignals({
    signalDate,
    holidays,
    rules,
    publishLagDays: DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
    symbols,
    closes,
    financials,
    sectors,
    priceGaps,
    financialsGaps,
    epsBasisBySource: deps.epsBasisBySource,
  });

  const computedAt = now.toISOString();
  const rows: SignalInsert[] = results.map((r) => ({
    symbol: r.symbol,
    rule_id: r.ruleId,
    horizon: r.horizon,
    signal_date: r.signalDate,
    status: r.status,
    label: r.label,
    value: r.value,
    data_fresh: r.dataFresh,
    reason_codes: r.reasons,
    inputs_snapshot: r.inputs,
    rule_version: r.ruleVersion,
    computed_at: computedAt,
  }));
  const suppressedByReason: Record<string, number> = {};
  for (const r of results) for (const code of r.reasons) suppressedByReason[code] = (suppressedByReason[code] ?? 0) + 1;

  const rowsUpserted = deps.dryRun ? 0 : await store.upsertSignals(rows);
  const okCount = results.filter((r) => r.status === 'ok').length;
  return {
    ok: ledgerError === undefined,
    dryRun: deps.dryRun,
    signalDate,
    expectedDate,
    symbols,
    results: results.length,
    okCount,
    suppressedCount: results.length - okCount,
    suppressedByReason,
    rowsUpserted,
    ...(ledgerError !== undefined ? { ledgerError } : {}),
  };
}

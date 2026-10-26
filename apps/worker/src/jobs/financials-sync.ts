import { addQuarters, comparePeriods, latestExpectedPeriod, normalizeSymbol, planFinancialGaps, quarterBounds, vnDateOf } from '@stoktok/core';
import type { Result } from '@stoktok/core';
import type { DataGapInsert, FinancialInsert, FinancialRecord, OpenGapRecord } from '@stoktok/db';
import type { FinancialsSyncConfig } from '../config';
import type { FinancialsSource, RejectedPeriod } from '../sources/financials-source';

export const FINANCIALS_GAP_TYPE = 'financials';

export interface FinancialsStore {
  listWatchlistSymbols(): Promise<string[]>;
  listHeldSymbols(asOf: string): Promise<Result<string[]>>;
  /** Stored quarters from `fromPeriod` on. */
  listFinancials(symbols: readonly string[], fromPeriod: string): Promise<FinancialRecord[]>;
  upsertFinancials(rows: FinancialInsert[]): Promise<number>;
  listOpenGaps(symbols: readonly string[]): Promise<OpenGapRecord[]>;
  insertGaps(rows: DataGapInsert[]): Promise<void>;
  resolveGaps(ids: number[], resolvedAt: string): Promise<void>;
  setSymbolSector(symbol: string, v: { sector: string; source: string; fetchedAt: string }): Promise<void>;
}

export interface FinancialsDeps {
  store: FinancialsStore;
  source: FinancialsSource;
  now: Date;
  config: FinancialsSyncConfig;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  dryRun: boolean;
}

export interface FinancialsSummary {
  /** False on any failed or skipped symbol, rejected period, sector fetch error or ledger error. */
  ok: boolean;
  dryRun: boolean;
  source: string;
  fetchedAt: string;
  windowStart: string;
  windowEnd: string;
  symbols: string[];
  periodsFetched: number;
  rowsUpserted: number;
  rejected: number;
  rejectedBySymbol: Record<string, RejectedPeriod[]>;
  /** 'SYM 2026Q2: eps,revenue': stored values that changed on re-sync. */
  restated: string[];
  /** Missing quarters found per symbol (reported on dry-run too). */
  missingPeriods: Record<string, string[]>;
  gapsRecorded: number;
  gapsResolved: number;
  sectorsUpdated: number;
  sectorMissing: string[];
  sectorFailedSymbols: string[];
  failedSymbols: string[];
  skippedSymbols: string[];
  symbolsWithoutData: string[];
  ledgerError?: string;
}

const FIELDS = ['eps', 'bvps', 'revenue', 'netIncome'] as const;
const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** Orchestration only: conversion, guards and gap math live in core (R1, R2). */
export async function runFinancialsSync(deps: FinancialsDeps): Promise<FinancialsSummary> {
  const { store, source, now, config, log } = deps;
  const fetchedAt = now.toISOString();
  const windowEnd = latestExpectedPeriod(vnDateOf(now), config.publishLagDays);
  const windowStart = addQuarters(windowEnd, -(config.lookbackQuarters - 1));

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

  const stored = await store.listFinancials(symbols, windowStart);
  const openGaps = await store.listOpenGaps(symbols);
  const rows: FinancialInsert[] = [];
  const gapRows: DataGapInsert[] = [];
  const resolveIds: number[] = [];
  const rejectedBySymbol: FinancialsSummary['rejectedBySymbol'] = {};
  const restated: string[] = [];
  const missingPeriods: Record<string, string[]> = {};
  const sectors: { symbol: string; sector: string }[] = [];
  const sectorMissing: string[] = [];
  const sectorFailedSymbols: string[] = [];
  const failedSymbols: string[] = [];
  const skippedSymbols: string[] = [];
  const symbolsWithoutData: string[] = [];
  let periodsFetched = 0;
  let rejected = 0;
  let consecutiveFailures = 0;

  for (const [i, symbol] of symbols.entries()) {
    if (consecutiveFailures >= config.maxConsecutiveFailures) {
      skippedSymbols.push(symbol);
      continue;
    }
    if (i > 0) await deps.sleep(config.requestDelayMs);
    let res;
    try {
      res = await source.fetchQuarterly(symbol);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures += 1;
      failedSymbols.push(symbol);
      log(`error: ${symbol}: ${msg(e)}`);
      continue;
    }

    const storedHere = new Map(stored.filter((s) => s.symbol === symbol).map((s) => [s.period, s]));
    const kept = res.periods.filter((p) => comparePeriods(p.period, windowStart) >= 0);
    periodsFetched += kept.length;
    if (res.periods.length === 0 && res.rejected.length === 0 && storedHere.size === 0) symbolsWithoutData.push(symbol);
    if (res.rejected.length > 0) {
      rejected += res.rejected.length;
      rejectedBySymbol[symbol] = res.rejected;
    }
    for (const p of kept) {
      const old = storedHere.get(p.period);
      const changed = old ? FIELDS.filter((f) => old[f] !== p[f]) : [];
      if (changed.length > 0) {
        const line = `${symbol} ${p.period}: ${changed.join(',')}`;
        restated.push(line);
        log(`restated ${line}`);
      }
      rows.push({
        symbol: p.symbol,
        period: p.period,
        eps: p.eps,
        bvps: p.bvps,
        revenue: p.revenue,
        net_income: p.netIncome,
        source: source.name,
        fetched_at: fetchedAt,
      });
    }

    // Gaps: a quarter is known if stored, fetched or rejected with a period; present only if stored or valid.
    const present = new Set([...storedHere.keys(), ...kept.map((p) => p.period)]);
    const known = [...present, ...res.rejected.flatMap((r) => (r.period !== undefined ? [r.period] : []))];
    const plan = planFinancialGaps({
      windowStart,
      windowEnd,
      knownPeriods: known,
      presentPeriods: [...present],
      openGaps: openGaps.filter((g) => g.symbol === symbol),
    });
    if (plan.toRecord.length > 0) {
      missingPeriods[symbol] = plan.toRecord;
      log(`missing ${symbol}: ${plan.toRecord.join(',')}`);
      for (const period of plan.toRecord) {
        const b = quarterBounds(period);
        gapRows.push({ symbol, data_type: FINANCIALS_GAP_TYPE, from_ts: b.fromTs, to_ts: b.toTs, source: source.name, fetched_at: fetchedAt });
      }
    }
    resolveIds.push(...plan.toResolve);

    try {
      await deps.sleep(config.requestDelayMs);
      const sector = await source.fetchSector(symbol);
      if (sector === null) sectorMissing.push(symbol);
      else sectors.push({ symbol, sector });
    } catch (e) {
      sectorFailedSymbols.push(symbol);
      log(`error: sector ${symbol}: ${msg(e)}`);
    }
  }

  let rowsUpserted = 0;
  let sectorsUpdated = 0;
  if (!deps.dryRun) {
    rowsUpserted = await store.upsertFinancials(rows);
    for (const s of sectors) {
      await store.setSymbolSector(s.symbol, { sector: s.sector, source: source.name, fetchedAt });
      sectorsUpdated += 1;
    }
    // After the upsert, so a crash between the two leaves no gap without its rows.
    await store.insertGaps(gapRows);
    await store.resolveGaps(resolveIds, fetchedAt);
  }
  return {
    ok:
      failedSymbols.length === 0 &&
      skippedSymbols.length === 0 &&
      rejected === 0 &&
      sectorFailedSymbols.length === 0 &&
      ledgerError === undefined,
    dryRun: deps.dryRun,
    source: source.name,
    fetchedAt,
    windowStart,
    windowEnd,
    symbols,
    periodsFetched,
    rowsUpserted,
    rejected,
    rejectedBySymbol,
    restated,
    missingPeriods,
    gapsRecorded: deps.dryRun ? 0 : gapRows.length,
    gapsResolved: deps.dryRun ? 0 : resolveIds.length,
    sectorsUpdated,
    sectorMissing,
    sectorFailedSymbols,
    failedSymbols,
    skippedSymbols,
    symbolsWithoutData,
    ...(ledgerError !== undefined ? { ledgerError } : {}),
  };
}

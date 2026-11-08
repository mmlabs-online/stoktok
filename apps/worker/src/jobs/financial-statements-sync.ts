import {
  FINANCIAL_LINES_ANNUAL_GAP_TYPE,
  FINANCIAL_LINES_GAP_TYPE,
  addQuarters,
  isPeriodInWindow,
  latestExpectedPeriod,
  latestExpectedYear,
  normalizeSymbol,
  planAnnualGaps,
  planFinancialGaps,
  quarterBounds,
  vnDateOf,
  yearBounds,
} from '@stoktok/core';
import type { Result } from '@stoktok/core';
import type { DataGapInsert, FinancialLineInsert, FinancialLineRecord, OpenGapRecord } from '@stoktok/db';
import type { FinancialStatementsSyncConfig } from '../config';
import type { FinancialStatementsSource, RejectedPeriod } from '../sources/financials-source';

export { FINANCIAL_LINES_ANNUAL_GAP_TYPE, FINANCIAL_LINES_GAP_TYPE };

export interface FinancialStatementsStore {
  listWatchlistSymbols(): Promise<string[]>;
  listHeldSymbols(asOf: string): Promise<Result<string[]>>;
  /** Stored lines of one period kind from `fromPeriod` on. */
  listFinancialLines(symbols: readonly string[], periodKind: 'quarter' | 'year', fromPeriod: string): Promise<FinancialLineRecord[]>;
  upsertFinancialLines(rows: FinancialLineInsert[]): Promise<number>;
  listOpenGaps(dataType: string, symbols: readonly string[]): Promise<OpenGapRecord[]>;
  insertGaps(rows: DataGapInsert[]): Promise<void>;
  resolveGaps(ids: number[], resolvedAt: string): Promise<void>;
}

export interface FinancialStatementsDeps {
  store: FinancialStatementsStore;
  source: FinancialStatementsSource;
  now: Date;
  config: FinancialStatementsSyncConfig;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  dryRun: boolean;
}

export interface FinancialStatementsSummary {
  /** False on any failed or skipped symbol, in-window failing reject or ledger error. */
  ok: boolean;
  dryRun: boolean;
  source: string;
  fetchedAt: string;
  windowStart: string;
  windowEnd: string;
  yearWindowStart: string;
  yearWindowEnd: string;
  symbols: string[];
  /** Quarter and year periods fetched inside the windows. */
  periodsFetched: number;
  linesUpserted: number;
  /** In-window rejects that are not in `config.nonFailingRejectReasons`; any of these fails the run. */
  rejected: number;
  rejectedBySymbol: Record<string, RejectedPeriod[]>;
  rejectedOutOfWindow: number;
  rejectedOutOfWindowBySymbol: Record<string, RejectedPeriod[]>;
  rejectedNonFailing: number;
  unsupportedSymbols: string[];
  /** 'SYM 2026Q2: gross_profit': stored values that changed on re-sync. */
  restated: string[];
  /** '2026Q2:gross_profit' per symbol: mapped lines absent from a period (reported on dry-run too). */
  missingLines: Record<string, string[]>;
  missingPeriods: Record<string, string[]>;
  missingYears: Record<string, string[]>;
  gapsRecorded: number;
  gapsResolved: number;
  failedSymbols: string[];
  skippedSymbols: string[];
  symbolsWithoutData: string[];
  ledgerError?: string;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** Orchestration only: conversion, guards and gap math live in core (R1, R2). */
export async function runFinancialStatementsSync(deps: FinancialStatementsDeps): Promise<FinancialStatementsSummary> {
  const { store, source, now, config, log } = deps;
  const fetchedAt = now.toISOString();
  const today = vnDateOf(now);
  const windowEnd = latestExpectedPeriod(today, config.publishLagDays);
  const windowStart = addQuarters(windowEnd, -(config.lookbackQuarters - 1));
  const yearWindowEnd = latestExpectedYear(today, config.annualPublishLagDays);
  const yearWindowStart = String(Number(yearWindowEnd) - (config.lookbackYears - 1));
  const windows = {
    quarter: { start: windowStart, end: windowEnd },
    year: { start: yearWindowStart, end: yearWindowEnd },
  } as const;

  const raw = await store.listWatchlistSymbols();
  const held = await store.listHeldSymbols(today);
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

  const storedQ = await store.listFinancialLines(symbols, 'quarter', windowStart);
  const storedY = await store.listFinancialLines(symbols, 'year', yearWindowStart);
  const openQ = await store.listOpenGaps(FINANCIAL_LINES_GAP_TYPE, symbols);
  const openY = await store.listOpenGaps(FINANCIAL_LINES_ANNUAL_GAP_TYPE, symbols);
  const rows: FinancialLineInsert[] = [];
  const gapRows: DataGapInsert[] = [];
  const resolveIds: number[] = [];
  const rejectedBySymbol: FinancialStatementsSummary['rejectedBySymbol'] = {};
  const rejectedOutOfWindowBySymbol: FinancialStatementsSummary['rejectedOutOfWindowBySymbol'] = {};
  const unsupportedSymbols: string[] = [];
  const restated: string[] = [];
  const missingLines: Record<string, string[]> = {};
  const missingPeriods: Record<string, string[]> = {};
  const missingYears: Record<string, string[]> = {};
  const failedSymbols: string[] = [];
  const skippedSymbols: string[] = [];
  const symbolsWithoutData: string[] = [];
  let periodsFetched = 0;
  let rejected = 0;
  let rejectedOutOfWindow = 0;
  let rejectedNonFailing = 0;
  let consecutiveFailures = 0;

  for (const [i, symbol] of symbols.entries()) {
    if (consecutiveFailures >= config.maxConsecutiveFailures) {
      skippedSymbols.push(symbol);
      continue;
    }
    if (i > 0) await deps.sleep(config.requestDelayMs);
    let res;
    try {
      res = await source.fetchStatements(symbol);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures += 1;
      failedSymbols.push(symbol);
      log(`error: ${symbol}: ${msg(e)}`);
      continue;
    }

    const storedAll = [...storedQ, ...storedY].filter((s) => s.symbol === symbol);
    if (res.periods.length === 0 && res.rejected.length === 0 && storedAll.length === 0) symbolsWithoutData.push(symbol);
    for (const r of res.rejected) {
      const win = r.period === undefined ? undefined : r.period.length === 4 ? windows.year : windows.quarter;
      if (config.nonFailingRejectReasons.includes(r.reason)) {
        rejectedNonFailing += 1;
        if (!unsupportedSymbols.includes(symbol)) {
          unsupportedSymbols.push(symbol);
          log(`unsupported ${symbol}: ${r.reason}`);
        }
      } else if (r.period !== undefined && win !== undefined && !isPeriodInWindow(r.period, win.start, win.end)) {
        rejectedOutOfWindow += 1;
        (rejectedOutOfWindowBySymbol[symbol] ??= []).push(r);
      } else {
        rejected += 1;
        (rejectedBySymbol[symbol] ??= []).push(r);
      }
    }

    for (const kind of ['quarter', 'year'] as const) {
      const win = windows[kind];
      const storedHere = new Map<string, Map<string, number>>();
      for (const s of kind === 'quarter' ? storedQ : storedY) {
        if (s.symbol !== symbol) continue;
        let lines = storedHere.get(s.period);
        if (!lines) storedHere.set(s.period, (lines = new Map()));
        lines.set(s.line, s.value);
      }
      const kept = res.periods.filter((p) => p.periodKind === kind && p.period >= win.start);
      periodsFetched += kept.length;
      const keptByPeriod = new Map(kept.map((p) => [p.period, p]));

      for (const p of kept) {
        const old = storedHere.get(p.period);
        const changed = old ? p.values.filter((v) => old.has(v.line) && old.get(v.line) !== v.value).map((v) => v.line) : [];
        if (changed.length > 0) {
          const line = `${symbol} ${p.period}: ${changed.join(',')}`;
          restated.push(line);
          log(`restated ${line}`);
        }
        for (const v of p.values) {
          rows.push({ symbol, period_kind: kind, period: p.period, statement: v.statement, line: v.line, value: v.value, source: source.name, fetched_at: fetchedAt });
        }
      }

      // Present: every mapped line is stored or freshly valid. Known: stored, fetched, or rejected with a period of this kind.
      const present: string[] = [];
      for (const period of new Set([...storedHere.keys(), ...keptByPeriod.keys()])) {
        const have = new Set([...(storedHere.get(period)?.keys() ?? []), ...(keptByPeriod.get(period)?.values.map((v) => v.line) ?? [])]);
        const absent = res.expectedLines.filter((l) => !have.has(l));
        if (res.expectedLines.length > 0 && absent.length === 0) present.push(period);
        else if (keptByPeriod.has(period) && absent.length > 0) {
          (missingLines[symbol] ??= []).push(...absent.map((l) => `${period}:${l}`));
        }
      }
      const known = [
        ...storedHere.keys(),
        ...keptByPeriod.keys(),
        ...res.rejected.flatMap((r) => (r.period !== undefined && (r.period.length === 4) === (kind === 'year') ? [r.period] : [])),
      ];
      const input = { windowStart: win.start, windowEnd: win.end, knownPeriods: known, presentPeriods: present, openGaps: (kind === 'quarter' ? openQ : openY).filter((g) => g.symbol === symbol) };
      const plan = kind === 'quarter' ? planFinancialGaps(input) : planAnnualGaps(input);
      if (plan.toRecord.length > 0) {
        (kind === 'quarter' ? missingPeriods : missingYears)[symbol] = plan.toRecord;
        log(`missing ${kind}s ${symbol}: ${plan.toRecord.join(',')}`);
        for (const period of plan.toRecord) {
          const b = kind === 'quarter' ? quarterBounds(period) : yearBounds(period);
          gapRows.push({
            symbol,
            data_type: kind === 'quarter' ? FINANCIAL_LINES_GAP_TYPE : FINANCIAL_LINES_ANNUAL_GAP_TYPE,
            from_ts: b.fromTs,
            to_ts: b.toTs,
            source: source.name,
            fetched_at: fetchedAt,
          });
        }
      }
      resolveIds.push(...plan.toResolve);
    }
  }

  let linesUpserted = 0;
  if (!deps.dryRun) {
    linesUpserted = await store.upsertFinancialLines(rows);
    // After the upsert, so a crash between the two leaves no gap without its rows.
    await store.insertGaps(gapRows);
    await store.resolveGaps(resolveIds, fetchedAt);
  }
  return {
    ok: failedSymbols.length === 0 && skippedSymbols.length === 0 && rejected === 0 && ledgerError === undefined,
    dryRun: deps.dryRun,
    source: source.name,
    fetchedAt,
    windowStart,
    windowEnd,
    yearWindowStart,
    yearWindowEnd,
    symbols,
    periodsFetched,
    linesUpserted,
    rejected,
    rejectedBySymbol,
    rejectedOutOfWindow,
    rejectedOutOfWindowBySymbol,
    rejectedNonFailing,
    unsupportedSymbols,
    restated,
    missingLines,
    missingPeriods,
    missingYears,
    gapsRecorded: deps.dryRun ? 0 : gapRows.length,
    gapsResolved: deps.dryRun ? 0 : resolveIds.length,
    failedSymbols,
    skippedSymbols,
    symbolsWithoutData,
    ...(ledgerError !== undefined ? { ledgerError } : {}),
  };
}

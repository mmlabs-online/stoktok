import { DEFAULT_PRICE_CUTOFF_MINUTES_VN, expectedPriceDate, subtractTradingDays } from '@stoktok/core';
import type { DailyBar, Result } from '@stoktok/core';
import type { PriceDailyInsert } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { EOD_SYNC_CONFIG } from '../config';
import { SourceError } from '../sources/price-source';
import type { FetchResult, PriceSource } from '../sources/price-source';
import { runEodSync } from './eod-sync';
import type { EodStore } from './eod-sync';

const AFTER_CUTOFF = new Date('2026-10-23T12:00:00Z'); // Fri 19:00 VN
const BEFORE_CUTOFF = new Date('2026-10-23T08:00:00Z'); // Fri 15:00 VN

function memoryStore(opts: { watchlist?: string[]; held?: Result<string[]>; holidays?: string[]; closes?: Record<string, number> } = {}) {
  const table = new Map<string, PriceDailyInsert>();
  let upsertCalls = 0;
  const closesAsked: string[][] = [];
  const store: EodStore = {
    getHolidays: async () => opts.holidays ?? [],
    listWatchlistSymbols: async () => [...(opts.watchlist ?? [])],
    listHeldSymbols: async () => opts.held ?? { ok: true, value: [] },
    getLatestCloses: async (symbols) => {
      closesAsked.push([...symbols]);
      return opts.closes ?? {};
    },
    upsertPricesDaily: async (rows) => {
      upsertCalls += 1;
      for (const r of rows) table.set(`${r.symbol}|${r.trade_date}`, r);
      return rows.length;
    },
  };
  return { store, table, closesAsked, upserts: () => upsertCalls };
}

const bar = (symbol: string, tradeDate: string, close = 10000): DailyBar => ({
  symbol, tradeDate, open: close, high: close, low: close, close, volume: 100, foreignNet: null,
});

function fakeSource(name = 'fake-src', impl?: (symbol: string, ctx: { lastClose?: number }) => FetchResult | Error) {
  const calls: { symbol: string; from: string; to: string; ctx: { lastClose?: number } }[] = [];
  const source: PriceSource = {
    name,
    fetchDaily: async (symbol, from, to, ctx) => {
      calls.push({ symbol, from, to, ctx });
      const r = impl ? impl(symbol, ctx) : { bars: [bar(symbol, to)], rejected: [] };
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { source, calls };
}

function deps(over: Partial<Parameters<typeof runEodSync>[0]> & Pick<Parameters<typeof runEodSync>[0], 'store' | 'source'>) {
  const sleeps: number[] = [];
  const logs: string[] = [];
  return {
    d: { now: AFTER_CUTOFF, config: EOD_SYNC_CONFIG, sleep: async (ms: number) => void sleeps.push(ms), log: (m: string) => void logs.push(m), dryRun: false, ...over },
    sleeps,
    logs,
  };
}

describe('runEodSync', () => {
  test('target date agrees with core expectedPriceDate; fromDate = lookback window start', async () => {
    for (const now of [AFTER_CUTOFF, BEFORE_CUTOFF]) {
      const holidays = ['2026-10-20'];
      const m = memoryStore({ watchlist: ['VNM'], holidays });
      const { source, calls } = fakeSource();
      const out = await runEodSync(deps({ store: m.store, source, now }).d);
      const target = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);
      expect(out.targetDate).toBe(target);
      expect(out.fromDate).toBe(subtractTradingDays(target, EOD_SYNC_CONFIG.lookbackTradingDays - 1, holidays));
      expect(calls[0]).toMatchObject({ from: out.fromDate, to: target });
    }
    expect(expectedPriceDate(AFTER_CUTOFF, [], DEFAULT_PRICE_CUTOFF_MINUTES_VN)).toBe('2026-10-23');
    expect(expectedPriceDate(BEFORE_CUTOFF, [], DEFAULT_PRICE_CUTOFF_MINUTES_VN)).toBe('2026-10-22');
  });

  test('syncs watchlist U held, deduped, normalised and sorted; invalid symbol skipped with a warning', async () => {
    const m = memoryStore({ watchlist: ['vnm', 'FPT', '!!'], held: { ok: true, value: ['FPT', 'HPG'] } });
    const { source, calls } = fakeSource();
    const { d, logs } = deps({ store: m.store, source });
    const out = await runEodSync(d);
    expect(out.symbols).toEqual(['FPT', 'HPG', 'VNM']);
    expect(calls.map((c) => c.symbol)).toEqual(['FPT', 'HPG', 'VNM']);
    expect(logs.some((l) => l.startsWith('warn'))).toBe(true);
  });

  test('every row carries source = source.name and the run fetched_at', async () => {
    const m = memoryStore({ watchlist: ['VNM', 'FPT'] });
    const { source } = fakeSource('other-source');
    await runEodSync(deps({ store: m.store, source }).d);
    expect(m.table.size).toBe(2);
    for (const r of m.table.values()) {
      expect(r.source).toBe('other-source');
      expect(r.fetched_at).toBe(AFTER_CUTOFF.toISOString());
    }
  });

  test('re-run with same data: same rows except fetched_at, row count unchanged', async () => {
    const m = memoryStore({ watchlist: ['VNM'] });
    const { source } = fakeSource();
    await runEodSync(deps({ store: m.store, source }).d);
    const first = [...m.table.values()].map((r) => ({ ...r, fetched_at: '' }));
    await runEodSync(deps({ store: m.store, source, now: new Date('2026-10-23T13:00:00Z') }).d);
    expect(m.table.size).toBe(1);
    expect([...m.table.values()].map((r) => ({ ...r, fetched_at: '' }))).toEqual(first);
    expect([...m.table.values()][0]?.fetched_at).toBe('2026-10-23T13:00:00.000Z');
  });

  test('rejected bars are counted and never upserted', async () => {
    const m = memoryStore({ watchlist: ['VNM'] });
    const { source } = fakeSource('s', () => ({ bars: [bar('VNM', '2026-10-23')], rejected: [{ tradeDate: '2026-10-22', reason: 'close_jump' }] }));
    const out = await runEodSync(deps({ store: m.store, source }).d);
    expect(out.rejected).toBe(1);
    expect(out.rejectedBySymbol.VNM).toEqual([{ tradeDate: '2026-10-22', reason: 'close_jump' }]);
    expect(out.ok).toBe(false);
    expect([...m.table.values()].map((r) => r.trade_date)).toEqual(['2026-10-23']);
  });

  test('lastClose from getLatestCloses is passed to the source', async () => {
    const m = memoryStore({ watchlist: ['VNM', 'FPT'], closes: { VNM: 61500 } });
    const { source, calls } = fakeSource();
    await runEodSync(deps({ store: m.store, source }).d);
    expect(calls.find((c) => c.symbol === 'VNM')?.ctx).toEqual({ lastClose: 61500 });
    expect(calls.find((c) => c.symbol === 'FPT')?.ctx).toEqual({});
  });

  test('a source error for one symbol does not stop the others', async () => {
    const m = memoryStore({ watchlist: ['AAA', 'BBB', 'CCC'] });
    const { source } = fakeSource('s', (symbol) => (symbol === 'BBB' ? new SourceError('HTTP 500', true, 500) : { bars: [bar(symbol, '2026-10-23')], rejected: [] }));
    const out = await runEodSync(deps({ store: m.store, source }).d);
    expect(out.failedSymbols).toEqual(['BBB']);
    expect(out.ok).toBe(false);
    expect([...m.table.values()].map((r) => r.symbol).sort()).toEqual(['AAA', 'CCC']);
  });

  test('stops after maxConsecutiveFailures; remaining symbols are skipped', async () => {
    const m = memoryStore({ watchlist: ['AAA', 'BBB', 'CCC', 'DDD'] });
    const { source, calls } = fakeSource('s', () => new SourceError('down', true));
    const out = await runEodSync(deps({ store: m.store, source, config: { ...EOD_SYNC_CONFIG, maxConsecutiveFailures: 2 } }).d);
    expect(calls).toHaveLength(2);
    expect(out.failedSymbols).toEqual(['AAA', 'BBB']);
    expect(out.skippedSymbols).toEqual(['CCC', 'DDD']);
    expect(out.ok).toBe(false);
  });

  test('ledger error: continues with watchlist only, ledgerError set, ok false', async () => {
    const m = memoryStore({ watchlist: ['VNM'], held: { ok: false, error: { code: 'OVERSELL', transactionId: 't', symbol: 'FPT', date: '2026-01-01', requested: 1, sellable: 0 } } });
    const { source } = fakeSource();
    const out = await runEodSync(deps({ store: m.store, source }).d);
    expect(out.symbols).toEqual(['VNM']);
    expect(out.ledgerError).toBe('OVERSELL');
    expect(out.ok).toBe(false);
    expect(m.table.size).toBe(1);
  });

  test('dryRun: no upsert call, summary still counts bars', async () => {
    const m = memoryStore({ watchlist: ['VNM'] });
    const { source } = fakeSource();
    const out = await runEodSync(deps({ store: m.store, source, dryRun: true }).d);
    expect(m.upserts()).toBe(0);
    expect(out).toMatchObject({ dryRun: true, barsFetched: 1, rowsUpserted: 0, ok: true });
  });

  test('sleeps requestDelayMs between symbols', async () => {
    const m = memoryStore({ watchlist: ['AAA', 'BBB', 'CCC'] });
    const { source } = fakeSource();
    const { d, sleeps } = deps({ store: m.store, source });
    await runEodSync(d);
    expect(sleeps).toEqual([EOD_SYNC_CONFIG.requestDelayMs, EOD_SYNC_CONFIG.requestDelayMs]);
  });
});

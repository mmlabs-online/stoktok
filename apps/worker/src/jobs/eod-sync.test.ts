import { DEFAULT_PRICE_CUTOFF_MINUTES_VN, expectedPriceDate, subtractTradingDays, vnDayBoundsUtc } from '@stoktok/core';
import type { DailyBar, Result } from '@stoktok/core';
import type { DataGapInsert, OpenGapRecord, PriceDailyInsert } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { EOD_SYNC_CONFIG } from '../config';
import { SourceError } from '../sources/price-source';
import type { FetchResult, PriceSource } from '../sources/price-source';
import { runEodSync } from './eod-sync';
import type { EodStore } from './eod-sync';

const AFTER_CUTOFF = new Date('2026-10-23T12:00:00Z'); // Fri 19:00 VN
const BEFORE_CUTOFF = new Date('2026-10-23T08:00:00Z'); // Fri 15:00 VN

type GapState = OpenGapRecord & { row?: DataGapInsert; resolvedAt?: string };

function memoryStore(
  opts: { watchlist?: string[]; held?: Result<string[]>; holidays?: string[]; closes?: Record<string, number>; prior?: Record<string, string[]>; gaps?: GapState[] } = {},
) {
  const table = new Map<string, PriceDailyInsert>();
  for (const [symbol, dates] of Object.entries(opts.prior ?? {})) {
    for (const d of dates) table.set(`${symbol}|${d}`, { symbol, trade_date: d } as PriceDailyInsert);
  }
  const gaps: GapState[] = [...(opts.gaps ?? [])];
  const order: string[] = [];
  let upsertCalls = 0;
  const closesAsked: string[][] = [];
  const datesOf = (symbol: string) => [...table.values()].filter((r) => r.symbol === symbol).map((r) => r.trade_date).sort();
  const store: EodStore = {
    getHolidays: async () => opts.holidays ?? [],
    listWatchlistSymbols: async () => [...(opts.watchlist ?? [])],
    listHeldSymbols: async () => opts.held ?? { ok: true, value: [] },
    getLatestCloses: async (symbols) => {
      closesAsked.push([...symbols]);
      return opts.closes ?? {};
    },
    upsertPricesDaily: async (rows) => {
      order.push('upsert');
      upsertCalls += 1;
      for (const r of rows) table.set(`${r.symbol}|${r.trade_date}`, r);
      return rows.length;
    },
    listPriceDates: async (symbol, from, to) => datesOf(symbol).filter((d) => d >= from && d <= to),
    getFirstPriceDates: async (symbols) => Object.fromEntries(symbols.flatMap((s) => (datesOf(s)[0] ? [[s, datesOf(s)[0] as string]] : []))),
    listOpenGaps: async (symbols) => gaps.filter((g) => g.resolvedAt === undefined && g.symbol !== null && symbols.includes(g.symbol)),
    insertGaps: async (rows) => {
      order.push('insertGaps');
      for (const row of rows) gaps.push({ id: gaps.length + 1, symbol: row.symbol, fromTs: row.from_ts, toTs: row.to_ts, row });
    },
    resolveGaps: async (ids, resolvedAt) => {
      order.push('resolveGaps');
      for (const g of gaps) if (ids.includes(g.id) && g.resolvedAt === undefined) g.resolvedAt = resolvedAt;
    },
  };
  return { store, table, gaps, order, closesAsked, upserts: () => upsertCalls };
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

  describe('gap detection', () => {
    // Window with lookback 20 is long; use a short one so tests stay readable. Fri 2026-10-23 is the target.
    const config = { ...EOD_SYNC_CONFIG, lookbackTradingDays: 5 }; // window 2026-10-19 (Mon) .. 2026-10-23
    const only = (symbol: string, dates: string[]) => (s: string) => ({ bars: dates.filter(() => s === symbol).map((d) => bar(s, d)), rejected: [] });

    test('records a prices_daily gap per missing trading day after the upsert', async () => {
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19'] } });
      const { source } = fakeSource('fake-src', only('VNM', ['2026-10-23']));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.missingDates).toEqual({ VNM: ['2026-10-20', '2026-10-21', '2026-10-22'] });
      expect(out).toMatchObject({ gapsRecorded: 3, gapsResolved: 0, ok: true });
      expect(m.gaps[0]?.row).toEqual({ symbol: 'VNM', data_type: 'prices_daily', from_ts: vnDayBoundsUtc('2026-10-20').fromTs, to_ts: vnDayBoundsUtc('2026-10-20').toTs, source: 'fake-src', fetched_at: AFTER_CUTOFF.toISOString() });
      expect(m.order).toEqual(['upsert', 'insertGaps', 'resolveGaps']);
    });

    test('configured holiday inside the window is not a gap', async () => {
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19'] }, holidays: ['2026-10-21'] });
      const { source } = fakeSource('s', only('VNM', ['2026-10-23']));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.missingDates.VNM).toEqual(['2026-10-20', '2026-10-22']);
    });

    test('re-run inserts no new gaps', async () => {
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19'] } });
      const { source } = fakeSource('s', only('VNM', ['2026-10-23']));
      await runEodSync(deps({ store: m.store, source, config }).d);
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(m.gaps).toHaveLength(3);
      expect(out).toMatchObject({ gapsRecorded: 0, gapsResolved: 0, missingDates: {} });
    });

    test('existing open gap with +00:00 timestamps is not duplicated', async () => {
      const b = vnDayBoundsUtc('2026-10-20');
      const gaps = [{ id: 50, symbol: 'VNM', fromTs: b.fromTs.replace('Z', '+00:00'), toTs: b.toTs.replace('Z', '+00:00') }];
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19', '2026-10-21', '2026-10-22'] }, gaps });
      const { source } = fakeSource('s', only('VNM', ['2026-10-23']));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.gapsRecorded).toBe(0);
      expect(m.gaps).toHaveLength(1);
    });

    test('resolves a gap when the bar arrives; the gap row is kept with resolved_at = fetchedAt', async () => {
      const b = vnDayBoundsUtc('2026-10-22');
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23'] }, gaps: [{ id: 7, symbol: 'VNM', ...b }] });
      const { source } = fakeSource('s', only('VNM', ['2026-10-22', '2026-10-23']));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.gapsResolved).toBe(1);
      expect(m.gaps).toHaveLength(1);
      expect(m.gaps[0]?.resolvedAt).toBe(AFTER_CUTOFF.toISOString());
    });

    test('symbol first stored mid-window gets no earlier gaps; symbol with no stored rows gets none', async () => {
      const m = memoryStore({ watchlist: ['NEW', 'NONE'] });
      const { source } = fakeSource('s', (sym) => ({ bars: sym === 'NEW' ? [bar('NEW', '2026-10-22'), bar('NEW', '2026-10-23')] : [], rejected: [] }));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.missingDates).toEqual({});
      expect(m.gaps).toHaveLength(0);
    });

    test('failed symbol with history still gets a gap for the target date; ok driven by existing conditions', async () => {
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'] } });
      const { source } = fakeSource('s', () => new SourceError('down', true));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.missingDates).toEqual({ VNM: ['2026-10-23'] });
      expect(out.failedSymbols).toEqual(['VNM']);
      expect(out.ok).toBe(false);
    });

    test('dryRun: no insertGaps or resolveGaps call; missingDates still reported', async () => {
      const m = memoryStore({ watchlist: ['VNM'], prior: { VNM: ['2026-10-19'] } });
      const { source } = fakeSource('s', only('VNM', ['2026-10-23']));
      const out = await runEodSync(deps({ store: m.store, source, config, dryRun: true }).d);
      expect(m.order).toEqual([]);
      expect(out.missingDates.VNM).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
      expect(out).toMatchObject({ gapsRecorded: 0, gapsResolved: 0 });
    });
  });
});

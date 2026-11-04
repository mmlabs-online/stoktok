import { DEFAULT_PRICE_CUTOFF_MINUTES_VN, expectedPriceDate, planBackfillChunks, subtractTradingDays, vnDayBoundsUtc } from '@stoktok/core';
import type { DailyBar, Result } from '@stoktok/core';
import type { DataGapInsert, OpenGapRecord, PriceDailyInsert } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { EOD_SYNC_CONFIG } from '../config';
import { SourceError } from '../sources/price-source';
import { VciPriceSource } from '../sources/vci';
import type { FetchResult, PriceSource } from '../sources/price-source';
import { runEodSync } from './eod-sync';
import type { EodStore } from './eod-sync';

const AFTER_CUTOFF = new Date('2026-10-23T12:00:00Z'); // Fri 19:00 VN
const BEFORE_CUTOFF = new Date('2026-10-23T08:00:00Z'); // Fri 15:00 VN

type GapState = OpenGapRecord & { row?: DataGapInsert; resolvedAt?: string; reason?: string };

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
    resolveGaps: async (ids, resolvedAt, reason) => {
      order.push('resolveGaps');
      for (const g of gaps) {
        if (!ids.includes(g.id) || g.resolvedAt !== undefined) continue;
        g.resolvedAt = resolvedAt;
        if (reason !== undefined) g.reason = reason;
      }
    },
  };
  return { store, table, gaps, order, closesAsked, upserts: () => upsertCalls };
}

const bar = (symbol: string, tradeDate: string, close = 10000): DailyBar => ({
  symbol, tradeDate, open: close, high: close, low: close, close, volume: 100, foreignNet: null,
});

type FetchCtx = { lastClose?: number; rejectOnOrBefore?: string };
function fakeSource(name = 'fake-src', impl?: (symbol: string, ctx: FetchCtx) => FetchResult | Error) {
  const calls: { symbol: string; from: string; to: string; ctx: FetchCtx }[] = [];
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

  describe('backfill', () => {
    const N = 12;
    const config = { ...EOD_SYNC_CONFIG, backfillChunkTradingDays: 5 }; // 12 days -> chunks of 5, 5, 2
    const run = (over: Partial<Parameters<typeof runEodSync>[0]> & Pick<Parameters<typeof runEodSync>[0], 'store' | 'source'>) =>
      deps({ config, backfillTradingDays: N, ...over });
    const fromOf = subtractTradingDays('2026-10-23', N - 1, []);
    const chunks = planBackfillChunks(fromOf, '2026-10-23', 5, []);

    test('fromDate = subtractTradingDays(target, n-1) and fetch calls cover exactly the chunk ranges per symbol', async () => {
      const m = memoryStore({ watchlist: ['AAA', 'BBB'] });
      const { source, calls } = fakeSource();
      const out = await runEodSync(run({ store: m.store, source }).d);
      expect(out.fromDate).toBe(fromOf);
      expect(chunks).toHaveLength(3);
      expect(calls.map((c) => [c.symbol, c.from, c.to])).toEqual(
        ['AAA', 'BBB'].flatMap((s) => chunks.map((c) => [s, c.from, c.to])),
      );
    });

    test('rows upserted with source.name and fetchedAt', async () => {
      const m = memoryStore({ watchlist: ['AAA'] });
      const { source } = fakeSource('bf-src');
      await runEodSync(run({ store: m.store, source }).d);
      expect(m.table.size).toBe(3);
      for (const r of m.table.values()) {
        expect(r.source).toBe('bf-src');
        expect(r.fetched_at).toBe(AFTER_CUTOFF.toISOString());
      }
    });

    test('dry-run: no upsert, no insertGaps/resolveGaps, missingDates still reported', async () => {
      const m = memoryStore({ watchlist: ['AAA'] });
      const { source } = fakeSource();
      const out = await runEodSync(run({ store: m.store, source, dryRun: true }).d);
      expect(m.upserts()).toBe(0);
      expect(m.order).toEqual([]);
      expect(out.rowsUpserted).toBe(0);
      expect(out.gapsRecorded).toBe(0);
      expect(Object.keys(out.missingDates)).toEqual(['AAA']);
    });

    test('re-run adds no rows (memory store row count unchanged)', async () => {
      const m = memoryStore({ watchlist: ['AAA'] });
      const { source } = fakeSource();
      await runEodSync(run({ store: m.store, source }).d);
      const size = m.table.size;
      await runEodSync(run({ store: m.store, source }).d);
      expect(m.table.size).toBe(size);
    });

    test('rejected bar in a middle chunk is not written, the prior stored row is kept, ok=false, rejectedBySymbol lists it', async () => {
      const mid = chunks[1] as { from: string; to: string };
      const m = memoryStore({ watchlist: ['AAA'], prior: { AAA: [mid.to] } });
      let n = 0;
      const { source } = fakeSource('s', (symbol) => {
        n += 1;
        return n === 2
          ? { bars: [], rejected: [{ tradeDate: mid.to, reason: 'close_jump' }] }
          : { bars: [bar(symbol, n === 1 ? '2026-10-23' : fromOf)], rejected: [] };
      });
      const out = await runEodSync(run({ store: m.store, source }).d);
      expect(out.ok).toBe(false);
      expect(out.rejectedBySymbol.AAA).toEqual([{ tradeDate: mid.to, reason: 'close_jump' }]);
      expect(m.table.get(`AAA|${mid.to}`)?.source).toBeUndefined();
    });

    test('lastClose: newest chunk gets the stored latest close; older chunks get the oldest accepted close of the chunk after; none accepted -> carried', async () => {
      const m = memoryStore({ watchlist: ['AAA'], closes: { AAA: 50000 } });
      let n = 0;
      const { source, calls } = fakeSource('s', (symbol) => {
        n += 1;
        if (n === 1) return { bars: [bar(symbol, '2026-10-23', 40000), bar(symbol, '2026-10-22', 39000)], rejected: [] };
        return { bars: [], rejected: [] };
      });
      await runEodSync(run({ store: m.store, source }).d);
      expect(calls.map((c) => c.ctx)).toEqual([{ lastClose: 50000 }, { lastClose: 39000 }, { lastClose: 39000 }]);
    });

    test('requestsPlanned = symbols x chunks, logged before the first fetch', async () => {
      const m = memoryStore({ watchlist: ['AAA', 'BBB'] });
      const logs: string[] = [];
      let logsAtFirstFetch = -1;
      const { source } = fakeSource('s', (symbol) => {
        if (logsAtFirstFetch < 0) logsAtFirstFetch = logs.filter((l) => l.startsWith('backfill:')).length;
        return { bars: [bar(symbol, '2026-10-23')], rejected: [] };
      });
      const out = await runEodSync({ ...run({ store: m.store, source }).d, log: (l) => void logs.push(l) });
      expect(out).toMatchObject({ requestsPlanned: 6, requestsMade: 6 });
      expect(logsAtFirstFetch).toBe(1);
    });

    test('planned > maxBackfillRequests: zero fetches, zero writes, ok=false, abortReason', async () => {
      const m = memoryStore({ watchlist: ['AAA', 'BBB'] });
      const { source, calls } = fakeSource();
      const out = await runEodSync(run({ store: m.store, source, config: { ...config, maxBackfillRequests: 5 } }).d);
      expect(calls).toHaveLength(0);
      expect(m.order).toEqual([]);
      expect(out).toMatchObject({ ok: false, abortReason: 'request_cap_exceeded', requestsPlanned: 6, requestsMade: 0 });
    });

    test('sleep(requestDelayMs) before every request except the first', async () => {
      const m = memoryStore({ watchlist: ['AAA', 'BBB'] });
      const { source } = fakeSource();
      const { d, sleeps } = run({ store: m.store, source });
      await runEodSync(d);
      expect(sleeps).toEqual(Array(5).fill(EOD_SYNC_CONFIG.requestDelayMs));
    });

    test('circuit breaker: failed requests stop the rest; partial symbol failed, untouched skipped; fetched bars still upserted', async () => {
      const m = memoryStore({ watchlist: ['AAA', 'BBB'] });
      let n = 0;
      const { source, calls } = fakeSource('s', (symbol) => {
        n += 1;
        return n === 1 ? { bars: [bar(symbol, '2026-10-23')], rejected: [] } : new SourceError('down', true);
      });
      const out = await runEodSync(run({ store: m.store, source, config: { ...config, maxConsecutiveFailures: 2 } }).d);
      expect(calls).toHaveLength(3);
      expect(out.requestsMade).toBe(3);
      expect(out.failedSymbols).toEqual(['AAA']);
      expect(out.skippedSymbols).toEqual(['BBB']);
      expect([...m.table.keys()]).toEqual(['AAA|2026-10-23']);
    });

    test('daily mode unchanged: one request per symbol, requestsPlanned = symbols', async () => {
      const m = memoryStore({ watchlist: ['AAA', 'BBB'] });
      const { source, calls } = fakeSource();
      const out = await runEodSync(deps({ store: m.store, source }).d);
      expect(calls).toHaveLength(2);
      expect(out).toMatchObject({ requestsPlanned: 2, requestsMade: 2 });
    });
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
      expect(m.order).toEqual(['upsert', 'insertGaps', 'resolveGaps', 'resolveGaps']);
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
      expect(m.gaps[0]?.reason).toBe('data_stored');
    });

    test('an open gap on a holiday is resolved with reason non_trading_day, not deleted', async () => {
      const b = vnDayBoundsUtc('2026-10-21');
      const m = memoryStore({
        watchlist: ['VNM'],
        holidays: ['2026-10-21'],
        prior: { VNM: ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23'] },
        gaps: [{ id: 8, symbol: 'VNM', ...b }],
      });
      const { source } = fakeSource('s', only('VNM', ['2026-10-23']));
      const out = await runEodSync(deps({ store: m.store, source, config }).d);
      expect(out.gapsResolved).toBe(1);
      expect(m.gaps).toHaveLength(1);
      expect(m.gaps[0]).toMatchObject({ resolvedAt: AFTER_CUTOFF.toISOString(), reason: 'non_trading_day' });
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

describe('runEodSync with VciPriceSource', () => {
  const http = { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 1, sleep: async () => undefined, log: () => undefined };
  // Fixture-backed fetch: answers with one VND bar on the last day of the requested range.
  function vciFetch(status = 200) {
    let requests = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requests += 1;
      const body = JSON.parse(init?.body as string) as { to: number; symbols: string[] };
      const json = [{ symbol: body.symbols[0], t: [body.to - 86400], o: [61500], h: [62000], l: [61200], c: [61800], v: [1000] }];
      return { ok: status === 200, status, json: async () => json } as Response;
    }) as unknown as typeof fetch;
    return { source: new VciPriceSource({ fetchImpl, http }), requests: () => requests };
  }

  test('writes source=vci-public and the run fetched_at on every row', async () => {
    const m = memoryStore({ watchlist: ['VNM', 'FPT'] });
    await runEodSync(deps({ store: m.store, source: vciFetch().source }).d);
    expect(m.table.size).toBe(2);
    for (const r of m.table.values()) {
      expect(r.source).toBe('vci-public');
      expect(r.fetched_at).toBe(AFTER_CUTOFF.toISOString());
    }
  });

  test('re-run is idempotent; requestsMade = symbols x chunks (daily and backfill)', async () => {
    const m = memoryStore({ watchlist: ['VNM', 'FPT'] });
    const daily = vciFetch();
    await runEodSync(deps({ store: m.store, source: daily.source }).d);
    await runEodSync(deps({ store: m.store, source: daily.source }).d);
    expect(m.table.size).toBe(2);
    expect(daily.requests()).toBe(4);

    const config = { ...EOD_SYNC_CONFIG, backfillChunkTradingDays: 5 };
    const chunks = planBackfillChunks(subtractTradingDays('2026-10-23', 11, []), '2026-10-23', 5, []);
    const back = vciFetch();
    const out = await runEodSync(deps({ store: memoryStore({ watchlist: ['VNM', 'FPT'] }).store, source: back.source, config, backfillTradingDays: 12 }).d);
    expect(back.requests()).toBe(2 * chunks.length);
    expect(out.requestsMade).toBe(2 * chunks.length);
  });

  test('403 on every symbol -> failedSymbols, breaker stops after maxConsecutiveFailures, ok=false', async () => {
    const symbols = Array.from({ length: EOD_SYNC_CONFIG.maxConsecutiveFailures + 3 }, (_, i) => `AA${String.fromCharCode(65 + i)}`);
    const m = memoryStore({ watchlist: symbols });
    const v = vciFetch(403);
    const out = await runEodSync(deps({ store: m.store, source: v.source }).d);
    expect(out.ok).toBe(false);
    expect(out.failedSymbols).toHaveLength(EOD_SYNC_CONFIG.maxConsecutiveFailures);
    expect(v.requests()).toBe(EOD_SYNC_CONFIG.maxConsecutiveFailures);
  });
});

describe('runEodSync adjusted history', () => {
  const config = { ...EOD_SYNC_CONFIG, backfillChunkTradingDays: 5 };
  const chunks = planBackfillChunks(subtractTradingDays('2026-10-23', 11, []), '2026-10-23', 5, []);
  const adjusted = (tradeDate: string) => ({ tradeDate, reason: 'adjusted_price_history' });

  test('backfill: adjusted cut-off from the newest chunk is passed as rejectOnOrBefore to older chunks', async () => {
    const m = memoryStore({ watchlist: ['AAA'], closes: { AAA: 10000 } });
    const { source, calls } = fakeSource('fake-src', (symbol, ctx) =>
      ctx.rejectOnOrBefore === undefined
        ? { bars: [bar(symbol, '2026-10-23', 10100)], rejected: [adjusted('2026-10-22')], adjustedCutoff: '2026-10-22' }
        : { bars: [], rejected: [], adjustedCutoff: ctx.rejectOnOrBefore },
    );
    await runEodSync(deps({ store: m.store, source, config, backfillTradingDays: 12 }).d);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.ctx).toEqual({ lastClose: 10000 });
    expect(calls[1]?.ctx).toEqual({ lastClose: 10100, rejectOnOrBefore: '2026-10-22' });
    expect(calls[2]?.ctx).toEqual({ lastClose: 10100, rejectOnOrBefore: '2026-10-22' });
  });

  test('adjusted_price_history rejections alone keep ok true; rejected and rejectedBySymbol still report them', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { source } = fakeSource('fake-src', (symbol) => ({
      bars: [bar(symbol, '2026-10-23')],
      rejected: [adjusted('2026-10-21'), adjusted('2026-10-22')],
      adjustedCutoff: '2026-10-22',
    }));
    const { d, logs } = deps({ store: m.store, source });
    const out = await runEodSync(d);
    expect(out.ok).toBe(true);
    expect(out.rejected).toBe(2);
    expect(out.rejectedBySymbol.AAA).toEqual([adjusted('2026-10-21'), adjusted('2026-10-22')]);
    expect(logs).toContain('adjusted history AAA: bars on or before 2026-10-22 rejected');
  });

  test('newest window with a cut-off and zero accepted bars -> ok false and an error log', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { source } = fakeSource('fake-src', () => ({ bars: [], rejected: [adjusted('2026-10-23')], adjustedCutoff: '2026-10-23' }));
    const { d, logs } = deps({ store: m.store, source });
    const out = await runEodSync(d);
    expect(out.ok).toBe(false);
    expect(logs).toContain('error: AAA: newest window is all adjusted history (cut-off 2026-10-23)');
  });

  test('other rejection reasons still flip ok false alongside adjusted ones', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { source } = fakeSource('fake-src', (symbol) => ({
      bars: [bar(symbol, '2026-10-23')],
      rejected: [adjusted('2026-10-21'), { tradeDate: '2026-10-22', reason: 'price_off_step' }],
      adjustedCutoff: '2026-10-21',
    }));
    const out = await runEodSync(deps({ store: m.store, source }).d);
    expect(out.ok).toBe(false);
  });

  test('with VciPriceSource, backfill: fractional bars in the newest chunk reject the all-integer older chunk', async () => {
    const newest = chunks[0];
    expect(newest && newest.from < newest.to).toBe(true);
    const vnSeconds = (d: string) => Math.floor(Date.parse(`${d}T00:00:00+07:00`) / 1000);
    let request = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      request += 1;
      const body = JSON.parse(init?.body as string) as { to: number };
      // newest chunk: fractional bar on its first day, raw bar on its last day; older chunks: one whole bar at their end
      const rows =
        request === 1
          ? [
              { t: vnSeconds(chunks[0]?.from as string), o: 33501.5, h: 33801.5, l: 33401.5, c: 33701.5 },
              { t: vnSeconds(chunks[0]?.to as string), o: 33500, h: 33800, l: 33400, c: 33700 },
            ]
          : [{ t: body.to - 86400, o: 33500, h: 33800, l: 33400, c: 33700 }];
      const json = [{ symbol: 'TCB', t: rows.map((r) => r.t), o: rows.map((r) => r.o), h: rows.map((r) => r.h), l: rows.map((r) => r.l), c: rows.map((r) => r.c), v: rows.map(() => 1000) }];
      return { ok: true, status: 200, json: async () => json } as Response;
    }) as unknown as typeof fetch;
    const http = { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 1, sleep: async () => undefined, log: () => undefined };
    const source = new VciPriceSource({ fetchImpl, http });
    const olderDates = chunks.slice(1).map((c) => c.to);
    const m = memoryStore({ watchlist: ['TCB'], prior: { TCB: olderDates } });
    const out = await runEodSync(deps({ store: m.store, source, config, backfillTradingDays: 12 }).d);
    expect(request).toBe(chunks.length);
    expect(out.rejectedBySymbol.TCB).toEqual([
      { tradeDate: newest?.from, reason: 'adjusted_price_history' },
      ...olderDates.map((d) => ({ tradeDate: d, reason: 'adjusted_price_history' })),
    ]);
    expect(out.ok).toBe(true);
    expect(out.barsFetched).toBe(1);
    expect(out.rowsUpserted).toBe(1);
    const written = [...m.table.values()].filter((r) => r.source !== undefined);
    expect(written.map((r) => r.trade_date)).toEqual([newest?.to]);
    for (const d of olderDates) expect(m.table.get(`TCB|${d}`)?.source).toBeUndefined();
  });
});

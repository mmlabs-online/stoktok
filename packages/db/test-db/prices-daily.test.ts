import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { PG_FANOUT_CONCURRENCY } from '../src/pg/config';
import {
  getFirstPriceDates,
  getLatestCloses,
  getRecentCloses,
  listCloseHistory,
  listPriceDates,
  upsertPricesDaily,
} from '../src/repos/prices-daily';
import type { PriceDailyInsert } from '../src/rows';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
let worker: TestDb;
beforeAll(async () => {
  t = await freshDb();
  worker = await freshDb('worker');
});
afterAll(async () => {
  await t.drop();
  await worker.drop();
});

const row = (symbol: string, date: string, o: Partial<PriceDailyInsert> = {}): PriceDailyInsert => ({
  symbol,
  trade_date: date,
  open: 100,
  high: 120,
  low: 90,
  close: 110,
  volume: 1000,
  foreign_net: 5,
  source: 'vnd',
  fetched_at: '2026-11-10T10:00:00+00:00',
  ...o,
});
const raw = (symbol: string) => kyselyOf(t.pgDb).selectFrom('prices_daily').selectAll().where('symbol', '=', symbol).orderBy('trade_date').execute();

describe('prices_daily repo', () => {
  test('re-upsert replaces all columns incl. foreign_net → null (conflict key symbol, trade_date)', async () => {
    await upsertPricesDaily(t.pgDb, [row('RU', '2026-11-02')]);
    await upsertPricesDaily(t.pgDb, [row('RU', '2026-11-02', { close: 111, foreign_net: null, source: 'v2', fetched_at: '2026-11-10T12:00:00+00:00' })]);
    const rows = await raw('RU');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ close: 111, foreign_net: null, source: 'v2', fetched_at: '2026-11-10T12:00:00+00:00' });
  });

  test('duplicate keys in one input: later wins, count = unique.length', async () => {
    const n = await upsertPricesDaily(t.pgDb, [row('DK', '2026-11-02', { close: 100 }), row('DK', '2026-11-02', { close: 105 }), row('DK', '2026-11-03')]);
    expect(n).toBe(2);
    expect((await raw('DK')).map((r) => r.close)).toEqual([105, 110]);
  });

  test('chunkSize 2 over 5 rows writes all 5', async () => {
    const rows = [1, 2, 3, 4, 5].map((d) => row('CH', `2026-11-0${d}`));
    expect(await upsertPricesDaily(t.pgDb, rows, { chunkSize: 2 })).toBe(5);
    expect(await raw('CH')).toHaveLength(5);
  });

  test('mixed optional columns in one batch (foreign_net number / null / undefined) succeed; undefined stored as NULL', async () => {
    const withUndefined = { ...row('MX', '2026-11-03') } as Partial<PriceDailyInsert>;
    delete withUndefined.foreign_net;
    await upsertPricesDaily(t.pgDb, [row('MX', '2026-11-02', { foreign_net: 7 }), row('MX', '2026-11-04', { foreign_net: null }), withUndefined as PriceDailyInsert]);
    const rows = await raw('MX');
    expect(rows.map((r) => r.foreign_net)).toEqual(['7', null, null]);
  });

  test('volume arrives as a digit string, trade_date as YYYY-MM-DD', async () => {
    await upsertPricesDaily(t.pgDb, [row('VS', '2026-11-02', { volume: 123456789 })]);
    const [r] = await raw('VS');
    expect(r!.volume).toBe('123456789');
    expect(r!.trade_date).toBe('2026-11-02');
    expect(await listCloseHistory(t.pgDb, 'VS', '2026-11-01', '2026-11-30')).toMatchObject([{ volume: 123456789, tradeDate: '2026-11-02' }]);
  });

  test('latest / first / recent omit or empty symbols without rows; 12 symbols on the worker profile (max 2) all resolve, stats().total ≤ 2', async () => {
    const syms = Array.from({ length: 12 }, (_, i) => `FO${i}`);
    for (const s of syms) {
      await upsertPricesDaily(worker.pgDb, [row(s, '2026-11-02', { close: 101 }), row(s, '2026-11-03', { close: 102 }), row(s, '2026-11-04', { close: 103 })]);
    }
    const all = [...syms, 'NOPE'];
    let peak = 0;
    const timer = setInterval(() => (peak = Math.max(peak, worker.pgDb.stats().total)), 1);
    const [latest, first, recent] = await Promise.all([getLatestCloses(worker.pgDb, all), getFirstPriceDates(worker.pgDb, all), getRecentCloses(worker.pgDb, all, 2)]);
    clearInterval(timer);
    expect(Object.keys(latest).sort()).toEqual([...syms].sort());
    expect(latest.FO3).toMatchObject({ close: 103, tradeDate: '2026-11-04' });
    expect(Object.keys(first)).toHaveLength(12);
    expect(first.FO0).toBe('2026-11-02');
    expect(recent.NOPE).toEqual([]);
    expect(recent.FO1!.map((r) => r.tradeDate)).toEqual(['2026-11-04', '2026-11-03']);
    expect(worker.pgDb.stats().total).toBeLessThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(2);
    expect(PG_FANOUT_CONCURRENCY).toBeLessThanOrEqual(2);
    expect(await getLatestCloses(t.pgDb, [])).toEqual({});
  });

  test('listPriceDates and listCloseHistory: one select, ascending, inclusive bounds', async () => {
    await upsertPricesDaily(t.pgDb, ['01', '02', '03', '04'].map((d) => row('LD', `2026-10-${d}`)));
    expect(await listPriceDates(t.pgDb, 'LD', '2026-10-02', '2026-10-03')).toEqual(['2026-10-02', '2026-10-03']);
    expect((await listCloseHistory(t.pgDb, 'LD', '2026-10-01', '2026-10-04')).map((r) => r.tradeDate)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    // more rows than the old PostgREST page size, still one call
    const many = Array.from({ length: 1200 }, (_, i) => row('BIG', new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10)));
    await upsertPricesDaily(t.pgDb, many);
    expect(await listPriceDates(t.pgDb, 'BIG', '2020-01-01', '2030-01-01')).toHaveLength(1200);
  });

  test('check violation → VALIDATION', async () => {
    const e = await upsertPricesDaily(t.pgDb, [row('BAD', '2026-11-02', { low: 200 })]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DataError);
    expect(e).toMatchObject({ code: 'VALIDATION' });
    expect((e as DataError).message).not.toContain('BAD');
  });
});

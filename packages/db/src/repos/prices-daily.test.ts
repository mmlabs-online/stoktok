import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getFirstPriceDates, getLatestCloses, getRecentCloses, listPriceDates, upsertPricesDaily } from './prices-daily';

const row = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol,
  trade_date: '2026-10-23',
  close: 125400,
  source: 'vnd',
  fetched_at: '2026-10-23T11:30:00Z',
  ...over,
});

describe('getLatestCloses', () => {
  test('one query per symbol: eq, order desc, limit 1; maps to PriceQuote', async () => {
    const f = createFake();
    f.respond({ data: row('FPT') });
    f.respond({ data: row('VNM', { close: 60000 }) });
    const out = await getLatestCloses(f.db, ['FPT', 'VNM']);
    expect(f.calls.filter((c) => c.method === 'select')).toHaveLength(2);
    expect(f.methods('eq').map((c) => c.args)).toEqual([['symbol', 'FPT'], ['symbol', 'VNM']]);
    expect(f.methods('order')[0]?.args).toEqual(['trade_date', { ascending: false }]);
    expect(f.methods('limit')[0]?.args).toEqual([1]);
    expect(out.FPT).toEqual({ symbol: 'FPT', close: 125400, tradeDate: '2026-10-23', source: 'vnd', fetchedAt: '2026-10-23T11:30:00Z' });
    expect(out.VNM?.close).toBe(60000);
  });
  test('symbol without a row is omitted', async () => {
    const f = createFake();
    f.respond({ data: null });
    f.respond({ data: row('VNM') });
    const out = await getLatestCloses(f.db, ['FPT', 'VNM']);
    expect(Object.keys(out)).toEqual(['VNM']);
  });
  test('empty input runs no query', async () => {
    const f = createFake();
    expect(await getLatestCloses(f.db, [])).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
  test('DB error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(getLatestCloses(f.db, ['FPT'])).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
  test('negative, non-integer close or missing source -> MAPPING', async () => {
    for (const bad of [{ close: -1 }, { close: 1.5 }, { source: '' }]) {
      const f = createFake();
      f.respond({ data: row('FPT', bad) });
      await expect(getLatestCloses(f.db, ['FPT'])).rejects.toMatchObject({ code: 'MAPPING' });
    }
  });
});

describe('getRecentCloses', () => {
  test('per-symbol eq/order desc/limit 2; maps volume; symbol with 0 rows -> []', async () => {
    const f = createFake();
    f.respond({ data: [row('FPT', { volume: 500 }), row('FPT', { trade_date: '2026-10-22', volume: 400 })] });
    f.respond({ data: [] });
    const out = await getRecentCloses(f.db, ['FPT', 'VNM']);
    expect(f.methods('eq').map((c) => c.args)).toEqual([['symbol', 'FPT'], ['symbol', 'VNM']]);
    expect(f.methods('order')[0]?.args).toEqual(['trade_date', { ascending: false }]);
    expect(f.methods('limit')[0]?.args).toEqual([2]);
    expect(out.FPT?.map((q) => [q.tradeDate, q.volume])).toEqual([['2026-10-23', 500], ['2026-10-22', 400]]);
    expect(out.VNM).toEqual([]);
  });
  test('empty input runs no query', async () => {
    const f = createFake();
    expect(await getRecentCloses(f.db, [])).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
  test('missing source or bad volume -> MAPPING', async () => {
    for (const bad of [{ source: '' }, { volume: -1 }]) {
      const f = createFake();
      f.respond({ data: [row('FPT', { volume: 1, ...bad })] });
      await expect(getRecentCloses(f.db, ['FPT'])).rejects.toMatchObject({ code: 'MAPPING' });
    }
  });
});

const ins = (symbol: string, trade_date = '2026-10-23', over: Record<string, unknown> = {}) => ({
  symbol,
  trade_date,
  open: 1000,
  high: 1100,
  low: 900,
  close: 1000,
  volume: 10,
  foreign_net: null,
  source: 'tcbs-public',
  fetched_at: '2026-10-23T11:30:00.000Z',
  ...over,
});

describe('upsertPricesDaily', () => {
  test('sends onConflict symbol,trade_date and rows with source and fetched_at', async () => {
    const f = createFake();
    f.respond({});
    expect(await upsertPricesDaily(f.db, [ins('FPT')])).toBe(1);
    const call = f.methods('upsert')[0];
    expect(call?.args[0]).toEqual([ins('FPT')]);
    expect(call?.args[1]).toEqual({ onConflict: 'symbol,trade_date' });
    expect(f.methods('select')).toHaveLength(0);
  });
  test('1200 rows -> 3 sequential calls (500, 500, 200)', async () => {
    const f = createFake();
    for (let i = 0; i < 3; i++) f.respond({});
    const rows = Array.from({ length: 1200 }, (_, i) => ins('FPT', `2020-01-01T${i}`));
    expect(await upsertPricesDaily(f.db, rows)).toBe(1200);
    expect(f.methods('upsert').map((c) => (c.args[0] as unknown[]).length)).toEqual([500, 500, 200]);
  });
  test('duplicate (symbol, trade_date) keeps the last, one row sent', async () => {
    const f = createFake();
    f.respond({});
    await upsertPricesDaily(f.db, [ins('FPT', '2026-10-23', { close: 1 }), ins('FPT', '2026-10-23', { close: 2 })]);
    expect(f.methods('upsert')[0]?.args[0]).toEqual([ins('FPT', '2026-10-23', { close: 2 })]);
  });
  test('empty input -> no call, returns 0', async () => {
    const f = createFake();
    expect(await upsertPricesDaily(f.db, [])).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  test('23514 -> VALIDATION, other error -> DB_ERROR, data null is success', async () => {
    const a = createFake();
    a.respond({ error: { code: '23514' } });
    await expect(upsertPricesDaily(a.db, [ins('FPT')])).rejects.toMatchObject({ code: 'VALIDATION' });
    const b = createFake();
    b.respond({ error: { code: '42501' } });
    await expect(upsertPricesDaily(b.db, [ins('FPT')])).rejects.toMatchObject({ code: 'DB_ERROR' });
    const c = createFake();
    c.respond({ data: null });
    await expect(upsertPricesDaily(c.db, [ins('FPT')])).resolves.toBe(1);
  });
});

describe('listPriceDates', () => {
  test('select trade_date, eq symbol, gte/lte, order asc, range(0, size-1)', async () => {
    const f = createFake();
    f.respond({ data: [{ trade_date: '2026-10-22' }, { trade_date: '2026-10-23' }] });
    expect(await listPriceDates(f.db, 'FPT', '2026-10-01', '2026-10-31')).toEqual(['2026-10-22', '2026-10-23']);
    expect(f.methods('select')[0]?.args).toEqual(['trade_date']);
    expect(f.methods('eq')[0]?.args).toEqual(['symbol', 'FPT']);
    expect(f.methods('gte')[0]?.args).toEqual(['trade_date', '2026-10-01']);
    expect(f.methods('lte')[0]?.args).toEqual(['trade_date', '2026-10-31']);
    expect(f.methods('order')[0]?.args).toEqual(['trade_date', { ascending: true }]);
    expect(f.methods('range')[0]?.args).toEqual([0, 999]);
  });
  test('pages until a short page', async () => {
    const f = createFake();
    f.respond({ data: [{ trade_date: '2026-10-20' }, { trade_date: '2026-10-21' }] });
    f.respond({ data: [{ trade_date: '2026-10-22' }] });
    const out = await listPriceDates(f.db, 'FPT', 'a', 'b', { pageSize: 2 });
    expect(out).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(f.methods('range').map((c) => c.args)).toEqual([[0, 1], [2, 3]]);
  });
  test('bad date -> MAPPING; DB error -> DataError', async () => {
    const a = createFake();
    a.respond({ data: [{ trade_date: 'nope' }] });
    await expect(listPriceDates(a.db, 'FPT', 'a', 'b')).rejects.toMatchObject({ code: 'MAPPING' });
    const b = createFake();
    b.respond({ error: { code: '42501' } });
    await expect(listPriceDates(b.db, 'FPT', 'a', 'b')).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});

describe('getFirstPriceDates', () => {
  test('per symbol: order asc, limit 1, maybeSingle; no row is omitted', async () => {
    const f = createFake();
    f.respond({ data: { trade_date: '2026-09-01' } });
    f.respond({ data: null });
    const out = await getFirstPriceDates(f.db, ['FPT', 'VNM']);
    expect(out).toEqual({ FPT: '2026-09-01' });
    expect(f.methods('order')[0]?.args).toEqual(['trade_date', { ascending: true }]);
    expect(f.methods('limit')[0]?.args).toEqual([1]);
    expect(f.methods('maybeSingle')).toHaveLength(2);
  });
  test('empty symbols -> no call', async () => {
    const f = createFake();
    expect(await getFirstPriceDates(f.db, [])).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
});

import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getLatestIntraday, upsertPricesIntraday } from './prices-intraday';

const row = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol,
  ts: '2026-11-05T03:04:00Z',
  price: 61500,
  volume: '2400',
  source: 'vci-public',
  fetched_at: '2026-11-05T03:05:00Z',
  ...over,
});
const ins = (symbol: string, ts = '2026-11-05T03:04:00Z', over: Record<string, unknown> = {}) => ({
  symbol,
  ts,
  price: 61500,
  volume: 2400,
  source: 'vci-public',
  fetched_at: '2026-11-05T03:05:00Z',
  ...over,
});

describe('getLatestIntraday', () => {
  test('one query per symbol: eq, order ts desc, limit 1, maybeSingle; bigint volume string maps to number', async () => {
    const f = createFake();
    f.respond({ data: row('FPT') });
    f.respond({ data: row('VNM') });
    const out = await getLatestIntraday(f.db, ['FPT', 'VNM']);
    expect(f.calls.filter((c) => c.method === 'select')).toHaveLength(2);
    expect(f.methods('eq').map((c) => c.args)).toEqual([['symbol', 'FPT'], ['symbol', 'VNM']]);
    expect(f.methods('order')[0]?.args).toEqual(['ts', { ascending: false }]);
    expect(f.methods('limit')[0]?.args).toEqual([1]);
    expect(f.methods('maybeSingle').length).toBe(2);
    expect(out.FPT).toEqual({
      symbol: 'FPT',
      ts: '2026-11-05T03:04:00Z',
      price: 61500,
      volume: 2400,
      source: 'vci-public',
      fetchedAt: '2026-11-05T03:05:00Z',
    });
  });
  test('symbol without a row is omitted', async () => {
    const f = createFake();
    f.respond({ data: null });
    f.respond({ data: row('VNM') });
    expect(Object.keys(await getLatestIntraday(f.db, ['FPT', 'VNM']))).toEqual(['VNM']);
  });
  test('empty input runs no query', async () => {
    const f = createFake();
    expect(await getLatestIntraday(f.db, [])).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
});

describe('upsertPricesIntraday', () => {
  test('sends onConflict symbol,ts and rows with source and fetched_at; no select', async () => {
    const f = createFake();
    f.respond({});
    expect(await upsertPricesIntraday(f.db, [ins('FPT')])).toBe(1);
    const call = f.methods('upsert')[0];
    expect(call?.args[0]).toEqual([ins('FPT')]);
    expect(call?.args[1]).toEqual({ onConflict: 'symbol,ts' });
    expect(f.methods('select')).toHaveLength(0);
  });
  test('chunked', async () => {
    const f = createFake();
    for (let i = 0; i < 3; i++) f.respond({});
    const rows = Array.from({ length: 5 }, (_, i) => ins('FPT', `2026-11-05T03:0${i}:00Z`));
    expect(await upsertPricesIntraday(f.db, rows, { chunkSize: 2 })).toBe(5);
    expect(f.methods('upsert').map((c) => (c.args[0] as unknown[]).length)).toEqual([2, 2, 1]);
  });
  test('later duplicate wins', async () => {
    const f = createFake();
    f.respond({});
    await upsertPricesIntraday(f.db, [ins('FPT', undefined, { price: 1 }), ins('FPT', undefined, { price: 2 })]);
    expect(f.methods('upsert')[0]?.args[0]).toEqual([ins('FPT', undefined, { price: 2 })]);
  });
  test('empty input -> no call', async () => {
    const f = createFake();
    expect(await upsertPricesIntraday(f.db, [])).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
});

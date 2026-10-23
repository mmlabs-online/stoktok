import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getLatestCloses } from './prices-daily';

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

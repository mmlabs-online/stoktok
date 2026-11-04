import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { insertGaps, listAllOpenGaps, listOpenGaps, listOpenMarketGaps, resolveGaps } from './data-gaps';

const gap = { symbol: 'A', data_type: 'financials', from_ts: '2025-12-31T17:00:00.000Z', to_ts: '2026-03-31T16:59:59.000Z', source: 's', fetched_at: '2026-10-26T00:00:00.000Z' };

describe('data-gaps repo', () => {
  test('listOpenGaps filters data_type, in symbols, is resolved_at null; maps ids', async () => {
    const f = createFake();
    f.respond({ data: [{ id: '5', symbol: 'A', from_ts: gap.from_ts, to_ts: gap.to_ts }] });
    const out = await listOpenGaps(f.db, 'financials', ['A']);
    expect(f.methods('eq')[0]?.args).toEqual(['data_type', 'financials']);
    expect(f.methods('in')[0]?.args).toEqual(['symbol', ['A']]);
    expect(f.methods('is')[0]?.args).toEqual(['resolved_at', null]);
    expect(out).toEqual([{ id: 5, symbol: 'A', fromTs: gap.from_ts, toTs: gap.to_ts }]);
  });
  test('listOpenMarketGaps filters data_type, symbol is null, resolved_at is null; maps ids', async () => {
    const f = createFake();
    f.respond({ data: [{ id: '9', symbol: null, from_ts: gap.from_ts, to_ts: gap.to_ts }] });
    const out = await listOpenMarketGaps(f.db, 'prices_daily');
    expect(f.methods('eq')[0]?.args).toEqual(['data_type', 'prices_daily']);
    expect(f.methods('is').map((c) => c.args)).toEqual([['symbol', null], ['resolved_at', null]]);
    expect(out).toEqual([{ id: 9, symbol: null, fromTs: gap.from_ts, toTs: gap.to_ts }]);
  });
  test('listOpenGaps with no symbols -> no call', async () => {
    const f = createFake();
    expect(await listOpenGaps(f.db, 'financials', [])).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
  test('insertGaps sends rows without select; empty -> no call', async () => {
    const f = createFake();
    f.respond({});
    await insertGaps(f.db, [gap]);
    expect(f.methods('insert')[0]?.args[0]).toEqual([gap]);
    expect(f.methods('select')).toHaveLength(0);
    const g = createFake();
    await insertGaps(g.db, []);
    expect(g.calls).toHaveLength(0);
  });
  test('resolveGaps updates resolved_at in ids; empty -> no call', async () => {
    const f = createFake();
    f.respond({});
    await resolveGaps(f.db, [1, 2], '2026-10-26T00:00:00.000Z');
    expect(f.methods('update')[0]?.args[0]).toEqual({ resolved_at: '2026-10-26T00:00:00.000Z' });
    expect(f.methods('in')[0]?.args).toEqual(['id', [1, 2]]);
    expect(f.methods('is')[0]?.args).toEqual(['resolved_at', null]);
    const g = createFake();
    await resolveGaps(g.db, [], 'x');
    expect(g.calls).toHaveLength(0);
  });
  test('DB error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(insertGaps(f.db, [gap])).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
  test('resolveGaps with a reason also sends resolved_reason, still only unresolved rows', async () => {
    const f = createFake();
    f.respond({});
    await resolveGaps(f.db, [1], '2026-10-26T00:00:00.000Z', 'non_trading_day');
    expect(f.methods('update')[0]?.args[0]).toEqual({ resolved_at: '2026-10-26T00:00:00.000Z', resolved_reason: 'non_trading_day' });
    expect(f.methods('is')[0]?.args).toEqual(['resolved_at', null]);
    expect(f.methods('delete')).toHaveLength(0);
  });
  test('listAllOpenGaps filters only data_type and open, orders by id, pages', async () => {
    const f = createFake();
    const r = (id: string, symbol: string | null) => ({ id, symbol, from_ts: gap.from_ts, to_ts: gap.to_ts });
    f.respond({ data: [r('1', 'A'), r('2', null)] });
    f.respond({ data: [r('3', 'B')] });
    const out = await listAllOpenGaps(f.db, 'prices_daily', { pageSize: 2 });
    expect(f.methods('eq').map((c) => c.args)).toEqual([['data_type', 'prices_daily'], ['data_type', 'prices_daily']]);
    expect(f.methods('is').map((c) => c.args)).toEqual([['resolved_at', null], ['resolved_at', null]]);
    expect(f.methods('in')).toHaveLength(0);
    expect(f.methods('order')[0]?.args[0]).toBe('id');
    expect(f.methods('range').map((c) => c.args)).toEqual([[0, 1], [2, 3]]);
    expect(out.map((g) => g.id)).toEqual([1, 2, 3]);
    expect(out[1]?.symbol).toBeNull();
  });
});

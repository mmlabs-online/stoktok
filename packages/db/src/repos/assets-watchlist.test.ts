import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getAsset, listAssets } from './assets';
import { addToWatchlist, listWatchlist, removeFromWatchlist } from './watchlist';

describe('assets repo', () => {
  test('list orders as_of desc, id and maps bigint value', async () => {
    const f = createFake();
    f.respond({ data: [{ id: 'a', type: 'cash', name: 'TCBS cash', value: '5000000', as_of: '2026-01-05' }] });
    const out = await listAssets(f.db);
    expect(f.methods('order').map((c) => c.args)).toEqual([
      ['as_of', { ascending: false }],
      ['id', { ascending: true }],
    ]);
    expect(out).toEqual([{ id: 'a', type: 'cash', name: 'TCBS cash', value: 5000000, asOf: '2026-01-05' }]);
  });

  test('getAsset filters by id with maybeSingle and maps the value', async () => {
    const f = createFake();
    f.respond({ data: { id: 'a', type: 'other', name: 'Vàng', value: '50000000', as_of: '2026-01-05' } });
    const out = await getAsset(f.db, 'a');
    expect(f.methods('eq')[0]?.args).toEqual(['id', 'a']);
    expect(f.methods('maybeSingle').length).toBe(1);
    expect(out).toEqual({ id: 'a', type: 'other', name: 'Vàng', value: 50000000, asOf: '2026-01-05' });
  });

  test('getAsset: no row → NOT_FOUND; db error → DataError', async () => {
    const f = createFake();
    f.respond({ data: null });
    await expect(getAsset(f.db, 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    f.respond({ error: { code: '08006' } });
    await expect(getAsset(f.db, 'a')).rejects.toMatchObject({ name: 'DataError' });
  });

  test('asset with invalid type throws MAPPING', async () => {
    const f = createFake();
    f.respond({ data: [{ id: 'a', type: 'gold', name: 'x', value: 1, as_of: '2026-01-05' }] });
    await expect(listAssets(f.db)).rejects.toMatchObject({ code: 'MAPPING' });
  });
});

describe('watchlist repo', () => {
  test('list orders by symbol and maps entries', async () => {
    const f = createFake();
    f.respond({ data: [{ symbol: 'FPT', group_name: 'watching', added_at: '2026-01-05T00:00:00Z' }] });
    const out = await listWatchlist(f.db);
    expect(f.methods('order')[0]?.args[0]).toBe('symbol');
    expect(out).toEqual([{ symbol: 'FPT', group: 'watching', addedAt: '2026-01-05T00:00:00Z' }]);
  });

  test('addToWatchlist duplicate → CONFLICT; remove missing → NOT_FOUND', async () => {
    const f = createFake();
    f.respond({ error: { code: '23505' } });
    await expect(addToWatchlist(f.db, 'FPT')).rejects.toMatchObject({ code: 'CONFLICT' });
    f.respond({ data: [] });
    await expect(removeFromWatchlist(f.db, 'FPT')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

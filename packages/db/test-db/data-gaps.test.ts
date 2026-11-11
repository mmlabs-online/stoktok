import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { kyselyOf } from '../src/pg/access';
import { extendGaps, insertGaps, listAllOpenGaps, listOpenGaps, listOpenMarketGaps, resolveGaps } from '../src/repos/data-gaps';
import type { DataGapInsert } from '../src/rows';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await kyselyOf(t.pgDb).deleteFrom('data_gaps').execute();
});

const gap = (symbol: string | null, o: Partial<DataGapInsert> = {}): DataGapInsert => ({
  symbol,
  data_type: 'financials',
  from_ts: '2026-01-01T00:00:00+00:00',
  to_ts: '2026-03-31T00:00:00+00:00',
  source: 's1',
  fetched_at: '2026-10-26T00:00:00+00:00',
  ...o,
});
const raw = () => kyselyOf(t.pgDb).selectFrom('data_gaps').selectAll().orderBy('id').execute();

describe('data_gaps repo', () => {
  test('resolveGaps leaves an already-resolved row untouched (resolved_at and resolved_reason)', async () => {
    await insertGaps(t.pgDb, [gap('A'), gap('B')]);
    const [a, b] = await listOpenGaps(t.pgDb, 'financials', ['A', 'B']);
    await resolveGaps(t.pgDb, [a!.id], '2026-11-01T00:00:00+00:00', 'data_stored');
    await resolveGaps(t.pgDb, [a!.id, b!.id], '2026-11-05T00:00:00+00:00', 'non_trading_day');
    const rows = await raw();
    expect(rows[0]).toMatchObject({ resolved_at: '2026-11-01T00:00:00+00:00', resolved_reason: 'data_stored' });
    expect(rows[1]).toMatchObject({ resolved_at: '2026-11-05T00:00:00+00:00', resolved_reason: 'non_trading_day' });
  });

  test('resolveGaps without reason keeps resolved_reason; with reason writes it', async () => {
    await insertGaps(t.pgDb, [gap('A')]);
    const [a] = await listOpenGaps(t.pgDb, 'financials', ['A']);
    await resolveGaps(t.pgDb, [a!.id], '2026-11-01T00:00:00+00:00');
    expect((await raw())[0]).toMatchObject({ resolved_at: '2026-11-01T00:00:00+00:00', resolved_reason: null });
    await insertGaps(t.pgDb, [gap('B')]);
    const [b] = await listOpenGaps(t.pgDb, 'financials', ['B']);
    await resolveGaps(t.pgDb, [b!.id], '2026-11-02T00:00:00+00:00', 'data_stored');
    expect((await raw())[1]).toMatchObject({ resolved_reason: 'data_stored' });
  });

  test('extendGaps does not move a resolved row; to_ts < from_ts → VALIDATION', async () => {
    await insertGaps(t.pgDb, [gap('A'), gap('B')]);
    const [a, b] = await listOpenGaps(t.pgDb, 'financials', ['A', 'B']);
    await resolveGaps(t.pgDb, [a!.id], '2026-11-01T00:00:00+00:00');
    await extendGaps(t.pgDb, [a!.id, b!.id], '2026-06-30T00:00:00+00:00');
    const rows = await raw();
    expect(rows[0]!.to_ts).toBe('2026-03-31T00:00:00+00:00');
    expect(rows[1]!.to_ts).toBe('2026-06-30T00:00:00+00:00');
    await expect(extendGaps(t.pgDb, [b!.id], '2025-01-01T00:00:00+00:00')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  test('empty ids return without a query', async () => {
    const closed = await freshDb();
    await closed.pgDb.end();
    await expect(resolveGaps(closed.pgDb, [], '2026-11-01T00:00:00+00:00')).resolves.toBeUndefined();
    await expect(extendGaps(closed.pgDb, [], '2026-11-01T00:00:00+00:00')).resolves.toBeUndefined();
    await expect(insertGaps(closed.pgDb, [])).resolves.toBeUndefined();
    expect(await listOpenGaps(closed.pgDb, 'financials', [])).toEqual([]);
    await closed.drop();
  });

  test('listOpenGaps excludes NULL-symbol gaps; listOpenMarketGaps returns only them', async () => {
    await insertGaps(t.pgDb, [gap('A'), gap(null), gap('C', { data_type: 'prices' })]);
    expect((await listOpenGaps(t.pgDb, 'financials', ['A', 'C'])).map((g) => g.symbol)).toEqual(['A']);
    const market = await listOpenMarketGaps(t.pgDb, 'financials');
    expect(market.map((g) => g.symbol)).toEqual([null]);
    expect(typeof market[0]!.id).toBe('number');
  });

  test('listAllOpenGaps: 2500 rows in one call, ids ascending, no duplicates, includes NULL symbol, source filter', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => gap(i % 10 === 0 ? null : `S${i % 50}`, { source: i < 5 ? 'other' : 's1' }));
    await insertGaps(t.pgDb, rows);
    await insertGaps(t.pgDb, [gap('Z', { data_type: 'prices' })]);
    const all = await listAllOpenGaps(t.pgDb, 'financials');
    expect(all).toHaveLength(2500);
    const ids = all.map((g) => g.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(2500);
    expect(all.some((g) => g.symbol === null)).toBe(true);
    expect(await listAllOpenGaps(t.pgDb, 'financials', { source: 'other' })).toHaveLength(5);
    await resolveGaps(t.pgDb, ids.slice(0, 10), '2026-11-01T00:00:00+00:00');
    expect(await listAllOpenGaps(t.pgDb, 'financials')).toHaveLength(2490);
  });

  test('insertGaps with a NULL symbol and with more rows than one chunk', async () => {
    await insertGaps(t.pgDb, [gap(null)]);
    expect((await raw())[0]!.symbol).toBeNull();
    await insertGaps(t.pgDb, Array.from({ length: 1201 }, () => gap('M')));
    expect(await raw()).toHaveLength(1202);
  });

  test('a failing later chunk rolls back earlier chunks in insertGaps', async () => {
    const rows = Array.from({ length: 1001 }, () => gap('R'));
    rows[1000] = gap('R', { to_ts: '2025-01-01T00:00:00+00:00' }); // to_ts < from_ts
    await expect(insertGaps(t.pgDb, rows)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await raw()).toHaveLength(0);
  });
});

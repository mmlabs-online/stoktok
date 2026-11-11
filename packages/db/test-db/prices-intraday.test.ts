import { afterAll, beforeAll, expect, test } from 'vitest';
import { kyselyOf } from '../src/pg/access';
import { getLatestIntraday, upsertPricesIntraday } from '../src/repos/prices-intraday';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const row = (symbol: string, ts: string, price = 100, o: Record<string, unknown> = {}) => ({
  symbol,
  ts,
  price,
  volume: 500,
  source: 's1',
  fetched_at: '2026-11-10T03:00:00+00:00',
  ...o,
});

test('last write wins on (symbol, ts); source and fetched_at replaced; microsecond ts round-trips; latest picks newest ts', async () => {
  await upsertPricesIntraday(t.pgDb, [row('IN', '2026-11-10T02:00:00.123456+00:00', 100), row('IN', '2026-11-10T02:01:00+00:00', 101)]);
  await upsertPricesIntraday(t.pgDb, [row('IN', '2026-11-10T02:00:00.123456+00:00', 105, { source: 's2', fetched_at: '2026-11-10T04:00:00+00:00' })]);
  const rows = await kyselyOf(t.pgDb).selectFrom('prices_intraday').selectAll().where('symbol', '=', 'IN').orderBy('ts').execute();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ ts: '2026-11-10T02:00:00.123456+00:00', price: 105, source: 's2', fetched_at: '2026-11-10T04:00:00+00:00' });
  expect(rows[0]!.volume).toBe('500');
  const latest = await getLatestIntraday(t.pgDb, ['IN', 'NONE']);
  expect(Object.keys(latest)).toEqual(['IN']);
  expect(latest.IN).toMatchObject({ price: 101 });
  expect(await upsertPricesIntraday(t.pgDb, [row('IN', '2026-11-10T02:01:00+00:00'), row('IN', '2026-11-10T02:01:00+00:00', 110)])).toBe(1);
});

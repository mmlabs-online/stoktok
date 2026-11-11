import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sql } from 'kysely';
import { toSafeInt } from '@stoktok/core';
import { DataError, run } from '../src/errors';
import { chunkForParams, jsonb, upsertChunked, upsertInto } from '../src/pg/upsert';
import { kyselyOf } from '../src/pg/access';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const price = {
  symbol: 'AAA',
  trade_date: '2026-11-10',
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 100,
  source: 's1',
  fetched_at: '2026-11-10T10:00:00+00:00',
};
const key = ['symbol', 'trade_date'] as const;
const read = (symbol: string) => kyselyOf(t.pgDb).selectFrom('prices_daily').selectAll().where('symbol', '=', symbol).executeTakeFirstOrThrow();

describe('upsertInto against real Postgres', () => {
  test('full-row upsert replaces every provided column', async () => {
    await upsertInto(kyselyOf(t.pgDb), 'prices_daily', [{ ...price, symbol: 'FULL', foreign_net: 5 }], key).execute();
    await upsertInto(kyselyOf(t.pgDb), 'prices_daily', [{ ...price, symbol: 'FULL', foreign_net: 7, close: 12, high: 13, source: 's2' }], key).execute();
    const r = await read('FULL');
    expect(r).toMatchObject({ close: 12, high: 13, source: 's2', trade_date: '2026-11-10', fetched_at: '2026-11-10T10:00:00+00:00' });
    expect(toSafeInt(r.foreign_net, 'foreign_net')).toBe(7);
  });

  test('partial-column upsert leaves other columns unchanged', async () => {
    await upsertInto(kyselyOf(t.pgDb), 'prices_daily', [{ ...price, symbol: 'PART', foreign_net: 5 }], key).execute();
    await upsertInto(kyselyOf(t.pgDb), 'prices_daily', [{ ...price, symbol: 'PART', close: 12, high: 12, source: 's2' }], key).execute();
    const r = await read('PART');
    expect(toSafeInt(r.foreign_net, 'foreign_net')).toBe(5);
    expect(r).toMatchObject({ close: 12, source: 's2' });
  });

  test('ignoreDuplicates returns only inserted ids', async () => {
    const row = (url: string) => ({ url, title: 't', source: 's', credibility: 'established_outlet', published_at: '2026-11-10T00:00:00+00:00', fetched_at: '2026-11-10T00:00:00+00:00' });
    await upsertInto(kyselyOf(t.pgDb), 'news', [row('https://a.test/1')], ['url'], { ignoreDuplicates: true }).execute();
    const out = await upsertInto(kyselyOf(t.pgDb), 'news', [row('https://a.test/1'), row('https://a.test/2')], ['url'], { ignoreDuplicates: true })
      .returning('id')
      .execute();
    expect(out).toHaveLength(1);
  });

  test('duplicate conflict key in one batch fails with 21000 → DB_ERROR', async () => {
    const q = upsertInto(kyselyOf(t.pgDb), 'prices_daily', [{ ...price, symbol: 'DUP' }, { ...price, symbol: 'DUP', close: 10 }], key);
    const err = await run({ table: 'prices_daily', op: 'upsert' }, () => q.execute()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DB_ERROR', pgCode: '21000' });
  });

  test('jsonb helper round-trips an array and an object', async () => {
    await kyselyOf(t.pgDb)
      .insertInto('signals')
      .values({
        symbol: 'AAA', rule_id: 'r', horizon: 'medium', signal_date: '2026-11-10', status: 'suppressed', data_fresh: false,
        reason_codes: ['stale'], inputs_snapshot: jsonb({ refs: [1, 2], n: { x: 1 } }), rule_version: 1, computed_at: '2026-11-10T00:00:00+00:00',
      })
      .execute();
    const s = await kyselyOf(t.pgDb).selectFrom('signals').select('inputs_snapshot').executeTakeFirstOrThrow();
    expect(s.inputs_snapshot).toEqual({ refs: [1, 2], n: { x: 1 } });
    await kyselyOf(t.pgDb)
      .insertInto('ai_summaries')
      .values({ scope: 'portfolio', summary_date: '2026-11-10', generator: 'template', body: jsonb({ sections: [{ a: 1 }] }) })
      .execute();
    const a = await kyselyOf(t.pgDb).selectFrom('ai_summaries').select(['body', 'input_ids', 'created_at']).executeTakeFirstOrThrow();
    expect(a.body).toEqual({ sections: [{ a: 1 }] });
    expect(a.input_ids).toEqual([]);
    expect(a.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+\+00:00$/);
  });

  test('chunked upsert of more than one chunk writes every row', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...price, symbol: `CH${i}` }));
    const chunks = chunkForParams(rows, 25);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) await upsertInto(kyselyOf(t.pgDb), 'prices_daily', c, key).execute();
    const { rows: n } = await sql<{ n: string }>`select count(*) as n from prices_daily where symbol like 'CH%'`.execute(kyselyOf(t.pgDb));
    expect(n[0]!.n).toBe('10');
  });
});

describe('upsertChunked against real Postgres', () => {
  const ctx = { table: 'prices_daily', op: 'upsert' };
  const count = async (like: string) =>
    Number(
      (await kyselyOf(t.pgDb).selectFrom('prices_daily').select((eb) => eb.fn.countAll().as('n')).where('symbol', 'like', like).executeTakeFirstOrThrow()).n,
    );

  test('upsertChunked: one chunk writes all rows', async () => {
    const rows = [1, 2, 3].map((i) => ({ ...price, symbol: `ONE${i}`, foreign_net: null }));
    await upsertChunked(t.pgDb, ctx, 'prices_daily', rows, key, 100);
    expect(await count('ONE%')).toBe(3);
    await upsertChunked(t.pgDb, ctx, 'prices_daily', [], key, 100);
  });

  test('upsertChunked: a failing later chunk rolls back earlier chunks (VALIDATION, 0 rows)', async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ({ ...price, symbol: `TX${i}`, foreign_net: null }));
    rows[4] = { ...rows[4]!, low: 99 }; // breaks low <= open/close <= high
    const err = await upsertChunked(t.pgDb, ctx, 'prices_daily', rows, key, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect(await count('TX%')).toBe(0);
  });
});

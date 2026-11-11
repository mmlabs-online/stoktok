import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { q } from '../src/pg/access';
import type { PgDb } from '../src/pg/client';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const ctx = { table: 'news', op: 'insert' };
const news = (url: string) => ({ url, title: 't', source: 's', credibility: 'official_disclosure', published_at: '2026-11-10T00:00:00+00:00', fetched_at: '2026-11-10T00:00:00+00:00' });

describe('q()', () => {
  test('q() resolves the callback value', async () => {
    const r = await q(t.pgDb, ctx, async (k) => (await sql<{ n: number }>`select 7::int as n`.execute(k)).rows[0]!.n);
    expect(r).toBe(7);
  });

  test('q() maps a driver error to DataError with ctx and no cause', async () => {
    const url = 'https://dup.test/secret-path';
    await q(t.pgDb, ctx, (k) => k.insertInto('news').values(news(url)).execute());
    const err = (await q(t.pgDb, ctx, (k) => k.insertInto('news').values(news(url)).execute()).catch((e: unknown) => e)) as DataError;
    expect(err).toBeInstanceOf(DataError);
    expect(err).toMatchObject({ code: 'CONFLICT', table: 'news', op: 'insert', pgCode: '23505' });
    expect(err.cause).toBeUndefined();
    expect(err.message).not.toContain('dup.test');
  });

  test('q() map hook turns a raised 22023 into VALIDATION', async () => {
    const err = (await q(
      t.pgDb,
      { table: 'ai_usage', op: 'reserve' },
      (k) => sql`select * from public.ai_reserve('p', 'm', 'x', 1, 1, '2026-12-01T00:00:00+00:00'::timestamptz, '2026-11-01T00:00:00+00:00'::timestamptz)`.execute(k),
      { map: (c) => (c === '22023' ? 'VALIDATION' : undefined) },
    ).catch((e: unknown) => e)) as DataError;
    expect(err).toMatchObject({ code: 'VALIDATION', pgCode: '22023' });
    expect(err.message).toContain('validation failed [22023]');
  });

  test('a transaction inside q() rolls back on error', async () => {
    const err = await q(t.pgDb, { table: 'assets', op: 'tx' }, (k) =>
      k.transaction().execute(async (trx) => {
        await trx.insertInto('assets').values({ type: 'cash', name: 'ok-row', value: 1, as_of: '2026-11-10' }).execute();
        await trx.insertInto('assets').values({ type: 'cash', name: 'bad-row', value: -1, as_of: '2026-11-10' }).execute();
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    const { rows } = await q(t.pgDb, ctx, (k) => sql<{ n: number }>`select count(*)::int as n from assets where name in ('ok-row','bad-row')`.execute(k));
    expect(rows[0]!.n).toBe(0);
  });

  test('kyselyOf rejects a non-handle', async () => {
    const err = await q({} as PgDb, ctx, (k) => sql`select 1`.execute(k)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DB_ERROR' });
  });
});

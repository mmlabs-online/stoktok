import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sql } from 'kysely';
import { DataError, run } from '../src/errors';
import { createPgDb, DATABASE_URL_ENV } from '../src/pg/client';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const news = (url: string) => ({ url, title: 't', source: 's', credibility: 'official_disclosure', published_at: '2026-11-10T00:00:00+00:00', fetched_at: '2026-11-10T00:00:00+00:00' });

describe('toDataError against real errors', () => {
  test('unique violation on a real table maps to CONFLICT without the key value', async () => {
    const url = 'https://secret-key.test/a';
    await t.pgDb.kysely.insertInto('news').values(news(url)).execute();
    const err = await run({ table: 'news', op: 'insert' }, () => t.pgDb.kysely.insertInto('news').values(news(url)).execute()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect(err).toMatchObject({ code: 'CONFLICT', pgCode: '23505' });
    expect((err as DataError).message).not.toContain('secret-key');
    expect((err as DataError).cause).toBeUndefined();
  });

  test('check violation maps to VALIDATION', async () => {
    const err = await run({ table: 'news', op: 'insert' }, () => t.pgDb.kysely.insertInto('news').values(news('not-a-url')).execute()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION', pgCode: '23514' });
  });

  test('unreachable server maps to DB_ERROR without host or password', async () => {
    const db = createPgDb({ [DATABASE_URL_ENV]: 'postgres://u:pw-x@127.0.0.1:1/x' }, 'web');
    const err = await run({ table: 't', op: 'o' }, () => sql`select 1`.execute(db.kysely)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DB_ERROR' });
    expect((err as DataError).pgCode).toBeUndefined();
    expect((err as DataError).message).not.toMatch(/pw-x|127\.0\.0\.1/);
    await db.end();
  });
});

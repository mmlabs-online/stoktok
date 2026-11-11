import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb('worker');
});
afterAll(async () => {
  await t.drop();
});

describe('pool session', () => {
  test('each connection has UTC, ISO datestyle, statement_timeout and application_name', async () => {
    const q = () =>
      sql<{ tz: string; ds: string; st: string; app: string; pid: number }>`
        select current_setting('TimeZone') as tz, current_setting('DateStyle') as ds,
               current_setting('statement_timeout') as st, current_setting('application_name') as app,
               pg_backend_pid() as pid, pg_sleep(0.2)`.execute(t.pgDb.kysely);
    const [a, b] = await Promise.all([q(), q()]);
    const rows = [a.rows[0]!, b.rows[0]!];
    expect(rows[0]!.pid).not.toBe(rows[1]!.pid);
    for (const r of rows) {
      expect(r).toMatchObject({ tz: 'UTC', ds: 'ISO, YMD', st: '2min', app: 'stoktok-worker' });
    }
  });

  test('end() closes all clients (totalCount 0) and later queries reject', async () => {
    const db = await freshDb('web');
    await sql`select 1`.execute(db.pgDb.kysely);
    await db.pgDb.end();
    await expect(sql`select 1`.execute(db.pgDb.kysely)).rejects.toThrow();
    await db.drop();
  });
});

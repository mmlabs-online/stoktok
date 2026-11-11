import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createPgDb, DATABASE_URL_ENV } from '../src/pg/client';
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

describe('session setup fails closed', () => {
  test('a failing setup rejects the caller, writes nothing, leaks no client, and a healthy pool still works', async () => {
    const good = await freshDb('worker');
    await sql`create table race_t (id int)`.execute(good.pgDb.kysely);
    const bad = createPgDb({ [DATABASE_URL_ENV]: good.url }, 'worker', { statementTimeoutMs: 'x' as unknown as number });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(sql`insert into race_t values (1)`.execute(bad.kysely)).rejects.toThrow();
      expect(bad.pool.totalCount).toBe(0);
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from race_t`.execute(good.pgDb.kysely);
      expect(rows[0]!.n).toBe(0);
      const logged = err.mock.calls.map((c) => String(c[0]));
      expect(logged.some((l) => JSON.parse(l).event === 'db_session_init_failed')).toBe(true);
      expect(logged.join('')).not.toContain('statement_timeout');
      await sql`insert into race_t values (2)`.execute(good.pgDb.kysely);
      expect((await sql`select * from race_t`.execute(good.pgDb.kysely)).rows).toEqual([{ id: 2 }]);
    } finally {
      err.mockRestore();
      await bad.end();
      await good.drop();
    }
  });
});

import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DataError } from '../src/errors';
import { kyselyOf, q } from '../src/pg/access';
import { createPgDb, DATABASE_URL_ENV } from '../src/pg/client';
import { freshDb, type TestDb } from './harness';
import { startPgProxy, type ProxyMode } from './pg-proxy';

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
               pg_backend_pid() as pid, pg_sleep(0.2)`.execute(kyselyOf(t.pgDb));
    const [a, b] = await Promise.all([q(), q()]);
    const rows = [a.rows[0]!, b.rows[0]!];
    expect(rows[0]!.pid).not.toBe(rows[1]!.pid);
    for (const r of rows) {
      expect(r).toMatchObject({ tz: 'UTC', ds: 'ISO, YMD', st: '2min', app: 'stoktok-worker' });
    }
  });

  test('end() twice resolves, stats().total is 0, later q() rejects with DataError', async () => {
    const db = await freshDb('web');
    await sql`select 1`.execute(kyselyOf(db.pgDb));
    await db.pgDb.end();
    await expect(db.pgDb.end()).resolves.toBeUndefined();
    expect(db.pgDb.stats().total).toBe(0);
    const err = await q(db.pgDb, { table: 't', op: 'o' }, (k) => sql`select 1`.execute(k)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    await db.drop();
  });

  test('stats() reports total/idle/waiting', async () => {
    const db = await freshDb('worker');
    expect(db.pgDb.stats()).toEqual({ total: 0, idle: 0, waiting: 0 });
    const k = kyselyOf(db.pgDb);
    await Promise.all([sql`select pg_sleep(0.2)`.execute(k), sql`select pg_sleep(0.2)`.execute(k)]);
    expect(db.pgDb.stats()).toEqual({ total: 2, idle: 2, waiting: 0 });
    await db.drop();
  });
});

describe('session setup fails closed', () => {
  test('a failing setup rejects the caller, writes nothing, leaks no client, and a healthy pool still works', async () => {
    const good = await freshDb('worker');
    await sql`create table race_t (id int)`.execute(kyselyOf(good.pgDb));
    const bad = createPgDb({ [DATABASE_URL_ENV]: good.url }, 'worker', { statementTimeoutMs: 'x' as unknown as number });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(sql`insert into race_t values (1)`.execute(kyselyOf(bad))).rejects.toThrow();
      expect(bad.stats().total).toBe(0);
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from race_t`.execute(kyselyOf(good.pgDb));
      expect(rows[0]!.n).toBe(0);
      const logged = err.mock.calls.map((c) => String(c[0]));
      expect(logged.some((l) => JSON.parse(l).event === 'db_session_init_failed')).toBe(true);
      expect(logged.join('')).not.toContain('statement_timeout');
      await sql`insert into race_t values (2)`.execute(kyselyOf(good.pgDb));
      expect((await sql`select * from race_t`.execute(kyselyOf(good.pgDb))).rows).toEqual([{ id: 2 }]);
    } finally {
      err.mockRestore();
      await bad.end();
      await good.drop();
    }
  });
});

describe('session setup survives a connection fault (process must not crash)', () => {
  const ctx = { table: 't', op: 'o' };

  async function scenario(mode: ProxyMode, overrides: { connectionTimeoutMillis?: number } = {}) {
    const base = await freshDb('worker');
    const proxy = await startPgProxy(base.url, process.env.DB_TEST_URL as string);
    const db = createPgDb({ [DATABASE_URL_ENV]: proxy.url }, 'worker', overrides);
    const uncaught = vi.fn();
    const unhandled = vi.fn();
    process.on('uncaughtException', uncaught);
    process.on('unhandledRejection', unhandled);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      proxy.setMode(mode);
      const started = Date.now();
      const err = await q(db, ctx, (k) => sql`select 1`.execute(k)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DataError);
      expect(err).toMatchObject({ code: 'DB_ERROR' });
      expect(Date.now() - started).toBeLessThan(3000);
      await new Promise((r) => setTimeout(r, 100));
      expect(uncaught).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
      expect(db.stats().total).toBe(0);
      proxy.setMode('pass');
      const ok = await q(db, ctx, (k) => sql<{ n: number }>`select 1::int as n`.execute(k));
      expect(ok.rows[0]!.n).toBe(1);
    } finally {
      process.off('uncaughtException', uncaught);
      process.off('unhandledRejection', unhandled);
      log.mockRestore();
      await db.end().catch(() => undefined);
      await proxy.close();
      await base.drop();
    }
  }

  test('setup survives pg_terminate_backend during set_config', () => scenario('terminate'));
  test('setup survives a socket drop during set_config', () => scenario('drop'));
  test('setup survives a stalled set_config until connectionTimeoutMillis', () => scenario('stall', { connectionTimeoutMillis: 300 }));
});

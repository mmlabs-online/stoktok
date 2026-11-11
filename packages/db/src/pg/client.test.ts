import { describe, expect, test, vi } from 'vitest';
import { createPgDb, DATABASE_URL_ENV } from './client';
import { PG_POOL_PROFILES, type PgProfile, type PoolProfile } from './config';

/** Builds a PgDb while spying on the pg.Pool constructor to read its config and instance. */
async function build(url: string, profile: PgProfile, overrides?: Partial<PoolProfile>) {
  const { default: pg } = await import('pg');
  const orig = pg.Pool;
  const pool = {} as { cfg: Record<string, unknown>; instance: InstanceType<typeof orig> };
  class Spy extends orig {
    constructor(cfg: Record<string, unknown>) {
      super(cfg);
      pool.cfg = cfg;
      pool.instance = this;
    }
  }
  (pg as { Pool: unknown }).Pool = Spy;
  try {
    return { pool, db: createPgDb({ [DATABASE_URL_ENV]: url }, profile, overrides) };
  } finally {
    (pg as { Pool: unknown }).Pool = orig;
  }
}

function msgOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

describe('createPgDb', () => {
  test('throws naming the variable without echoing the value', () => {
    expect(msgOf(() => createPgDb({}, 'web'))).toBe('Missing env STOKTOK_DATABASE_URL');
    expect(msgOf(() => createPgDb({ [DATABASE_URL_ENV]: '' }, 'web'))).toBe('Missing env STOKTOK_DATABASE_URL');
  });

  test('rejects non-postgres schemes (http://, mysql://) without echoing the value', () => {
    for (const url of ['http://u:pw-secret@host/db', 'mysql://u:pw-secret@host/db']) {
      const msg = msgOf(() => createPgDb({ [DATABASE_URL_ENV]: url }, 'web'));
      expect(msg).toBe('Invalid env STOKTOK_DATABASE_URL');
      expect(msg).not.toContain('pw-secret');
    }
  });

  test('constructing does not connect', async () => {
    const { pool, db } = await build('postgres://u:pw@127.0.0.1:1/x', 'worker');
    expect(pool.instance.totalCount).toBe(0);
    await db.end();
  });

  test('profile values reach the pool config; overrides win', async () => {
    const url = 'postgres://u:pw@127.0.0.1:1/x';
    expect(PG_POOL_PROFILES.web.max).toBe(5);
    expect(PG_POOL_PROFILES.worker.max).toBe(2);
    expect(PG_POOL_PROFILES.web.applicationName).toBe('stoktok-web');
    const web = await build(url, 'web');
    expect(web.pool.cfg).toMatchObject({ max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
    await web.db.end();
    const worker = await build(url, 'worker', { max: 1 });
    expect(worker.pool.cfg).toMatchObject({ max: 1, connectionTimeoutMillis: 5_000 });
    await worker.db.end();
  });

  test('a failed session init logs the code only and drops the client', async () => {
    const { pool, db } = await build('postgres://u:pw@127.0.0.1:1/x', 'worker');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const end = vi.fn(() => Promise.resolve());
    const client = { query: () => Promise.reject(Object.assign(new Error('boom host=secret.example pw'), { code: '57014' })), end };
    pool.instance.emit('connect', client);
    await new Promise((r) => setImmediate(r));
    expect(end).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({ event: 'db_session_init_failed', code: '57014' });
    expect(line).not.toContain('secret.example');
    err.mockRestore();
    await db.end();
  });
});

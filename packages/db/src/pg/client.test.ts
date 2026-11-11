import { inspect } from 'node:util';
import { describe, expect, test, vi } from 'vitest';
import { AI_KEYS_MASTER_KEY_ENV, createPgDb, DATABASE_URL_ENV } from './client';
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
});

describe('opaque handle', () => {
  test('handle is opaque: only end and stats; inspect(showHidden) and JSON contain no sentinel password', async () => {
    const { db } = await build('postgres://u:pw-SENTINEL-123@127.0.0.1:1/x', 'worker');
    expect(Object.keys(db)).toEqual(['end', 'stats']);
    expect(JSON.stringify(db)).toBe('{}');
    const shown = inspect(db, { showHidden: true, depth: Infinity, getters: false });
    expect(shown).not.toContain('pw-SENTINEL');
    expect(shown).not.toContain('127.0.0.1');
    expect(Object.isFrozen(db)).toBe(true);
    expect('pool' in db).toBe(false);
    await db.end();
  });

  test('stats() is zero before any query', async () => {
    const { pool, db } = await build('postgres://u:pw@127.0.0.1:1/x', 'worker');
    expect(db.stats()).toEqual({ total: 0, idle: 0, waiting: 0 });
    expect(pool.instance.totalCount).toBe(0);
    await db.end();
  });

  test('end() twice resolves (never connected)', async () => {
    const { db } = await build('postgres://u:pw@127.0.0.1:1/x', 'worker');
    await db.end();
    await expect(db.end()).resolves.toBeUndefined();
  });
});

describe('AI keyring on the handle', () => {
  const URL_ = 'postgres://u:pw@127.0.0.1:1/x';
  const VALID = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

  test('an invalid master key does not throw and logs {event:ai_keyring_invalid} once, with no value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const bad = 'SENTINEL-not-a-key';
      const db = createPgDb({ [DATABASE_URL_ENV]: URL_, [AI_KEYS_MASTER_KEY_ENV]: bad }, 'worker');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual([JSON.stringify({ event: 'ai_keyring_invalid' })]);
      await db.end();
    } finally {
      spy.mockRestore();
    }
  });

  test('no log when the master key is absent or valid', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await createPgDb({ [DATABASE_URL_ENV]: URL_ }, 'worker').end();
      await createPgDb({ [DATABASE_URL_ENV]: URL_, [AI_KEYS_MASTER_KEY_ENV]: '' }, 'worker').end();
      await createPgDb({ [DATABASE_URL_ENV]: URL_, [AI_KEYS_MASTER_KEY_ENV]: VALID }, 'worker').end();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('with a master key set the handle stays opaque: inspect and JSON hold no key; keys are still end and stats', async () => {
    const db = createPgDb({ [DATABASE_URL_ENV]: URL_, [AI_KEYS_MASTER_KEY_ENV]: VALID }, 'worker');
    const shown = inspect(db, { showHidden: true, depth: Infinity, getters: false }) + JSON.stringify(db);
    expect(shown).not.toContain(VALID);
    expect(shown).not.toContain(Buffer.from(VALID, 'base64').toString('hex'));
    expect(Object.keys(db)).toEqual(['end', 'stats']);
    await db.end();
  });
});

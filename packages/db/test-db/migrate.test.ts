import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { checksum, MIGRATION_LOCK_KEY, MigrationError, runMigrations } from '../src/pg/migrate';
import { emptyDb, freshDb } from './harness';

const tmps: string[] = [];
function tmpDir(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'stoktok-mig-'));
  tmps.push(d);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c);
  return d;
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const V1 = '20261111000201';
const V2 = '20261111000202';
const f = (v: string) => `${v}_t${v.slice(-1)}.sql`;

async function withDb(fn: (url: string, q: <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>) => Promise<void>) {
  const db = await emptyDb();
  const q = async <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const c = new pg.Client({ connectionString: db.url });
    await c.connect();
    try {
      return (await c.query<T>(sql, params)).rows;
    } finally {
      await c.end();
    }
  };
  try {
    await fn(db.url, q);
  } finally {
    await db.drop();
  }
}

async function rejects(p: Promise<unknown>): Promise<MigrationError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(MigrationError);
    return e as MigrationError;
  }
  throw new Error('expected rejection');
}

const versions = (q: (s: string) => Promise<{ version: string }[]>) => q('select version from public.schema_migrations order by 1').then((r) => r.map((x) => x.version));

describe('runner against Postgres', () => {
  test('template holds exactly the baseline row', async () => {
    const t = await freshDb();
    try {
      const c = new pg.Client({ connectionString: t.url });
      await c.connect();
      const { rows } = await c.query('select version, name, checksum from public.schema_migrations');
      await c.end();
      const sum = checksum(readFileSync(join(__dirname, '..', '..', '..', 'db/migrations/20261111000200_baseline.sql')));
      expect(rows).toEqual([{ version: '20261111000200', name: 'baseline', checksum: sum }]);
    } finally {
      await t.drop();
    }
  });

  test('fresh apply then idempotent re-run', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'create table a1 (x int);', [f(V2)]: 'create table a2 (x int);' });
      const r1 = await runMigrations({ connectionString: url, dir });
      expect(r1.applied).toEqual([V1, V2]);
      const log = vi.fn();
      const r2 = await runMigrations({ connectionString: url, dir, log });
      expect(r2.applied).toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('up to date'));
      expect(await versions(q)).toEqual([V1, V2]);
    }));

  test('session settings inside a migration', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({
        [f(V1)]:
          "create table probe as select current_setting('lock_timeout') lt, current_setting('statement_timeout') st, current_setting('application_name') app, current_setting('stoktok.migrating') m;",
      });
      await runMigrations({ connectionString: url, dir });
      expect(await q('select lt, st, app, m from probe')).toEqual([{ lt: '10s', st: '5min', app: 'stoktok-migrate', m: 'on' }]);
      const after = await q<{ s: string | null }>("select current_setting('stoktok.migrating', true) as s");
      expect(after[0]!.s ?? '').toBe('');
    }));

  test('checksum mismatch exits 1 and applies nothing', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'create table m1 (x int);\n' });
      await runMigrations({ connectionString: url, dir });
      // LF to CRLF only: no mismatch.
      writeFileSync(join(dir, f(V1)), 'create table m1 (x int);\r\n');
      await runMigrations({ connectionString: url, dir });
      writeFileSync(join(dir, f(V1)), 'create table m1 (x int, y int);\n');
      writeFileSync(join(dir, f(V2)), 'create table m2 (x int);');
      const e = await rejects(runMigrations({ connectionString: url, dir }));
      expect(e.exitCode).toBe(1);
      expect(e.message).toBe(`checksum mismatch for applied migration ${V1}`);
      expect((await q<{ r: string | null }>("select to_regclass('public.m2') as r"))[0]!.r).toBeNull();
      expect(await versions(q)).toEqual([V1]);
    }));

  test('a failing file rolls back with no row', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'create table ok1 (x int);', [f(V2)]: 'create table half (x int); select 1/0;' });
      const e = await rejects(runMigrations({ connectionString: url, dir }));
      expect(e.exitCode).toBe(1);
      expect(e.code).toBe('22012');
      expect(e.message.startsWith(`migration ${V2} failed:`)).toBe(true);
      expect((await q<{ r: string | null }>("select to_regclass('public.half') as r"))[0]!.r).toBeNull();
      expect(await versions(q)).toEqual([V1]);
    }));

  test('a file that commits itself is rejected', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'create table selfc (x int); commit;' });
      const e = await rejects(runMigrations({ connectionString: url, dir }));
      expect(e.exitCode).toBe(1);
      expect(e.message).toContain('ended the transaction itself');
      expect(await versions(q)).toEqual([]);
      // Known limitation (as in TuDo): the table survives because the file committed. migrations-lint.test.ts is the primary defence.
      expect((await q<{ r: string | null }>("select to_regclass('public.selfc') as r"))[0]!.r).toBe('selfc');
    }));

  test('database ahead applies nothing', () =>
    withDb(async (url, q) => {
      await runMigrations({ connectionString: url, dir: tmpDir({ [f(V1)]: 'create table d1 (x int);', [f(V2)]: 'create table d2 (x int);' }) });
      const log = vi.fn();
      const r = await runMigrations({ connectionString: url, dir: tmpDir({ [f(V1)]: 'create table d1 (x int);' }), log });
      expect(r).toEqual({ applied: [], ahead: [V2] });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('database is ahead'));
      expect(await versions(q)).toEqual([V1, V2]);
    }));

  async function holdLock(url: string) {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    return {
      release: async () => {
        await c.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
        await c.end();
      },
    };
  }

  test('a held lock blocks until released', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'create table lk (x int);' });
      const lock = await holdLock(url);
      const run = runMigrations({ connectionString: url, dir, lockWaitMs: 10_000 });
      await new Promise((r) => setTimeout(r, 300));
      expect((await q<{ r: string | null }>("select to_regclass('public.schema_migrations') as r"))[0]!.r).toBeNull();
      await lock.release();
      expect((await run).applied).toEqual([V1]);
    }));

  test('lock wait times out', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'create table lk (x int);' });
      const lock = await holdLock(url);
      try {
        const e = await rejects(runMigrations({ connectionString: url, dir, lockWaitMs: 300 }));
        expect(e.exitCode).toBe(1);
        expect(e.message).toBe('another migration is running');
        expect((await q<{ r: string | null }>("select to_regclass('public.schema_migrations') as r"))[0]!.r).toBeNull();
      } finally {
        await lock.release();
      }
    }));

  test('two concurrent runners apply each file once', () =>
    withDb(async (url, q) => {
      const dir = tmpDir({ [f(V1)]: 'select pg_sleep(0.5); create table once_t (x int);' });
      const [a, b] = await Promise.all([runMigrations({ connectionString: url, dir }), runMigrations({ connectionString: url, dir })]);
      expect([...a.applied, ...b.applied]).toEqual([V1]);
      expect(await versions(q)).toEqual([V1]);
    }));
});

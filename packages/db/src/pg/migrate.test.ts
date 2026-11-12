import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import pg from 'pg';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { DATABASE_URL_ENV } from './client';
import { checksum, MIGRATION_LOCK_KEY, migrateFromEnv, MigrationError, parseMigrationFilename, planMigrations, readMigrationFiles, runMigrations, safeDetail, type MigrationRef } from './migrate';

const tmps: string[] = [];
function tmpDir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'stoktok-mig-'));
  tmps.push(d);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, n), c);
  return d;
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const ref = (version: string, sum = 'x'): MigrationRef => ({ version, name: 'n', checksum: sum });

async function fail(p: Promise<unknown>): Promise<MigrationError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(MigrationError);
    return e as MigrationError;
  }
  throw new Error('expected rejection');
}

describe('parseMigrationFilename', () => {
  test('accepts valid names', () => {
    expect(parseMigrationFilename('20261111000200_baseline.sql')).toEqual({ version: '20261111000200', name: 'baseline' });
    expect(parseMigrationFilename('20261111000200_a_1.sql')).toEqual({ version: '20261111000200', name: 'a_1' });
  });
  test.each([
    '20261111000200_baseline.down.sql',
    '20261111000200_Baseline.sql',
    '2026111100020_x.sql',
    '202611110002000_x.sql',
    '20261111000200x.sql',
    '20261111000200_x-y.sql',
    '20261111000200_x.SQL',
    '20261111000200_x.sql ',
    '20261111000200_bảng.sql',
    '',
    'dir/20261111000200_x.sql',
    'README.md',
  ])('rejects %j', (n) => {
    expect(parseMigrationFilename(n)).toBeNull();
  });
});

describe('checksum', () => {
  test('known sha256, CRLF and Buffer equivalence', () => {
    expect(checksum('select 1;\n')).toBe('4a45092ccf992ea92250053a80b931b787924ba61648f420555511b84f10ab6c');
    expect(checksum('select 1;\r\n')).toBe(checksum('select 1;\n'));
    expect(checksum(Buffer.from('select 1;\n'))).toBe(checksum('select 1;\n'));
  });
  test('lone CR is not normalised; different content differs', () => {
    expect(checksum('a\rb')).not.toBe(checksum('a\nb'));
    expect(checksum('a')).not.toBe(checksum('b'));
  });
});

describe('planMigrations', () => {
  test('empty', () => {
    expect(planMigrations([], [])).toEqual({ pending: [], ahead: [] });
  });
  test('sorts pending and skips applied', () => {
    const local = [ref('3'.padStart(14, '0')), ref('1'.padStart(14, '0')), ref('2'.padStart(14, '0'))];
    const snapshot = JSON.stringify(local);
    const r = planMigrations(local, [ref('1'.padStart(14, '0'))]);
    expect(r.pending.map((m) => m.version)).toEqual(['00000000000002', '00000000000003']);
    expect(JSON.stringify(local)).toBe(snapshot);
    expect(planMigrations(local, []).pending.map((m) => m.version)).toEqual(['00000000000001', '00000000000002', '00000000000003']);
  });
  test('checksum mismatch names the version', () => {
    expect(() => planMigrations([ref('20260000000001', 'a')], [ref('20260000000001', 'b')])).toThrow(/checksum mismatch for applied migration 20260000000001/);
    try {
      planMigrations([ref('20260000000001', 'a')], [ref('20260000000001', 'b')]);
    } catch (e) {
      expect((e as MigrationError).exitCode).toBe(1);
    }
  });
  test('applied but missing locally and older than newest local', () => {
    expect(() => planMigrations([ref('20260000000002')], [ref('20260000000001')])).toThrow(/missing locally/);
  });
  test('applied newer than every local is ahead', () => {
    expect(planMigrations([ref('20260000000001')], [ref('20260000000001'), ref('20260000000009')])).toEqual({ pending: [], ahead: ['20260000000009'] });
  });
  test('pending older than the newest applied known version', () => {
    expect(() => planMigrations([ref('20260000000001'), ref('20260000000002')], [ref('20260000000002')])).toThrow(/older than the newest applied/);
  });
});

describe('readMigrationFiles', () => {
  test('reads sql files in version order and ignores others', async () => {
    const d = tmpDir({ 'README.md': 'x', '20261111000300_b.sql': 'select 2;', '20261111000200_a.sql': 'select 1;' });
    const files = await readMigrationFiles(d);
    expect(files.map((f) => f.version)).toEqual(['20261111000200', '20261111000300']);
    expect(files[0]).toMatchObject({ name: 'a', sql: 'select 1;', checksum: checksum('select 1;') });
  });
  test('invalid name, .down.sql and missing dir are exit 2', async () => {
    const e1 = await fail(readMigrationFiles(tmpDir({ 'x.sql': '' })));
    expect(e1.exitCode).toBe(2);
    expect(e1.message).toContain('invalid migration file name');
    expect((await fail(readMigrationFiles(tmpDir({ '20261111000200_a.down.sql': '' })))).exitCode).toBe(2);
    const e3 = await fail(readMigrationFiles(join(tmpDir(), 'nope')));
    expect(e3.exitCode).toBe(2);
    expect(e3.message).toContain('migrations directory not found');
  });
  test('a duplicate version is exit 2 before anything runs', async () => {
    const e = await fail(readMigrationFiles(tmpDir({ '20261111000300_a.sql': 'select 1;', '20261111000300_b.sql': 'select 2;' })));
    expect(e.exitCode).toBe(2);
    expect(e.message).toBe('duplicate migration version 20261111000300');
  });
  test('a symlink or directory named like a migration is exit 2', async () => {
    const target = tmpDir({ 'real.txt': 'select 1;' });
    const withLink = tmpDir();
    symlinkSync(join(target, 'real.txt'), join(withLink, '20261111000200_a.sql'));
    const e1 = await fail(readMigrationFiles(withLink));
    expect(e1.exitCode).toBe(2);
    expect(e1.message).toContain('not a regular file');
    const withDir = tmpDir();
    mkdirSync(join(withDir, '20261111000200_a.sql'));
    expect((await fail(readMigrationFiles(withDir))).exitCode).toBe(2);
  });
  test("the repo's db/migrations parses and holds the baseline", async () => {
    const files = await readMigrationFiles(join(__dirname, '..', '..', '..', '..', 'db', 'migrations'));
    expect(files.map((f) => `${f.version}/${f.name}`)).toContain('20261111000200/baseline');
  });
});

const SENTINEL_URL = 'postgres://u:pw-SENTINEL-9@127.0.0.1:9/x';

describe('runMigrations', () => {
  test('config errors come before connecting', async () => {
    const e = await fail(runMigrations({ connectionString: SENTINEL_URL, dir: join(tmpDir(), 'missing') }));
    expect(e.exitCode).toBe(2);
  });

  test('unreachable database: exit 1, no URL in message, String() or inspect()', async () => {
    const log = vi.fn();
    const e = await fail(runMigrations({ connectionString: SENTINEL_URL, dir: tmpDir({ '20261111000200_a.sql': 'select 1;' }), log }));
    expect(e.exitCode).toBe(1);
    for (const text of [e.message, String(e), inspect(e, { showHidden: true, depth: Infinity })]) {
      expect(text).not.toContain('pw-SENTINEL');
      expect(text).not.toContain('127.0.0.1');
    }
    expect(e.cause).toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/pw-SENTINEL|127\.0\.0\.1/);
  });
});

test('malformed URL: connect failure leaks neither password nor host', async () => {
  const e = await fail(runMigrations({ connectionString: 'postgres://u:pw-SENTINEL%ZZ@h-SENTINEL:notaport/x', dir: tmpDir({ '20261111000200_a.sql': 'select 1;' }) }));
  expect(e.exitCode).toBe(1);
  for (const text of [e.message, String(e), inspect(e, { showHidden: true, depth: Infinity })]) expect(text).not.toMatch(/SENTINEL/);
  expect(e.cause).toBeUndefined();
});

describe('safeDetail', () => {
  test('keeps a server error message, hides everything else', () => {
    expect(safeDetail(new pg.DatabaseError('division by zero', 0, 'error'))).toBe('division by zero');
    expect(safeDetail(new Error('connect ECONNREFUSED 10.0.0.1:5432 pw-SENTINEL'))).toBe('unexpected error');
    expect(safeDetail('x')).toBe('unexpected error');
  });
});

test('the lock key is above 2^31 so it cannot collide with int4 hashtext keys', () => {
  expect(BigInt(MIGRATION_LOCK_KEY) > 2n ** 31n).toBe(true);
});

describe('migrateFromEnv', () => {
  test('missing or empty URL is exit 2', async () => {
    for (const env of [{}, { [DATABASE_URL_ENV]: '' }]) {
      const e = await fail(migrateFromEnv(env, { dir: tmpDir() }));
      expect(e.exitCode).toBe(2);
      expect(e.message).toBe(`${DATABASE_URL_ENV} is not set`);
    }
  });
  test('invalid URL is exit 2 without echoing the value', async () => {
    const e = await fail(migrateFromEnv({ [DATABASE_URL_ENV]: 'mysql://u:pw-SENTINEL@h/x' }, { dir: tmpDir() }));
    expect(e.exitCode).toBe(2);
    expect(e.message).not.toContain('pw-SENTINEL');
  });
});

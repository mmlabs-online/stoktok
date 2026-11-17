import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MigrationError } from '@stoktok/db/pg';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MIGRATE_USAGE, migrateCommand, resolveMigrationsDir } from './migrate';

describe('resolveMigrationsDir', () => {
  test('image layout', () => {
    const want = resolve('/app/migrations');
    expect(resolveMigrationsDir(resolve('/app/dist'), (p) => p === want)).toBe(want);
  });
  test('repo from src and from dist; neither exists; both exist', () => {
    const root = resolve('/r');
    const want = resolve(root, 'db/migrations');
    for (const sub of ['src', 'dist']) {
      const moduleDir = resolve(root, 'apps/worker', sub);
      expect(resolveMigrationsDir(moduleDir, (p) => p === want)).toBe(want);
      expect(resolveMigrationsDir(moduleDir, () => false)).toBe(resolve(moduleDir, '../migrations'));
      expect(resolveMigrationsDir(moduleDir, () => true)).toBe(resolve(moduleDir, '../migrations'));
    }
  });
  test('the real repo', () => {
    const dir = resolveMigrationsDir(__dirname, existsSync);
    expect(dir).toBe(join(__dirname, '../../../db/migrations'));
    expect(readdirSync(dir)).toContain('20261111000200_baseline.sql');
  });
});

describe('migrateCommand', () => {
  const realExitCode = process.exitCode;
  let out: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    out = vi.spyOn(console, 'log').mockImplementation(() => {});
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });
  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
    process.exitCode = realExitCode;
  });
  const calls = () => [...out.mock.calls, ...err.mock.calls].flat().join('\n');

  test('extra argument -> usage, exit 2, run not called', async () => {
    for (const argv of [['x'], ['--dry-run'], ['a', 'b']]) {
      const run = vi.fn();
      err.mockClear();
      await migrateCommand(argv, { env: {}, dir: '/d', run });
      expect(run).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalledWith(MIGRATE_USAGE);
      expect(process.exitCode).toBe(2);
    }
  });

  test('success -> exit 0, log lines on stdout', async () => {
    const env = { A: 'b' };
    const run = vi.fn(async (_e: unknown, opts: { log?: (l: string) => void }) => {
      opts.log?.('applied 1_x (3 ms)');
      return { applied: ['1'], ahead: [] };
    });
    await migrateCommand([], { env, dir: '/d', run: run as never });
    expect(out).toHaveBeenCalledWith('applied 1_x (3 ms)');
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    expect(run).toHaveBeenCalledWith(env, { dir: '/d', log: expect.any(Function) });
  });

  test('MigrationError maps exit code and code suffix', async () => {
    const cases: [MigrationError, string, number][] = [
      [new MigrationError('another migration is running', 1), 'migrate failed: another migration is running', 1],
      [new MigrationError('migration 1 failed: division by zero', 1, '22012'), 'migrate failed: migration 1 failed: division by zero [22012]', 1],
      [new MigrationError('X is not set', 2), 'migrate failed: X is not set', 2],
    ];
    for (const [e, msg, code] of cases) {
      err.mockClear();
      await migrateCommand([], { env: {}, dir: '/d', run: () => Promise.reject(e) });
      expect(err).toHaveBeenCalledWith(msg);
      expect(process.exitCode).toBe(code);
    }
  });

  test('unknown error -> fixed text, exit 1, no echo', async () => {
    const runs: (() => Promise<never>)[] = [
      () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9 pw-SENTINEL')),
      () => Promise.reject('boom'),
      () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9 pw-SENTINEL');
      },
    ];
    for (const run of runs) {
      err.mockClear();
      out.mockClear();
      await migrateCommand([], { env: {}, dir: '/d', run });
      expect(err).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledWith('migrate failed: unexpected error');
      expect(calls()).not.toMatch(/pw-SENTINEL|127\.0\.0\.1/);
      expect(process.exitCode).toBe(1);
    }
  });

  describe('real migrateFromEnv', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'stk-mig-'));
    });
    afterEach(() => rmSync(tmp, { recursive: true, force: true }));

    test('missing URL exits 2', async () => {
      await migrateCommand([], { env: {}, dir: tmp });
      expect(process.exitCode).toBe(2);
      const msg = String(err.mock.calls[0]?.[0]);
      expect(msg.startsWith('migrate failed: ')).toBe(true);
      expect(msg.endsWith('is not set')).toBe(true);
    });

    test('unreachable DB exits 1 without leaking', async () => {
      writeFileSync(join(tmp, '20990101000000_a.sql'), 'select 1;\n');
      const name = ['STOKTOK', 'DATABASE', 'URL'].join('_');
      await migrateCommand([], { env: { [name]: 'postgres://u:pw-SENTINEL-9@127.0.0.1:9/x' }, dir: tmp });
      expect(process.exitCode).toBe(1);
      expect(String(err.mock.calls[0]?.[0]).startsWith('migrate failed: cannot connect to the database (URL not printed)')).toBe(true);
      expect(calls()).not.toMatch(/pw-SENTINEL|127\.0\.0\.1/);
    });
  });
});

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MigrationError } from '@stoktok/db/pg';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { migrateCommand, resolveMigrationsDir } from './migrate';

describe('resolveMigrationsDir', () => {
  test('image layout', () => {
    const want = resolve('/app/migrations');
    expect(resolveMigrationsDir('/app/dist', (p) => p === want)).toBe(want);
  });
  test('repo layout from src and dist', () => {
    const want = resolve('/r/db/migrations');
    for (const m of ['/r/apps/worker/src', '/r/apps/worker/dist']) {
      expect(resolveMigrationsDir(m, (p) => p === want)).toBe(want);
    }
  });
  test('nothing exists -> first candidate', () => {
    expect(resolveMigrationsDir('/x/dist', () => false)).toBe(resolve('/x/dist', '../migrations'));
  });
  test('real repo', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(resolveMigrationsDir(here, existsSync)).toBe(resolve(here, '../../../db/migrations'));
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
  const errLines = (): string[] => err.mock.calls.map((c: unknown[]) => String(c[0]));
  const allOutput = () => [...out.mock.calls, ...err.mock.calls].map((c: unknown[]) => String(c[0])).join('\n');

  test('extra argument -> usage, exit 2, run not called', async () => {
    for (const argv of [['x'], ['--dry-run']]) {
      const run = vi.fn();
      err.mockClear();
      process.exitCode = undefined;
      await migrateCommand(argv, { env: {}, dir: '/d', run });
      expect(errLines().some((l: string) => l.includes('migrate'))).toBe(true);
      expect(process.exitCode).toBe(2);
      expect(run).not.toHaveBeenCalled();
    }
  });

  test('success -> exit 0, logs to stdout, passes env and dir', async () => {
    const env = {};
    const run = vi.fn(async (_e: unknown, opts: { log: (line: string) => void }) => {
      opts.log('applied v');
    });
    await migrateCommand([], { env, dir: '/d', run });
    expect(out).toHaveBeenCalledWith('applied v');
    expect(err).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(env, expect.objectContaining({ dir: '/d' }));
    expect(process.exitCode).toBe(0);
  });

  test('MigrationError mapping', async () => {
    await migrateCommand([], { env: {}, dir: '/d', run: () => Promise.reject(new MigrationError('m2', 2)) });
    expect(errLines()).toEqual(['migrate failed: m2']);
    expect(process.exitCode).toBe(2);
    err.mockClear();
    await migrateCommand([], { env: {}, dir: '/d', run: () => Promise.reject(new MigrationError('m1', 1, '22012')) });
    expect(errLines()).toEqual(['migrate failed: m1 [22012]']);
    expect(process.exitCode).toBe(1);
  });

  test('unknown error -> fixed text, exit 1, no echo', async () => {
    const secret = 'postgres://u:SENTINEL-pw@127.0.0.1/x';
    const runs: (() => Promise<unknown>)[] = [() => Promise.reject(new Error(secret)), () => { throw new Error(secret); }, () => Promise.reject('SENTINEL-pw')];
    for (const run of runs) {
      err.mockClear();
      process.exitCode = undefined;
      await expect(migrateCommand([], { env: {}, dir: '/d', run })).resolves.toBeUndefined();
      expect(errLines()).toEqual(['migrate failed: unexpected error']);
      expect(process.exitCode).toBe(1);
      expect(allOutput()).not.toMatch(/SENTINEL|127\.0\.0\.1/);
    }
  });

  test('default run with env {} -> exit 2, no network', async () => {
    await migrateCommand([], { env: {}, dir: '/nonexistent' });
    expect(process.exitCode).toBe(2);
    const line = errLines()[0] ?? '';
    expect(line.startsWith('migrate failed:')).toBe(true);
    expect(line.endsWith('is not set')).toBe(true);
  });
});

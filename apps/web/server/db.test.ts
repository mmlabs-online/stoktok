import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const factory = vi.hoisted(() => vi.fn());
vi.mock('@stoktok/db/pg', () => ({ createPgDb: factory }));

const KEY = Symbol.for('stoktok.db');

beforeEach(() => {
  vi.resetModules();
  factory.mockReset();
  factory.mockImplementation(() => ({ end: vi.fn(), stats: vi.fn() }));
  delete (globalThis as Record<symbol, unknown>)[KEY];
});
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe('server/db', () => {
  test('importing the module creates no handle', async () => {
    await import('./db');
    expect(factory).not.toHaveBeenCalled();
  });

  test("getDb() calls the factory once with (process.env, 'web') and returns the same handle", async () => {
    const { getDb } = await import('./db');
    const a = getDb();
    expect(getDb()).toBe(a);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(process.env, 'web');
  });

  test('after vi.resetModules() a re-imported module returns the same handle without a second factory call', async () => {
    const first = (await import('./db')).getDb();
    vi.resetModules();
    const again = (await import('./db')).getDb();
    expect(again).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

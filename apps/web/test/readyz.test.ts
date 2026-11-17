import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeDataError extends Error {
  constructor(public code: string) {
    super('connect ECONNREFUSED 10.0.0.9:5432 password=SENTINEL');
  }
}
const pingDb = vi.fn();
const getDb = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('../server/db', () => ({ DataError: FakeDataError, getDb: () => getDb(), pingDb: (d: unknown) => pingDb(d) }));

let GET: () => Promise<Response>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import('../app/readyz/route'));
  vi.clearAllMocks();
  getDb.mockReturnValue({});
  log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  vi.useRealTimers();
});

describe('GET /readyz', () => {
  it('200 ok when the ping resolves', async () => {
    pingDb.mockResolvedValue(undefined);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('503 on DataError; logs the code only; body has no error text', async () => {
    pingDb.mockRejectedValue(new FakeDataError('DB_ERROR'));
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'unavailable' });
    expect(text).not.toContain('SENTINEL');
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'readyz_db_unavailable', code: 'DB_ERROR' }));
  });

  it('503 when getDb throws (env missing); neither body nor log carries the message', async () => {
    getDb.mockImplementation(() => {
      throw new Error('Missing env DB-URL-SENTINEL');
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('DB-URL-SENTINEL');
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'readyz_db_unavailable', code: 'config' }));
  });

  it('503 when the ping never settles within 2000 ms', async () => {
    vi.useFakeTimers();
    pingDb.mockReturnValue(new Promise(() => undefined));
    const p = GET();
    await vi.advanceTimersByTimeAsync(2000);
    const res = await p;
    expect(res.status).toBe(503);
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'readyz_db_unavailable', code: 'timeout' }));
  });

  it('clears the timer on success', async () => {
    vi.useFakeTimers();
    pingDb.mockResolvedValue(undefined);
    await GET();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('memoises the result for 3 s: one ping for repeated calls, a new one after', async () => {
    vi.useFakeTimers();
    pingDb.mockResolvedValue(undefined);
    await Promise.all([GET(), GET()]);
    await GET();
    expect(pingDb).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    await GET();
    expect(pingDb).toHaveBeenCalledTimes(2);
  });

  it('memoises a failed result for 3 s, then retries', async () => {
    vi.useFakeTimers();
    pingDb.mockRejectedValueOnce(new FakeDataError('DB_ERROR')).mockResolvedValue(undefined);
    expect((await GET()).status).toBe(503);
    await vi.advanceTimersByTimeAsync(2999);
    expect((await GET()).status).toBe(503);
    expect(pingDb).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await GET()).status).toBe(200);
    expect(pingDb).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('route source imports only server/db and does not call requireUser', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app/readyz/route.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['../../server/db']);
    expect(src).not.toContain('requireUser');
  });
});

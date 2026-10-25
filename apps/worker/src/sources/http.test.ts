import { describe, expect, test } from 'vitest';
import { getJson } from './http';
import { SourceError } from './price-source';

const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function setup(responses: Array<Response | Error>) {
  const queue = [...responses];
  const calls: [string, RequestInit | undefined][] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = queue.shift();
    if (!next) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    return next;
  };
  const sleeps: number[] = [];
  const opts = {
    timeoutMs: 1000,
    maxAttempts: 3,
    backoffBaseMs: 1000,
    userAgent: 'test-agent',
    sleep: async (ms: number) => void sleeps.push(ms),
    log: () => undefined,
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, sleeps, opts };
}

describe('getJson', () => {
  test('200 -> parsed JSON; only User-Agent and Accept headers', async () => {
    const s = setup([res(200, { a: 1 })]);
    await expect(getJson(s.fetchImpl, 'https://x/y', s.opts)).resolves.toEqual({ a: 1 });
    expect(s.calls[0]?.[1]?.headers).toEqual({ 'User-Agent': 'test-agent', Accept: 'application/json' });
  });
  test('503 then 200 -> retried once with backoff', async () => {
    const s = setup([res(503), res(200, { ok: true })]);
    await expect(getJson(s.fetchImpl, 'https://x', s.opts)).resolves.toEqual({ ok: true });
    expect(s.sleeps).toEqual([1000]);
  });
  test('429 x3 -> retryable SourceError after maxAttempts', async () => {
    const s = setup([res(429), res(429), res(429)]);
    await expect(getJson(s.fetchImpl, 'https://x', s.opts)).rejects.toMatchObject({ retryable: true, status: 429 });
    expect(s.calls).toHaveLength(3);
    expect(s.sleeps).toEqual([1000, 2000]);
  });
  test('404 -> SourceError, no retry', async () => {
    const s = setup([res(404)]);
    const err = await getJson(s.fetchImpl, 'https://x', s.opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ retryable: false, status: 404 });
    expect(s.calls).toHaveLength(1);
  });
  test('network error is retried', async () => {
    const s = setup([new TypeError('fetch failed'), res(200, { ok: 1 })]);
    await expect(getJson(s.fetchImpl, 'https://x', s.opts)).resolves.toEqual({ ok: 1 });
    expect(s.calls).toHaveLength(2);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { VCI_CONFIG } from '../config';
import { SourceError } from './price-source';
import { VciPriceSource } from './vci';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../test/fixtures/vci/${name}`, import.meta.url), 'utf8'));
const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function setup(responses: Array<Response | Error>) {
  const queue = [...responses];
  const calls: [string, RequestInit | undefined][] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = queue.shift();
    if (!next) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const http = { timeoutMs: 1000, maxAttempts: 3, backoffBaseMs: 10, sleep: async () => undefined, log: () => undefined };
  return { source: new VciPriceSource({ fetchImpl, http }), calls };
}
const ok = (name: string) => setup([res(200, fixture(name))]);
const FROM = '2026-10-20';
const TO = '2026-10-22';

describe('VciPriceSource', () => {
  test('name is vci-public', () => {
    expect(ok('chart-ok.json').source.name).toBe('vci-public');
  });

  test('requestBody: ONE_DAY, to = start of day after toDate (VN), countBack = inclusive calendar days', () => {
    expect(ok('chart-ok.json').source.requestBody('VNM', FROM, TO)).toEqual({
      timeFrame: 'ONE_DAY',
      symbols: ['VNM'],
      to: Math.floor(Date.parse('2026-10-23T00:00:00+07:00') / 1000),
      countBack: 3,
    });
  });

  test('sends POST to baseUrl+chartPath with exactly User-Agent, Accept, Content-Type headers', async () => {
    const s = ok('chart-ok.json');
    await s.source.fetchDaily('VNM', FROM, TO, {});
    const [url, init] = s.calls[0] ?? [];
    expect(url).toBe(VCI_CONFIG.baseUrl + VCI_CONFIG.chartPath);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'User-Agent': VCI_CONFIG.userAgent,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(VCI_CONFIG.userAgent.startsWith('stoktok/')).toBe(true);
    expect(JSON.parse(init?.body as string)).toEqual(s.source.requestBody('VNM', FROM, TO));
  });

  test('maps chart-ok.json (string and number values, both t encodings) to integer VND bars', async () => {
    const r = await ok('chart-ok.json').source.fetchDaily('VNM', FROM, TO, {});
    expect(r.rejected).toEqual([]);
    expect(r.bars).toEqual([
      { symbol: 'VNM', tradeDate: '2026-10-20', open: 61500, high: 62000, low: 61200, close: 61800, volume: 1200000, foreignNet: null },
      { symbol: 'VNM', tradeDate: '2026-10-21', open: 61800, high: 62300, low: 61500, close: 62000, volume: 1350000, foreignNet: null },
      { symbol: 'VNM', tradeDate: '2026-10-22', open: 62000, high: 62500, low: 61900, close: 62300, volume: 980000, foreignNet: null },
    ]);
  });

  test('t at 17:00 UTC of the previous day and at 00:00 UTC map to the same VN date', async () => {
    const body = (t: number) => [{ symbol: 'VNM', t: [t], o: [61500], h: [62000], l: [61200], c: [61800], v: [1] }];
    for (const t of [1792429200, 1792454400]) {
      const s = setup([res(200, body(t))]);
      const r = await s.source.fetchDaily('VNM', FROM, TO, {});
      expect(r.bars.map((b) => b.tradeDate)).toEqual(['2026-10-20']);
    }
  });

  test('wrapped {data:[...]} root parses like a bare array', async () => {
    const r = await ok('chart-wrapped.json').source.fetchDaily('VNM', FROM, TO, {});
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]?.close).toBe(61800);
  });

  test('chart-thousand-vnd.json -> every bar rejected by core guards, none returned', async () => {
    const r = await ok('chart-thousand-vnd.json').source.fetchDaily('VNM', FROM, TO, {});
    expect(r.bars).toEqual([]);
    expect(r.rejected).toHaveLength(2);
  });

  test('chart-malformed.json -> good bar kept, bad values rejected with core reasons', async () => {
    const r = await ok('chart-malformed.json').source.fetchDaily('VNM', FROM, '2026-10-25', {});
    expect(r.bars.map((b) => b.tradeDate)).toEqual(['2026-10-20']);
    expect(r.rejected).toEqual([
      { tradeDate: '2026-10-21', reason: 'invalid_open' },
      { tradeDate: '2026-10-22', reason: 'invalid_open' },
      { reason: 'invalid_trade_date' },
      { reason: 'invalid_trade_date' },
      { tradeDate: '2026-10-23', reason: 'missing_volume' },
    ]);
  });

  test('duplicate trade date in one response -> first kept, later rejected', async () => {
    const body = [{ symbol: 'VNM', t: [1792429200, 1792440000], o: [61500, 61500], h: [62000, 62000], l: [61200, 61200], c: [61800, 61800], v: [1, 1] }];
    const r = await setup([res(200, body)]).source.fetchDaily('VNM', FROM, TO, {});
    expect(r.bars).toHaveLength(1);
    expect(r.rejected).toEqual([{ tradeDate: '2026-10-20', reason: 'duplicate_trade_date' }]);
  });

  test('unequal arrays, missing arrays and non-object root -> non-retryable unexpected response shape', async () => {
    const bad = [fixture('chart-unequal-arrays.json'), [{ symbol: 'VNM', t: [1] }], [null], 'x', { data: 'x' }];
    for (const b of bad) {
      const s = setup([res(200, b)]);
      await expect(s.source.fetchDaily('VNM', FROM, TO, {})).rejects.toMatchObject({ retryable: false, message: 'unexpected response shape' });
    }
  });

  test('empty root and empty columns -> zero bars, no error', async () => {
    const empty = { bars: [], rejected: [] };
    await expect(ok('chart-empty.json').source.fetchDaily('VNM', FROM, TO, {})).resolves.toEqual(empty);
    const cols = [{ symbol: 'VNM', t: [], o: [], h: [], l: [], c: [], v: [] }];
    await expect(setup([res(200, cols)]).source.fetchDaily('VNM', FROM, TO, {})).resolves.toEqual(empty);
  });

  test('other symbol -> non-retryable symbol mismatch', async () => {
    await expect(ok('chart-other-symbol.json').source.fetchDaily('VNM', FROM, TO, {})).rejects.toMatchObject({
      retryable: false,
      message: 'symbol mismatch',
    });
  });

  test('more bars than countBack -> non-retryable error', async () => {
    await expect(ok('chart-too-many-bars.json').source.fetchDaily('VNM', FROM, '2026-10-21', {})).rejects.toMatchObject({
      retryable: false,
      message: 'unexpected response shape: more bars than requested',
    });
  });

  test('bars outside [from, to] are dropped', async () => {
    // Server over-delivers days before `from` (still within countBack): they are filtered client-side.
    const r = await ok('chart-ok.json').source.fetchDaily('VNM', '2026-10-21', '2026-10-23', {});
    expect(r.bars.map((b) => b.tradeDate)).toEqual(['2026-10-21', '2026-10-22']);
  });

  test('range longer than maxCalendarDaysPerRequest -> non-retryable before any fetch', async () => {
    const s = ok('chart-ok.json');
    const err = await s.source.fetchDaily('VNM', '2025-01-01', TO, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ retryable: false, message: 'requested range too long' });
    expect(s.calls).toHaveLength(0);
  });

  test("HTTP 403 -> non-retryable 'blocked by source (HTTP 403)', one call", async () => {
    const s = setup([res(403), res(200, fixture('chart-ok.json'))]);
    await expect(s.source.fetchDaily('VNM', FROM, TO, {})).rejects.toMatchObject({ retryable: false, status: 403 });
    await expect(setup([res(403)]).source.fetchDaily('VNM', FROM, TO, {})).rejects.toThrow('blocked by source (HTTP 403)');
    expect(s.calls).toHaveLength(1);
  });

  test("200 with non-JSON body -> non-retryable 'response is not valid JSON'", async () => {
    const html = { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('x')) } as unknown as Response;
    await expect(setup([html]).source.fetchDaily('VNM', FROM, TO, {})).rejects.toMatchObject({
      retryable: false,
      message: 'response is not valid JSON',
    });
  });

  test('503 then 200 -> retried by the shared client', async () => {
    const s = setup([res(503), res(200, fixture('chart-ok.json'))]);
    const r = await s.source.fetchDaily('VNM', FROM, TO, {});
    expect(r.bars).toHaveLength(3);
    expect(s.calls).toHaveLength(2);
  });

  test('global fetch is blocked in tests', async () => {
    let globalCalls = 0;
    vi.stubGlobal('fetch', () => {
      globalCalls += 1;
      throw new Error('network blocked in tests');
    });
    try {
      await ok('chart-ok.json').source.fetchDaily('VNM', FROM, TO, {});
      expect(globalCalls).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

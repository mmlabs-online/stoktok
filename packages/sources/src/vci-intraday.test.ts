import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { VCI_INTRADAY_CONFIG } from './config';
import { SourceError } from './source-error';
import { VciIntradaySource } from './vci-intraday';

const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'vci-intraday.synthetic.json'), 'utf8')) as unknown[];
const NOW = new Date('2026-11-05T10:05:00+07:00');

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), headers: new Headers() }) as Response;

function make(responses: Array<Response | Error>, extra: { maxSymbolsPerRequest?: number } = {}) {
  const queue = [...responses];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('no response queued');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const source = new VciIntradaySource({
    fetchImpl,
    http: {
      timeoutMs: VCI_INTRADAY_CONFIG.timeoutMs,
      maxAttempts: VCI_INTRADAY_CONFIG.maxAttempts,
      backoffBaseMs: VCI_INTRADAY_CONFIG.backoffBaseMs,
      sleep: async () => undefined,
      log: () => undefined,
    },
    ...extra,
  });
  return { source, calls };
}

const item = (symbol: string, over: Record<string, unknown> = {}) => ({ symbol, t: [], o: [], h: [], l: [], c: [], v: [], ...over });

describe('VciIntradaySource', () => {
  test('batches symbols in one POST', async () => {
    const { source, calls } = make([res(200, fixture)]);
    await source.fetchLatest(['VNM', 'FPT', 'HPG'], { now: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${VCI_INTRADAY_CONFIG.baseUrl}${VCI_INTRADAY_CONFIG.chartPath}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      timeFrame: 'ONE_MINUTE',
      symbols: ['VNM', 'FPT', 'HPG'],
      to: Math.floor(NOW.getTime() / 1000) + 60,
      countBack: 360,
    });
    expect(Object.keys(calls[0]!.init.headers as object).sort()).toEqual(['Accept', 'Content-Type', 'User-Agent']);
  });

  test('chunks above maxSymbolsPerRequest', async () => {
    const { source, calls } = make([res(200, []), res(200, [])], { maxSymbolsPerRequest: 2 });
    await source.fetchLatest(['A', 'B', 'C'], { now: NOW });
    expect(calls.map((c) => JSON.parse(c.init.body as string).symbols)).toEqual([['A', 'B'], ['C']]);
  });

  test('parses the synthetic fixture', async () => {
    const { source } = make([res(200, fixture)]);
    const r = await source.fetchLatest(['vnm', 'FPT', 'HPG', 'vnm'], { now: NOW });
    expect(r.quotes).toEqual([
      { symbol: 'VNM', ts: '2026-11-05T02:04:00.000Z', price: 61_500, volume: 2400, source: 'vci-public', fetchedAt: NOW.toISOString() },
      { symbol: 'FPT', ts: '2026-11-05T02:04:00.000Z', price: 102_300, volume: 2400, source: 'vci-public', fetchedAt: NOW.toISOString() },
    ]);
    expect(r.rejected).toEqual([{ symbol: 'HPG', reason: 'no_bars_today' }]);
  });

  test('requested symbol absent from response', async () => {
    const { source } = make([res(200, [fixture[0]])]);
    const r = await source.fetchLatest(['VNM', 'FPT'], { now: NOW });
    expect(r.quotes.map((q) => q.symbol)).toEqual(['VNM']);
    expect(r.rejected).toEqual([{ symbol: 'FPT', reason: 'no_data' }]);
  });

  test('unrequested symbol throws; duplicate symbol is rejected', async () => {
    await expect(make([res(200, [item('XXX')])]).source.fetchLatest(['VNM'], { now: NOW })).rejects.toMatchObject({
      message: 'symbol mismatch',
      retryable: false,
    });
    const { source } = make([res(200, [fixture[0], fixture[0]])]);
    const r = await source.fetchLatest(['VNM'], { now: NOW });
    expect(r.quotes).toHaveLength(1);
    expect(r.rejected).toEqual([{ symbol: 'VNM', reason: 'duplicate_symbol' }]);
  });

  test.each([
    ['non-array root', { foo: 1 }],
    ['unequal lengths', [item('VNM', { t: ['1'], c: [], v: [] })]],
    ['missing arrays', [{ symbol: 'VNM', t: [] }]],
  ])('shape error: %s', async (_n, body) => {
    const err = await make([res(200, body)]).source.fetchLatest(['VNM'], { now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ message: 'unexpected response shape', retryable: false });
  });

  test('empty list gives no_data for every symbol', async () => {
    const r = await make([res(200, [])]).source.fetchLatest(['VNM', 'FPT'], { now: NOW });
    expect(r.rejected).toEqual([{ symbol: 'VNM', reason: 'no_data' }, { symbol: 'FPT', reason: 'no_data' }]);
  });

  test('403 is non-retryable, one call, cites ADR 0006', async () => {
    const { source, calls } = make([res(403), res(200, fixture)]);
    const err = await source.fetchLatest(['VNM'], { now: NOW }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403, retryable: false });
    expect((err as Error).message).toContain('ADR 0006');
    expect(calls).toHaveLength(1);
  });

  test.each([429, 503])('%i with maxAttempts 1 makes one call and is retryable', async (status) => {
    const { source, calls } = make([res(status), res(200, fixture)]);
    const err = await source.fetchLatest(['VNM'], { now: NOW }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status, retryable: true });
    expect(calls).toHaveLength(1);
  });

  test('lastCloses are passed to core', async () => {
    const { source } = make([res(200, fixture)]);
    const r = await source.fetchLatest(['VNM', 'FPT', 'HPG'], { now: NOW, lastCloses: { VNM: 1_000 } });
    expect(r.quotes.map((q) => q.symbol)).toEqual(['FPT']);
    expect(r.rejected).toEqual([{ symbol: 'VNM', reason: 'close_jump' }, { symbol: 'HPG', reason: 'no_bars_today' }]);
  });
});

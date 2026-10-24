import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { SourceError } from './price-source';
import { TcbsPriceSource } from './tcbs';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/tcbs/${name}`, import.meta.url), 'utf8'));

function source(body: unknown) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  const http = { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 1, sleep: async () => undefined, log: () => undefined };
  return { src: new TcbsPriceSource({ fetchImpl, http }), urls };
}

describe('TcbsPriceSource', () => {
  test('builds URL with ticker, resolution=D and VN-day unix bounds', () => {
    const { src } = source({});
    const u = new URL(src.url('VNM', '2026-10-21', '2026-10-23'));
    expect(u.pathname).toBe('/stock-insight/v1/stock/bars-long-term');
    expect(u.searchParams.get('ticker')).toBe('VNM');
    expect(u.searchParams.get('resolution')).toBe('D');
    expect(u.searchParams.get('from')).toBe(String(Date.parse('2026-10-20T17:00:00Z') / 1000));
    expect(u.searchParams.get('to')).toBe(String(Date.parse('2026-10-23T16:59:59Z') / 1000));
  });
  test('maps synthetic bars-ok.json to integer VND bars; both date encodings map to the VN date', async () => {
    const { src } = source(fixture('bars-ok.json'));
    const out = await src.fetchDaily('VNM', '2026-10-21', '2026-10-23', {});
    expect(out.rejected).toEqual([]);
    expect(out.bars.map((b) => [b.tradeDate, b.close])).toEqual([
      ['2026-10-21', 61500],
      ['2026-10-22', 62000],
      ['2026-10-23', 62500],
    ]);
    expect(out.bars[0]).toMatchObject({ symbol: 'VNM', open: 61000, high: 62000, low: 60500, volume: 1200000, foreignNet: null });
  });
  test('bars-malformed.json -> rejections with reasons, good bar kept', async () => {
    const { src } = source(fixture('bars-malformed.json'));
    const out = await src.fetchDaily('VNM', '2026-10-21', '2026-10-23', {});
    expect(out.bars.map((b) => b.tradeDate)).toEqual(['2026-10-21']);
    expect(out.rejected.map((r) => r.reason)).toEqual(['missing_close', 'invalid_low', 'invalid_trade_date', 'invalid_bar']);
  });
  test('bars-empty.json -> zero bars, no error', async () => {
    const { src } = source(fixture('bars-empty.json'));
    await expect(src.fetchDaily('VNM', '2026-10-21', '2026-10-23', {})).resolves.toEqual({ bars: [], rejected: [] });
  });
  test('envelope without data array -> non-retryable SourceError', async () => {
    const { src } = source({ ticker: 'VNM' });
    const err = await src.fetchDaily('VNM', '2026-10-21', '2026-10-23', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ retryable: false });
  });
  test('bars outside the requested range are dropped', async () => {
    const { src } = source(fixture('bars-ok.json'));
    const out = await src.fetchDaily('VNM', '2026-10-22', '2026-10-22', {});
    expect(out.bars.map((b) => b.tradeDate)).toEqual(['2026-10-22']);
  });
  test('global fetch is blocked in tests', () => {
    expect(() => fetch('https://example.com')).toThrow('live network is forbidden');
  });
});

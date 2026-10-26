import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { SourceError } from './price-source';
import { TcbsFinancialsSource } from './tcbs-financials';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/tcbs-financials/${name}`, import.meta.url), 'utf8'));

type Reply = unknown | { status: number };
function source(replies: { ratio?: Reply; income?: Reply; overview?: Reply }, opts: { maxPeriodsPerResponse?: number } = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    const key = url.includes('financialratio') ? 'ratio' : url.includes('incomestatement') ? 'income' : 'overview';
    const reply = replies[key] ?? [];
    if (typeof reply === 'object' && reply !== null && 'status' in reply) {
      return { ok: false, status: (reply as { status: number }).status } as Response;
    }
    return { ok: true, status: 200, json: async () => reply } as Response;
  }) as unknown as typeof fetch;
  const http = { timeoutMs: 1000, maxAttempts: 2, backoffBaseMs: 1, sleep: async (ms: number) => void sleeps.push(ms), log: () => undefined };
  return { src: new TcbsFinancialsSource({ fetchImpl, http, requestDelayMs: 7, ...opts }), calls, sleeps };
}

describe('TcbsFinancialsSource.fetchQuarterly', () => {
  test('URLs: quarterly financialratio and incomestatement (yearly=0, isAll=true); honest UA; delay between requests', async () => {
    const { src, calls, sleeps } = source({});
    await src.fetchQuarterly('TSTA');
    expect(calls).toHaveLength(2);
    for (const [i, name] of ['financialratio', 'incomestatement'].entries()) {
      const u = new URL(calls[i]?.url ?? '');
      expect(u.pathname).toBe(`/tcanalysis/v1/finance/TSTA/${name}`);
      expect(u.searchParams.get('yearly')).toBe('0');
      expect(u.searchParams.get('isAll')).toBe('true');
      expect(calls[i]?.headers['User-Agent']).toBe('stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)');
    }
    expect(sleeps).toEqual([7]);
    expect(new URL(src.url('TSTA', 'overview')).pathname).toBe('/tcanalysis/v1/ticker/TSTA/overview');
  });
  test('ratio-ok + income-ok merge by period, sorted ascending, integer VND', async () => {
    const { src } = source({ ratio: fixture('ratio-ok.json'), income: fixture('income-ok.json') });
    const out = await src.fetchQuarterly('tsta');
    expect(out.rejected).toEqual([]);
    expect(out.periods.map((p) => p.period)).toEqual(['2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1', '2026Q2']);
    expect(out.periods[0]).toEqual({ symbol: 'TSTA', period: '2025Q1', eps: 1000, bvps: 20000, revenue: 1_000_500_000_000, netIncome: 100_500_000_000 });
    expect(out.periods[2]?.netIncome).toBe(-20_500_000_000);
    expect(out.periods[4]?.revenue).toBe(1_400_123_456_789);
    for (const p of out.periods) for (const v of [p.eps, p.bvps, p.revenue, p.netIncome]) expect(Number.isSafeInteger(v)).toBe(true);
  });
  test('malformed rows -> rejected with reasons, valid periods kept, symbol = requested', async () => {
    const { src } = source({ ratio: fixture('ratio-malformed.json'), income: fixture('income-malformed.json') });
    const out = await src.fetchQuarterly('TSTA');
    expect(out.periods.map((p) => [p.symbol, p.period])).toEqual([['TSTA', '2026Q1']]);
    expect(out.rejected).toEqual([
      { reason: 'invalid_period' },
      { period: '2025Q3', reason: 'duplicate_period' },
      { reason: 'ticker_mismatch' },
      { period: '2025Q2', reason: 'invalid_revenue' },
      { period: '2025Q4', reason: 'missing_eps' },
    ]);
  });
  test('wrong-unit fixtures -> every period rejected, none returned', async () => {
    const a = await source({ ratio: fixture('ratio-wrong-unit.json'), income: fixture('income-ok.json') }).src.fetchQuarterly('TSTA');
    expect(a.periods).toEqual([]);
    expect(a.rejected.filter((r) => r.reason === 'bvps_out_of_band')).toHaveLength(2);
    const b = await source({ ratio: fixture('ratio-ok.json'), income: fixture('income-wrong-unit.json') }).src.fetchQuarterly('TSTA');
    expect(b.periods.map((p) => p.period)).not.toContain('2026Q1');
    expect(b.rejected).toContainEqual({ period: '2026Q1', reason: 'invalid_revenue' });
  });
  test('period only in one endpoint -> rejected missing_*, not filled', async () => {
    const ratio = (fixture('ratio-ok.json') as { year: number; quarter: number }[]).filter((r) => !(r.year === 2026 && r.quarter === 2));
    const { src } = source({ ratio, income: fixture('income-ok.json') });
    const out = await src.fetchQuarterly('TSTA');
    expect(out.periods.map((p) => p.period)).not.toContain('2026Q2');
    expect(out.rejected).toEqual([{ period: '2026Q2', reason: 'missing_eps' }]);
  });
  test('empty arrays and HTTP 404 -> no periods, no throw', async () => {
    const empty = { periods: [], rejected: [] };
    await expect(source({ ratio: fixture('empty.json'), income: fixture('empty.json') }).src.fetchQuarterly('TSTA')).resolves.toEqual(empty);
    await expect(source({ ratio: { status: 404 }, income: { status: 404 } }).src.fetchQuarterly('TSTA')).resolves.toEqual(empty);
  });
  test('response longer than maxPeriodsPerResponse -> non-retryable SourceError', async () => {
    const { src } = source({ ratio: fixture('ratio-ok.json') }, { maxPeriodsPerResponse: 3 });
    await expect(src.fetchQuarterly('TSTA')).rejects.toMatchObject({ name: 'SourceError', retryable: false });
  });
  test('non-array body -> SourceError; 5xx retried via getJson then fails', async () => {
    await expect(source({ ratio: { data: [] } }).src.fetchQuarterly('TSTA')).rejects.toBeInstanceOf(SourceError);
    const { src, calls } = source({ ratio: { status: 503 } });
    await expect(src.fetchQuarterly('TSTA')).rejects.toMatchObject({ retryable: true });
    expect(calls).toHaveLength(2);
  });
  test('invalid symbol -> non-retryable SourceError, no request', async () => {
    const { src, calls } = source({});
    await expect(src.fetchQuarterly('../x')).rejects.toMatchObject({ retryable: false });
    expect(calls).toHaveLength(0);
  });
});

describe('TcbsFinancialsSource.fetchSector', () => {
  test('overview-ok -> normalised label; overview-no-industry -> null; 404 -> null', async () => {
    expect(await source({ overview: fixture('overview-ok.json') }).src.fetchSector('TSTA')).toBe('Thực phẩm và đồ uống');
    expect(await source({ overview: fixture('overview-no-industry.json') }).src.fetchSector('TSTA')).toBeNull();
    expect(await source({ overview: { status: 404 } }).src.fetchSector('TSTA')).toBeNull();
  });
});

describe('no-network guard', () => {
  test('global fetch throws', () => {
    expect(() => fetch('https://example.invalid')).toThrow('live network is forbidden');
  });
});

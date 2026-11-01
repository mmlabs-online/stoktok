import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { VCI_IQ_CONFIG } from '../config';
import { SourceError } from './price-source';
import { VCI_IQ_FINANCIALS_SOURCE_NAME, VciIqFinancialsSource } from './vci-iq-financials';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/vci-iq/${name}`, import.meta.url), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (name: string): any => fixture(name);

type Reply = unknown | { status: number };
interface Replies {
  statistics?: Reply;
  income?: Reply;
  balance?: Reply;
  details?: Reply;
}
function build(r: Replies = {}, opts: { maxPeriodsPerResponse?: number; maxQuarters?: number } = {}) {
  const replies: Replies = {
    statistics: fixture('statistics-ok.json'),
    income: fixture('income-ok.json'),
    balance: fixture('balance-ok.json'),
    details: fixture('details-ok.json'),
    ...r,
  };
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const events: string[] = [];
  const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    events.push('fetch');
    const key = url.includes('statistics-financial')
      ? 'statistics'
      : url.includes('INCOME_STATEMENT')
        ? 'income'
        : url.includes('BALANCE_SHEET')
          ? 'balance'
          : 'details';
    const reply = replies[key];
    if (typeof reply === 'object' && reply !== null && 'status' in reply && !('data' in reply)) {
      return { ok: false, status: (reply as { status: number }).status } as Response;
    }
    return { ok: true, status: 200, json: async () => reply } as Response;
  }) as unknown as typeof fetch;
  const http = {
    timeoutMs: 1000,
    maxAttempts: 2,
    backoffBaseMs: 1,
    sleep: async (ms: number) => void events.push(`sleep:${ms}`),
    log: () => undefined,
  };
  return { src: new VciIqFinancialsSource({ fetchImpl, http, requestDelayMs: 7, ...opts }), calls, events };
}

describe('VciIqFinancialsSource.fetchQuarterly', () => {
  test('recorded HPG fixtures -> 12+ normalized quarters with integer VND, source vci-iq', async () => {
    const { src } = build();
    expect(src.name).toBe('vci-iq');
    const out = await src.fetchQuarterly('hpg');
    expect(out.periods.length).toBeGreaterThanOrEqual(12);
    expect(out.periods.map((p) => p.period)).toEqual([...out.periods.map((p) => p.period)].sort());
    const last = out.periods.at(-1);
    expect(last).toMatchObject({ symbol: 'HPG', period: '2026Q3', revenue: 62_214_187_236_976 });
    expect(last?.bvps).toBe(17_624);
    for (const p of out.periods) for (const v of [p.eps, p.bvps, p.revenue, p.netIncome]) expect(Number.isSafeInteger(v)).toBe(true);
    // the default window (16) keeps all 15 fixture quarters: the first 3 lack a 4-quarter window
    expect(out.rejected).toEqual([
      { period: '2023Q1', reason: 'missing_eps' },
      { period: '2023Q2', reason: 'missing_eps' },
      { period: '2023Q3', reason: 'missing_eps' },
    ]);
  });
  test('maxQuarters keeps only the latest N quarters; older history is dropped silently, not rejected', async () => {
    const out = await build({}, { maxQuarters: 12 }).src.fetchQuarterly('HPG');
    expect(out.rejected).toEqual([]);
    expect(out.periods).toHaveLength(12);
    expect(out.periods[0]?.period).toBe('2023Q4');
  });
  test('missing shares for a quarter older than the emitted range -> no reject', async () => {
    const st = clone('statistics-ok.json');
    st.data = st.data.filter((r: { yearReport: number; quarter: number }) => !(r.yearReport === 2023 && r.quarter === 2));
    const out = await build({ statistics: st }, { maxQuarters: 12 }).src.fetchQuarterly('HPG');
    expect(out.rejected).toEqual([]);
  });
  test('missing shares inside the emitted range is still rejected', async () => {
    const st = clone('statistics-ok.json');
    st.data = st.data.filter((r: { yearReport: number; quarter: number }) => !(r.yearReport === 2025 && r.quarter === 2));
    const out = await build({ statistics: st }, { maxQuarters: 12 }).src.fetchQuarterly('HPG');
    expect(out.rejected).toContainEqual({ period: '2025Q2', reason: 'missing_shares' });
  });
  test('unsupported_company_type reports only the emitted range', async () => {
    const out = await build({ details: fixture('details-bank.json') }, { maxQuarters: 12 }).src.fetchQuarterly('HPG');
    expect(out.periods).toEqual([]);
    expect(out.rejected).toHaveLength(12);
    expect(out.rejected.every((r) => r.reason === 'unsupported_company_type')).toBe(true);
  });
  test('passes derived raw values through normalizeQuarterlyFinancials', async () => {
    const inc = clone('income-ok.json');
    const q = (y: number, n: number) => inc.data.quarters.find((r: { yearReport: number; lengthReport: number }) => r.yearReport === y && r.lengthReport === n);
    const ttm = [q(2025, 4), q(2026, 1), q(2026, 2), q(2026, 3)].reduce((s: number, r: { isa22: number }) => s + r.isa22, 0);
    const out = await build().src.fetchQuarterly('HPG');
    const p = out.periods.find((x) => x.period === '2026Q3');
    expect(p?.eps).toBe(Math.round(ttm / 8_442_964_520));
    expect(p?.netIncome).toBe(q(2026, 3).isa22);
  });
  test('source name is vci-iq', () => {
    expect(VCI_IQ_FINANCIALS_SOURCE_NAME).toBe('vci-iq');
  });
  test('skips year rows (quarter/lengthReport 5, and data.years) silently, not as invalid_period', async () => {
    const out = await build().src.fetchQuarterly('HPG');
    expect(out.rejected.some((r) => r.reason === 'invalid_period')).toBe(false);
    expect(out.periods.every((p) => /Q[1-4]$/.test(p.period))).toBe(true);
  });
  test('duplicate period in any endpoint -> dropped + duplicate_period', async () => {
    const inc = clone('income-ok.json');
    inc.data.quarters.push({ ...inc.data.quarters[3] });
    const dup = inc.data.quarters[3];
    const out = await build({ income: inc }).src.fetchQuarterly('HPG');
    const period = `${dup.yearReport}Q${dup.lengthReport}`;
    expect(out.rejected).toContainEqual({ period, reason: 'duplicate_period' });
    expect(out.periods.map((p) => p.period)).not.toContain(period);
  });
  test('row ticker mismatch (statements) -> ticker_mismatch; null ticker on statistics is not checked', async () => {
    const bal = clone('balance-ok.json');
    bal.data.quarters[0].ticker = 'XXX';
    const out = await build({ balance: bal }).src.fetchQuarterly('HPG');
    expect(out.rejected).toContainEqual({ reason: 'ticker_mismatch' });
    expect(out.periods.length).toBeGreaterThanOrEqual(12);
  });
  test('wrong-unit fixture (amounts / 1e9) -> rejected by core unit guards', async () => {
    const inc = clone('income-ok.json');
    for (const r of inc.data.quarters) {
      r.isa3 /= 1e9;
      r.isa22 /= 1e9;
    }
    const out = await build({ income: inc }).src.fetchQuarterly('HPG');
    expect(out.periods).toEqual([]);
    expect(out.rejected.length).toBeGreaterThan(0);
  });
  test('period missing in the balance sheet -> that period rejected, others kept', async () => {
    const bal = clone('balance-ok.json');
    bal.data.quarters = bal.data.quarters.filter((r: { yearReport: number; lengthReport: number }) => !(r.yearReport === 2025 && r.lengthReport === 2));
    const out = await build({ balance: bal }).src.fetchQuarterly('HPG');
    expect(out.rejected).toContainEqual({ period: '2025Q2', reason: 'missing_bvps' });
    expect(out.periods.map((p) => p.period)).not.toContain('2025Q2');
    expect(out.periods.map((p) => p.period)).toContain('2025Q3');
  });
  test('missing shares and missing bsa210 -> rejected, not filled', async () => {
    const st = clone('statistics-ok.json');
    st.data = st.data.filter((r: { yearReport: number; quarter: number }) => !(r.yearReport === 2025 && r.quarter === 1));
    const bal = clone('balance-ok.json');
    const row = bal.data.quarters.find((r: { yearReport: number; lengthReport: number }) => r.yearReport === 2025 && r.lengthReport === 2);
    row.bsa210 = null;
    const out = await build({ statistics: st, balance: bal }).src.fetchQuarterly('HPG');
    expect(out.rejected).toContainEqual({ period: '2025Q1', reason: 'missing_shares' });
    expect(out.rejected).toContainEqual({ period: '2025Q2', reason: 'missing_bvps' });
  });
  test('comTypeCode other than CT -> every period rejected unsupported_company_type', async () => {
    const out = await build({ details: fixture('details-bank.json') }).src.fetchQuarterly('HPG');
    expect(out.periods).toEqual([]);
    expect(out.rejected.length).toBeGreaterThan(12);
    expect(out.rejected.every((r) => r.reason === 'unsupported_company_type' && r.period !== undefined)).toBe(true);
  });
  test('404 -> no data; empty list -> no periods', async () => {
    const empty = { periods: [], rejected: [] };
    const nf = { status: 404 };
    await expect(build({ statistics: nf, income: nf, balance: nf }).src.fetchQuarterly('HPG')).resolves.toEqual(empty);
    const none = { status: 200, data: { quarters: [], years: [] } };
    await expect(build({ statistics: { data: [] }, income: none, balance: none }).src.fetchQuarterly('HPG')).resolves.toEqual(empty);
  });
  test("403 -> non-retryable SourceError 'blocked by source (HTTP 403); no bypass, see ADR 0005'", async () => {
    const { src, calls } = build({ statistics: { status: 403 } });
    const err = await src.fetchQuarterly('HPG').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).message).toBe('blocked by source (HTTP 403); no bypass, see ADR 0005');
    expect((err as SourceError).retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });
  test('too many periods -> SourceError', async () => {
    await expect(build({}, { maxPeriodsPerResponse: 5 }).src.fetchQuarterly('HPG')).rejects.toThrow('too many periods');
  });
  test('sends only User-Agent and Accept; no Origin/Referer/Cookie', async () => {
    const { src, calls } = build();
    await src.fetchQuarterly('HPG');
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(Object.keys(c.headers).sort()).toEqual(['Accept', 'User-Agent']);
      expect(c.headers['User-Agent']).toBe(VCI_IQ_CONFIG.userAgent);
    }
    expect(calls.map((c) => c.url)).toEqual([
      `${VCI_IQ_CONFIG.baseUrl}/HPG/statistics-financial`,
      `${VCI_IQ_CONFIG.baseUrl}/HPG/financial-statement?section=INCOME_STATEMENT`,
      `${VCI_IQ_CONFIG.baseUrl}/HPG/financial-statement?section=BALANCE_SHEET`,
      `${VCI_IQ_CONFIG.baseUrl}/details?ticker=HPG`,
    ]);
  });
  test('requests are sequential with requestDelayMs between them', async () => {
    const { src, events } = build();
    await src.fetchQuarterly('HPG');
    expect(events).toEqual(['fetch', 'sleep:7', 'fetch', 'sleep:7', 'fetch', 'sleep:7', 'fetch']);
  });
});

describe('VciIqFinancialsSource.fetchSector', () => {
  test('returns normalized sectorVn; null when missing; details fetched once per instance', async () => {
    const { src, calls } = build();
    await expect(src.fetchSector('HPG')).resolves.toBe('Tài nguyên Cơ bản');
    await src.fetchQuarterly('HPG');
    expect(calls.filter((c) => c.url.includes('/details?')).length).toBe(1);
    await expect(build({ details: { data: { comTypeCode: 'CT' } } }).src.fetchSector('HPG')).resolves.toBeNull();
    await expect(build({ details: { status: 404 } }).src.fetchSector('HPG')).resolves.toBeNull();
  });
});

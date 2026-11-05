import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { VCI_IQ_CONFIG } from '../config';
import { SourceError } from './price-source';
import { toVndAmount } from '@stoktok/core';
import {
  resolveVciIqFields,
  VCI_IQ_FIELDS_BY_COMPANY_TYPE,
  VCI_IQ_FINANCIALS_SOURCE_NAME,
  VCI_IQ_FINANCIALS_UNITS,
  VciIqFinancialsSource,
} from './vci-iq-financials';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/vci-iq/${name}`, import.meta.url), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (name: string): any => fixture(name);

/** An in-memory copy of a recorded details response with another comTypeCode (undefined removes it). */
function withType(name: string, comTypeCode: string | undefined) {
  const d = clone(name);
  if (comTypeCode === undefined) delete d.data.comTypeCode;
  else d.data.comTypeCode = comTypeCode;
  return d;
}

type Reply = unknown | { status: number };
interface Replies {
  statistics?: Reply;
  income?: Reply;
  balance?: Reply;
  details?: Reply;
}
function build(r: Replies = {}, opts: { maxPeriodsPerResponse?: number; maxQuarters?: number; supportedCompanyTypes?: readonly string[] } = {}) {
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
    return { ok: true, status: 200, text: async () => JSON.stringify(reply), headers: new Headers() } as Response;
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
    const out = await build({ details: withType('details-ok.json', 'XX') }, { maxQuarters: 12 }).src.fetchQuarterly('HPG');
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
    const out = await build({ details: withType('details-ok.json', 'XX') }).src.fetchQuarterly('HPG');
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

// STK-042: bank, securities and insurer mappings, on trimmed copies of the 2026-11-04 recordings.
type Q = Record<string, unknown> & { yearReport: number; lengthReport: number };
const WINDOW = Array.from({ length: 16 }, (_, k) => `${2022 + Math.floor((k + 3) / 4)}Q${((k + 3) % 4) + 1}`);
const inWindow = (r: Q) => WINDOW.includes(`${r.yearReport}Q${r.lengthReport}`);
const rows = (sym: string, kind: 'income' | 'balance') => (clone(`${sym}-${kind}.json`).data.quarters as Q[]);
const num = (v: unknown) => toVndAmount(v, VCI_IQ_FINANCIALS_UNITS.totals);
function symbolReplies(sym: string): Replies {
  return {
    statistics: fixture(`${sym}-statistics.json`),
    income: fixture(`${sym}-income.json`),
    balance: fixture(`${sym}-balance.json`),
    details: fixture(`${sym}-details.json`),
  };
}

const TYPES = [
  { type: 'NH', sym: 'vcb', ticker: 'VCB', revenue: 25_431_117_000_000, netIncome: 9_033_302_000_000, eps: 4986, bvps: 30_359 },
  { type: 'NH', sym: 'tcb', ticker: 'TCB', revenue: 16_587_715_000_000, netIncome: 7_942_932_000_000, eps: 2694, bvps: 17_601 },
  { type: 'CK', sym: 'vnd', ticker: 'VND', revenue: 1_714_820_453_789, netIncome: 329_458_120_320, eps: 1379, bvps: 14_295 },
  { type: 'BH', sym: 'bmi', ticker: 'BMI', revenue: 1_563_314_122_394, netIncome: 75_776_567_450, eps: 1730, bvps: 20_436 },
] as const;

describe.each(TYPES)('$type ($ticker) mapping', ({ type, sym, ticker, revenue, netIncome, eps, bvps }) => {
  const F = VCI_IQ_FIELDS_BY_COMPANY_TYPE[type];
  if (F === undefined) throw new Error(`no mapping for ${type}`);

  test('derives EPS/BVPS/revenue/netIncome for 2026Q3', async () => {
    const out = await build(symbolReplies(sym)).src.fetchQuarterly(ticker);
    expect(out.rejected).toEqual([]);
    expect(out.periods).toHaveLength(16);
    expect(out.periods.at(-1)).toEqual({ symbol: ticker, period: '2026Q3', eps, bvps, revenue, netIncome });
  });

  test('mapped revenue, parent NI and equity are non-zero in every fixture quarter', () => {
    for (const r of rows(sym, 'income').filter(inWindow)) {
      expect(num(r[F.revenue]), `${r.yearReport}Q${r.lengthReport} revenue`).not.toBe(0);
      expect(num(r[F.parentNetIncome]), `${r.yearReport}Q${r.lengthReport} parent NI`).not.toBe(0);
    }
    for (const r of rows(sym, 'balance').filter(inWindow)) {
      expect(num(r[F.ownersEquity]), `${r.yearReport}Q${r.lengthReport} equity`).not.toBe(0);
    }
  });

  test('parent NI identity holds in every fixture quarter', () => {
    for (const r of rows(sym, 'income').filter(inWindow)) {
      const label = `${r.yearReport}Q${r.lengthReport}`;
      if (type === 'NH') expect(num(r[F.parentNetIncome]), label).toBe((num(r.isa20) as number) + (num(r.isa21) as number));
      else {
        expect(num(r.isa21), label).toBe(0);
        expect(num(r[F.parentNetIncome]), label).toBe(num(r.isa20));
      }
    }
  });

  test.each([
    ['revenue', 'income', F.revenue, 'missing_revenue'],
    ['parent NI', 'income', F.parentNetIncome, 'missing_eps'],
    ['equity', 'balance', F.ownersEquity, 'missing_bvps'],
    ['minority', 'balance', F.minorityInterests ?? '', 'missing_bvps'],
  ] as const)('removing the mapped %s code rejects every affected period (no zero-fill)', async (_n, kind, code, reason) => {
    const r = symbolReplies(sym);
    const body = r[kind] as { data: { quarters: Q[] } };
    for (const q of body.data.quarters) delete q[code];
    const out = await build(r).src.fetchQuarterly(ticker);
    expect(out.periods).toEqual([]);
    expect(out.rejected).toHaveLength(16);
    expect(out.rejected.every((x) => x.reason === reason)).toBe(true);
  });

  test('mapped revenue 0 in one quarter -> that period zero_revenue', async () => {
    const r = symbolReplies(sym);
    const row = (r.income as { data: { quarters: Q[] } }).data.quarters.find((q) => q.yearReport === 2026 && q.lengthReport === 2) as Q;
    row[F.revenue] = 0;
    const out = await build(r).src.fetchQuarterly(ticker);
    expect(out.rejected).toEqual([{ period: '2026Q2', reason: 'zero_revenue' }]);
    expect(out.periods).toHaveLength(15);
  });
});

describe('NH mapping equity', () => {
  test.each(['vcb', 'tcb'])('%s: bsa78 - bsa210 equals bsb118+bsb121+bsa84+bsa85+bsa90 in every fixture quarter', (sym) => {
    const F = VCI_IQ_FIELDS_BY_COMPANY_TYPE.NH;
    if (F === undefined) throw new Error('no NH mapping');
    for (const r of rows(sym, 'balance').filter(inWindow)) {
      const parts = ['bsb118', 'bsb121', 'bsa84', 'bsa85', 'bsa90'].reduce((t, k) => t + (num(r[k]) as number), 0);
      expect(num(r[F.ownersEquity]) as number - (num(r[F.minorityInterests ?? '']) as number), `${r.yearReport}Q${r.lengthReport}`).toBe(parts);
    }
  });
});

describe('company type gating', () => {
  test("rejects an unlisted comTypeCode ('XX') as unsupported_company_type for every emitted period", async () => {
    const out = await build({ ...symbolReplies('vcb'), details: withType('vcb-details.json', 'XX') }).src.fetchQuarterly('VCB');
    expect(out.periods).toEqual([]);
    expect(out.rejected).toHaveLength(16);
    expect(out.rejected.every((r) => r.reason === 'unsupported_company_type')).toBe(true);
  });
  test('rejects a mapped type that is not in supportedCompanyTypes', async () => {
    const out = await build(symbolReplies('vcb'), { supportedCompanyTypes: ['CT'] }).src.fetchQuarterly('VCB');
    expect(out.periods).toEqual([]);
    expect(out.rejected).toHaveLength(16);
    expect(out.rejected.every((r) => r.reason === 'unsupported_company_type')).toBe(true);
  });
  test('missing details / missing comTypeCode stays unsupported_company_type', async () => {
    for (const details of [{ status: 404 }, withType('vcb-details.json', undefined)]) {
      const out = await build({ ...symbolReplies('vcb'), details }).src.fetchQuarterly('VCB');
      expect(out.periods).toEqual([]);
      expect(out.rejected).toHaveLength(16);
      expect(out.rejected.every((r) => r.reason === 'unsupported_company_type')).toBe(true);
    }
  });
  test('resolveVciIqFields: null for unknown, unsupported and non-string types; inherited keys are not types', () => {
    expect(resolveVciIqFields('NH', ['CT', 'NH'])).toBe(VCI_IQ_FIELDS_BY_COMPANY_TYPE.NH);
    expect(resolveVciIqFields('NH', ['CT'])).toBeNull();
    expect(resolveVciIqFields('XX', ['XX'])).toBeNull();
    expect(resolveVciIqFields(undefined, ['CT'])).toBeNull();
    expect(resolveVciIqFields('toString', ['toString'])).toBeNull();
  });
  test('CT (HPG) is unchanged by the type table', async () => {
    const out = await build().src.fetchQuarterly('HPG');
    expect(out.periods.at(-1)).toMatchObject({ period: '2026Q3', bvps: 17_624 });
  });
});

describe('minorityInterests null / null value', () => {
  test('null in the mapping -> minority treated as 0', async () => {
    const table = VCI_IQ_FIELDS_BY_COMPANY_TYPE as Record<string, unknown>;
    table.ZZ = { ...VCI_IQ_FIELDS_BY_COMPANY_TYPE.NH, minorityInterests: null };
    try {
      const out = await build({ ...symbolReplies('vcb'), details: withType('vcb-details.json', 'ZZ') }, { supportedCompanyTypes: ['ZZ'] }).src.fetchQuarterly('VCB');
      // 253,761,146,000,000 / 8,355,675,094 = 30369.9 -> 30370 (minority not subtracted)
      expect(out.periods.at(-1)).toMatchObject({ period: '2026Q3', bvps: 30_370 });
    } finally {
      delete table.ZZ;
    }
  });
  test('minority code present but value null -> missing_bvps', async () => {
    const r = symbolReplies('vcb');
    const row = (r.balance as { data: { quarters: Q[] } }).data.quarters.find((q) => q.yearReport === 2026 && q.lengthReport === 3) as Q;
    row.bsa210 = null;
    const out = await build(r).src.fetchQuarterly('VCB');
    expect(out.rejected).toEqual([{ period: '2026Q3', reason: 'missing_bvps' }]);
  });
});

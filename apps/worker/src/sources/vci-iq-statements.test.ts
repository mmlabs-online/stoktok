import { readFileSync } from 'node:fs';
import { assertFieldMap, STATEMENT_LINES } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { SourceError } from './price-source';
import { VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE, VciIqFinancialsSource } from './vci-iq-financials';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/vci-iq/${path}`, import.meta.url), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stmt = (sym: string, kind: 'income' | 'balance'): any => read(`statements/${sym}-${kind}.json`);

type Reply = unknown | { status: number };
interface Replies {
  statistics?: Reply;
  income?: Reply;
  balance?: Reply;
  details?: Reply;
}

function build(sym: string, r: Replies = {}) {
  const replies: Replies = {
    statistics: read('statistics-ok.json'),
    income: stmt(sym, 'income'),
    balance: stmt(sym, 'balance'),
    details: read(sym === 'hpg' ? 'details-ok.json' : `${sym}-details.json`),
    ...r,
  };
  const events: string[] = [];
  const counts = { statistics: 0, income: 0, balance: 0, details: 0 };
  const fetchImpl = (async (url: string) => {
    const key = url.includes('statistics-financial')
      ? 'statistics'
      : url.includes('INCOME_STATEMENT')
        ? 'income'
        : url.includes('BALANCE_SHEET')
          ? 'balance'
          : 'details';
    counts[key] += 1;
    events.push(`get:${key}`);
    const reply = replies[key];
    if (typeof reply === 'object' && reply !== null && 'status' in reply && !('data' in reply)) {
      return { ok: false, status: (reply as { status: number }).status } as Response;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(reply), headers: new Headers() } as Response;
  }) as unknown as typeof fetch;
  const http = { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 1, sleep: async (ms: number) => void events.push(`sleep:${ms}`), log: () => undefined };
  return { src: new VciIqFinancialsSource({ fetchImpl, http, requestDelayMs: 7 }), counts, events };
}

const valuesOf = (p: { values: { line: string; value: number }[] } | undefined) => Object.fromEntries((p?.values ?? []).map((v) => [v.line, v.value]));

describe('fetchStatements', () => {
  test('HPG (CT) maps all 12 lines from the recorded fixture for a quarter and a year (exact values)', async () => {
    const out = await build('hpg').src.fetchStatements('hpg');
    expect(out.companyType).toBe('CT');
    expect(out.expectedLines).toEqual(Object.keys(STATEMENT_LINES));
    const q = out.periods.find((p) => p.periodKind === 'quarter' && p.period === '2026Q3');
    expect(q?.missing).toEqual([]);
    expect(valuesOf(q)).toEqual({
      revenue: 62_214_187_236_976,
      gross_profit: 11_922_468_644_635,
      operating_profit: 8_822_161_686_075,
      profit_before_tax: 9_108_749_304_090,
      net_income_parent: 8_217_339_610_974,
      total_assets: 283_449_770_464_603,
      total_liabilities: 133_881_417_845_277,
      equity_total: 149_568_352_619_326,
      minority_interests: 772_935_036_121,
      cash_and_equivalents: 6_852_876_731_299,
      short_term_borrowings: 78_615_048_528_530,
      long_term_borrowings: 27_121_712_703_040,
    });
    const y = out.periods.find((p) => p.periodKind === 'year' && p.period === '2025');
    expect(valuesOf(y)).toMatchObject({ revenue: 156_116_094_618_482, gross_profit: 24_497_788_183_182, total_assets: 257_899_200_817_547, long_term_borrowings: 27_479_194_057_074 });
    expect(y?.values).toHaveLength(12);
    expect(y?.values.find((v) => v.line === 'revenue')?.statement).toBe('income');
    expect(y?.values.find((v) => v.line === 'cash_and_equivalents')?.statement).toBe('balance');
    expect(out.rejected).toEqual([]);
  });

  test('HPG fixture identity: total_assets = total_liabilities + equity_total (+-1 VND) for every period', async () => {
    const out = await build('hpg').src.fetchStatements('HPG');
    expect(out.periods.length).toBeGreaterThanOrEqual(20);
    for (const p of out.periods) {
      const v = valuesOf(p);
      expect(Math.abs((v.total_assets ?? 0) - (v.total_liabilities ?? 0) - (v.equity_total ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  test('HPG fixture: gross_profit <= revenue; minority_interests <= equity_total', async () => {
    const out = await build('hpg').src.fetchStatements('HPG');
    for (const p of out.periods) {
      const v = valuesOf(p);
      expect(v.gross_profit).toBeLessThanOrEqual(v.revenue as number);
      expect(v.minority_interests).toBeLessThanOrEqual(v.equity_total as number);
    }
  });

  test('VCB (NH), VND (CK), BMI (BH) map only their non-null lines; not-applicable lines absent and not in missing', async () => {
    for (const [sym, type] of [['vcb', 'NH'], ['vnd', 'CK'], ['bmi', 'BH']] as const) {
      const out = await build(sym).src.fetchStatements(sym);
      const map = VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE[type];
      const applicable = Object.entries(map).filter(([, c]) => c !== null).map(([l]) => l);
      expect(out.companyType).toBe(type);
      expect(out.expectedLines).toEqual(applicable);
      expect(out.rejected).toEqual([]);
      for (const p of out.periods) {
        expect(p.values.map((v) => v.line)).toEqual(applicable);
        expect(p.missing).toEqual([]);
      }
    }
    expect(VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE.NH.cash_and_equivalents).toBeNull();
    expect(VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE.CK.profit_before_tax).toBeNull();
  });

  test('every field map is complete and every non-null code is numeric in the latest recorded period', () => {
    const fixtureOf = { CT: 'hpg', NH: 'vcb', CK: 'vnd', BH: 'bmi' } as const;
    for (const [type, map] of Object.entries(VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE)) {
      expect(() => assertFieldMap(map)).not.toThrow();
      const sym = fixtureOf[type as keyof typeof fixtureOf];
      const row = { ...stmt(sym, 'income').data.quarters.at(-1), ...stmt(sym, 'balance').data.quarters.at(-1) };
      for (const code of Object.values(map)) if (code !== null) expect(typeof row[code]).toBe('number');
    }
  });

  test('a mapped code removed from one quarter -> that line in missing for that period, other lines kept', async () => {
    const income = stmt('hpg', 'income');
    const q = income.data.quarters.find((r: { yearReport: number; lengthReport: number }) => r.yearReport === 2026 && r.lengthReport === 2);
    delete q.isa5;
    const out = await build('hpg', { income }).src.fetchStatements('HPG');
    const p = out.periods.find((x) => x.periodKind === 'quarter' && x.period === '2026Q2');
    expect(p?.missing).toEqual(['gross_profit']);
    expect(p?.values).toHaveLength(11);
    expect(out.periods.find((x) => x.period === '2026Q3')?.missing).toEqual([]);
  });

  test('year rows (lengthReport 5) become period_kind year with period YYYY; quarter rows unchanged', async () => {
    const out = await build('hpg').src.fetchStatements('HPG');
    const years = out.periods.filter((p) => p.periodKind === 'year').map((p) => p.period);
    expect(years).toEqual(['2022', '2023', '2024', '2025']);
    const quarters = out.periods.filter((p) => p.periodKind === 'quarter').map((p) => p.period);
    expect(quarters.every((p) => /^\d{4}Q[1-4]$/.test(p))).toBe(true);
    expect(quarters).toHaveLength(16); // 19 recorded, latest maxQuarters kept
  });

  test('a year row whose lengthReport is not 5 in data.years is rejected invalid_period', async () => {
    const income = stmt('hpg', 'income');
    income.data.years[0].lengthReport = 4;
    const out = await build('hpg', { income }).src.fetchStatements('HPG');
    expect(out.rejected).toContainEqual({ reason: 'invalid_period' });
    // The balance sheet still has 2022, so the year exists with its income lines missing.
    const y2022 = out.periods.find((p) => p.periodKind === 'year' && p.period === '2022');
    expect(y2022?.missing).toEqual(['revenue', 'gross_profit', 'operating_profit', 'profit_before_tax', 'net_income_parent']);
  });

  test('duplicate period -> dropped and rejected duplicate_period (quarter and year)', async () => {
    const income = stmt('hpg', 'income');
    income.data.quarters.push({ ...income.data.quarters[0] });
    income.data.years.push({ ...income.data.years[0] });
    const out = await build('hpg', { income }).src.fetchStatements('HPG');
    expect(out.rejected.filter((r) => r.reason === 'duplicate_period').map((r) => r.period).sort()).toEqual(['2022', '2022Q1']);
    expect(out.periods.map((p) => p.period)).not.toContain('2022Q1');
    expect(out.periods.map((p) => p.period)).not.toContain('2022');
  });

  test('unsupported comTypeCode -> all periods rejected unsupported_company_type', async () => {
    const details = read('details-ok.json');
    details.data.comTypeCode = 'XX';
    const out = await build('hpg', { details }).src.fetchStatements('HPG');
    expect(out.periods).toEqual([]);
    expect(out.expectedLines).toEqual([]);
    expect(out.companyType).toBe('XX');
    expect(out.rejected).toHaveLength(16 + 4);
    expect(out.rejected.every((r) => r.reason === 'unsupported_company_type' && r.period !== undefined)).toBe(true);
  });

  test('an implausible value is rejected per line and the line is not emitted', async () => {
    const balance = stmt('hpg', 'balance');
    balance.data.quarters.at(-1).bsa53 = -5;
    const out = await build('hpg', { balance }).src.fetchStatements('HPG');
    expect(out.rejected).toContainEqual({ period: '2026Q3', reason: 'total_assets_out_of_band' });
    expect(valuesOf(out.periods.find((p) => p.period === '2026Q3'))).not.toHaveProperty('total_assets');
  });

  test('fetchStatements after fetchQuarterly on the same instance reuses income/balance/details responses (GET count)', async () => {
    const { src, counts } = build('hpg');
    await src.fetchQuarterly('HPG');
    await src.fetchStatements('HPG');
    expect(counts).toEqual({ statistics: 1, income: 1, balance: 1, details: 1 });
  });

  test('on its own it makes 3 GETs per symbol with a pause between real GETs only', async () => {
    const { src, counts, events } = build('hpg');
    await src.fetchStatements('HPG');
    expect(counts).toEqual({ statistics: 0, income: 1, balance: 1, details: 1 });
    expect(events).toEqual(['get:income', 'sleep:7', 'get:balance', 'sleep:7', 'get:details']);
  });

  test('403 -> SourceError no bypass; 404 -> empty result', async () => {
    await expect(build('hpg', { income: { status: 403 } }).src.fetchStatements('HPG')).rejects.toMatchObject({ status: 403, message: expect.stringContaining('no bypass') });
    await expect(build('hpg', { income: { status: 403 } }).src.fetchStatements('HPG')).rejects.toBeInstanceOf(SourceError);
    const out = await build('hpg', { income: { status: 404 }, balance: { status: 404 } }).src.fetchStatements('HPG');
    expect(out).toEqual({ companyType: null, expectedLines: [], periods: [], rejected: [] });
  });

  test('invalid symbol -> SourceError', async () => {
    await expect(build('hpg').src.fetchStatements('not a symbol!')).rejects.toBeInstanceOf(SourceError);
  });

  test('revenue and net_income_parent equal the values fetchQuarterly emits for the same period', async () => {
    const { src } = build('hpg');
    const q = await src.fetchQuarterly('HPG');
    const s = await src.fetchStatements('HPG');
    expect(q.periods.length).toBeGreaterThan(5);
    for (const p of q.periods) {
      const v = valuesOf(s.periods.find((x) => x.periodKind === 'quarter' && x.period === p.period));
      expect(v.revenue).toBe(p.revenue);
      expect(v.net_income_parent).toBe(p.netIncome);
    }
  });
});

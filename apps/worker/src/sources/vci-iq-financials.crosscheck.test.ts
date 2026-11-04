import { readFileSync } from 'node:fs';
import { addQuarters, deriveVciIqQuarter, toVndAmount } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { VCI_IQ_FIELDS_BY_COMPANY_TYPE } from './vci-iq-financials';

/**
 * AC3 (STK-042): offline cross-check on the recorded fixtures (2026-11-04). The derived TTM parent net income and parent
 * equity (and the per-share forms) are compared with VietCap's own marketCap / pe and marketCap / pb for the SAME period.
 * Float arithmetic here is test-only; the tolerance is fixed and is never tuned.
 */
const TOLERANCE = 0.03;

interface Row {
  yearReport: number;
  lengthReport?: number;
  quarter?: number;
  [k: string]: unknown;
}
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/vci-iq/${name}`, import.meta.url), 'utf8')) as { data: unknown };
const vnd = (v: unknown) => toVndAmount(v, 'VND') as number;
const key = (year: number, q: number) => `${year}Q${q}`;

function load(sym: string, type: 'NH' | 'CK' | 'BH') {
  const F = VCI_IQ_FIELDS_BY_COMPANY_TYPE[type];
  if (F === undefined) throw new Error(`no mapping for ${type}`);
  const income = (read(`${sym}-income.json`).data as { quarters: Row[] }).quarters;
  const balance = (read(`${sym}-balance.json`).data as { quarters: Row[] }).quarters;
  const stats = (read(`${sym}-statistics.json`).data as Row[]).filter((r) => r.quarter !== 5);
  const netIncomeByPeriod = new Map(income.map((r) => [key(r.yearReport, r.lengthReport as number), vnd(r[F.parentNetIncome])]));
  const balanceBy = new Map(balance.map((r) => [key(r.yearReport, r.lengthReport as number), r]));
  const statBy = new Map(stats.map((r) => [key(r.yearReport, r.quarter as number), r]));
  return { F, netIncomeByPeriod, balanceBy, statBy, stats };
}

const CASES = [
  { sym: 'vcb', type: 'NH', period: '2026Q3' },
  { sym: 'tcb', type: 'NH', period: '2026Q2' },
  { sym: 'vnd', type: 'CK', period: '2026Q3' },
  { sym: 'bmi', type: 'BH', period: '2026Q3' },
] as const;

describe.each(CASES)('$sym ($type) period $period', ({ sym, type, period }) => {
  const { F, netIncomeByPeriod, balanceBy, statBy } = load(sym, type);
  const stat = statBy.get(period) as Row;
  const b = balanceBy.get(period) as Row;
  const shares = stat.numberOfSharesMktCap as number;
  const marketCap = stat.marketCap as number;
  const ttm = [0, 1, 2, 3].reduce((s, k) => s + (netIncomeByPeriod.get(addQuarters(period, -k)) as number), 0);
  const parentEquity = vnd(b[F.ownersEquity]) - vnd(b[F.minorityInterests ?? '']);
  const derived = deriveVciIqQuarter({ period, netIncomeByPeriod, equity: vnd(b[F.ownersEquity]), minority: vnd(b[F.minorityInterests ?? '']), shares });
  const within = (a: number, vendor: number) => Math.abs(a / vendor - 1) <= TOLERANCE;

  test('share count is stable over P-3..P (so TTM / current shares is comparable)', () => {
    for (let k = 1; k <= 3; k++) expect(statBy.get(addQuarters(period, -k))?.numberOfSharesMktCap).toBe(shares);
  });
  test('TTM parent NI within 3% of marketCap_P/pe_P; EPS within 3% of marketCap_P/pe_P/shares_P', () => {
    expect(stat.pe as number).toBeGreaterThan(0);
    const vendor = marketCap / (stat.pe as number);
    expect(within(ttm, vendor), `derived ${ttm} vendor ${vendor} delta ${((ttm / vendor - 1) * 100).toFixed(4)}%`).toBe(true);
    expect(within(derived.eps as number, vendor / shares)).toBe(true);
  });
  test('parent equity within 3% of marketCap_P/pb_P; BVPS within 3% of marketCap_P/pb_P/shares_P', () => {
    expect(stat.pb as number).toBeGreaterThan(0);
    const vendor = marketCap / (stat.pb as number);
    expect(within(parentEquity, vendor), `derived ${parentEquity} vendor ${vendor} delta ${((parentEquity / vendor - 1) * 100).toFixed(4)}%`).toBe(true);
    expect(within(derived.bvps as number, vendor / shares)).toBe(true);
  });
});

describe('cross-check method', () => {
  test("stats row is paired by period (P's row, not the latest)", () => {
    const { stats, statBy } = load('tcb', 'NH');
    const latest = stats[stats.length - 1] as Row;
    expect(key(latest.yearReport, latest.quarter as number)).toBe('2026Q3');
    // TCB issued bonus shares in 2026Q3: the latest row's share count differs from P=2026Q2's
    expect(statBy.get('2026Q2')?.numberOfSharesMktCap).not.toBe(latest.numberOfSharesMktCap);
    expect(statBy.get('2026Q2')?.quarter).toBe(2);
  });
});

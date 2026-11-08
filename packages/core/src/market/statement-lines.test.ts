import { describe, expect, test } from 'vitest';
import { DEFAULT_STATEMENT_LINES_SANITY } from './config';
import {
  STATEMENT_LINES,
  assertFieldMap,
  latestExpectedYear,
  normalizeStatementLines,
  planAnnualGaps,
  yearBounds,
} from './statement-lines';
import type { StatementFieldMap, StatementLine } from './statement-lines';

const LINES = Object.keys(STATEMENT_LINES) as StatementLine[];
const FULL: StatementFieldMap = Object.fromEntries(LINES.map((l) => [l, `c_${l}`])) as StatementFieldMap;
const rowOf = (over: Record<string, unknown> = {}) => ({ ...Object.fromEntries(LINES.map((l) => [`c_${l}`, 1000])), ...over });
const run = (row: Record<string, unknown>, map: StatementFieldMap = FULL) =>
  normalizeStatementLines(row, map, 'VND', DEFAULT_STATEMENT_LINES_SANITY);

test('registry: every line belongs to exactly one statement; names match ^[a-z][a-z0-9_]{1,63}$', () => {
  for (const l of LINES) {
    expect(l).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    expect(['income', 'balance', 'cashflow']).toContain(STATEMENT_LINES[l].statement);
  }
  expect(LINES).toHaveLength(12);
});

describe('normalizeStatementLines', () => {
  test('converts floats to integer VND half away from zero (positive and negative)', () => {
    const r = run(rowOf({ c_revenue: 1234.5, c_net_income_parent: -1234.5, c_gross_profit: 2.4 }));
    const by = Object.fromEntries(r.values.map((v) => [v.line, v.value]));
    expect(by.revenue).toBe(1235);
    expect(by.net_income_parent).toBe(-1235);
    expect(by.gross_profit).toBe(2);
    expect(r.values.find((v) => v.line === 'revenue')?.statement).toBe('income');
    expect(r.values.find((v) => v.line === 'total_assets')?.statement).toBe('balance');
  });

  test('missing / null / non-number / non-finite value -> line reported missing, no value', () => {
    const r = run(rowOf({ c_gross_profit: undefined, c_operating_profit: null, c_profit_before_tax: '5', c_net_income_parent: Number.NaN, c_cash_and_equivalents: Infinity }));
    expect(r.missing).toEqual(['gross_profit', 'operating_profit', 'profit_before_tax', 'net_income_parent', 'cash_and_equivalents']);
    expect(r.values.map((v) => v.line)).not.toContain('gross_profit');
    expect(r.rejected).toEqual([]);
  });

  test('zero on a zeroIsMissing line (revenue, total_assets, equity_total) -> missing; zero on borrowings -> stored 0', () => {
    const r = run(rowOf({ c_revenue: 0, c_total_assets: 0, c_equity_total: 0, c_short_term_borrowings: 0, c_long_term_borrowings: -0 }));
    expect(r.missing).toEqual(['revenue', 'total_assets', 'equity_total']);
    expect(r.values.find((v) => v.line === 'short_term_borrowings')?.value).toBe(0);
    expect(Object.is(r.values.find((v) => v.line === 'long_term_borrowings')?.value, 0)).toBe(true);
  });

  test('negative value on a nonNegative line -> rejected out_of_band; negative profit kept', () => {
    const r = run(rowOf({ c_total_assets: -5, c_net_income_parent: -5, c_equity_total: -5 }));
    expect(r.rejected).toEqual([{ line: 'total_assets', reason: 'out_of_band' }]);
    expect(r.values.find((v) => v.line === 'net_income_parent')?.value).toBe(-5);
    expect(r.values.find((v) => v.line === 'equity_total')?.value).toBe(-5);
  });

  test('abs value above maxAbsTotalVnd -> rejected out_of_band', () => {
    const max = DEFAULT_STATEMENT_LINES_SANITY.maxAbsTotalVnd;
    const r = run(rowOf({ c_revenue: max + 1, c_gross_profit: -(max + 1), c_operating_profit: max, c_profit_before_tax: 1e300 }));
    expect(r.rejected.map((x) => x.line)).toEqual(['revenue', 'gross_profit', 'profit_before_tax']);
    expect(r.values.map((v) => v.line)).toContain('operating_profit');
  });

  test('field map entry null -> line not applicable: not in values, not in missing', () => {
    const r = run(rowOf(), { ...FULL, gross_profit: null });
    expect(r.values.map((v) => v.line)).not.toContain('gross_profit');
    expect(r.missing).toEqual([]);
    expect(r.values).toHaveLength(11);
  });
});

test('unknown line in a field map -> throws at definition check (assertFieldMap)', () => {
  expect(() => assertFieldMap(FULL)).not.toThrow();
  expect(() => assertFieldMap({ ...FULL, ebit: 'isa99' })).toThrow('unknown statement line: ebit');
  const rest: Record<string, string | null> = { ...FULL };
  delete rest.revenue;
  expect(() => assertFieldMap(rest)).toThrow('lacks line: revenue');
});

test('yearBounds spans 2025-01-01T00:00+07:00 .. 2025-12-31T23:59:59+07:00', () => {
  expect(yearBounds('2025')).toEqual({ fromTs: '2024-12-31T17:00:00.000Z', toTs: '2025-12-31T16:59:59.000Z' });
  expect(() => yearBounds('25')).toThrow(RangeError);
});

test('latestExpectedYear respects annualPublishLagDays', () => {
  expect(latestExpectedYear('2026-03-31', 120)).toBe('2024');
  expect(latestExpectedYear('2026-04-30', 120)).toBe('2025');
  expect(latestExpectedYear('2026-05-01', 120)).toBe('2025');
  expect(latestExpectedYear('2026-12-31', 0)).toBe('2026');
  expect(() => latestExpectedYear('2026-13-01', 120)).toThrow(RangeError);
});

describe('planAnnualGaps', () => {
  const gap = (id: number, year: string) => ({ id, ...yearBounds(year) });
  test('records missing years in window, resolves open gaps whose year is present, expects nothing for a symbol with no known year', () => {
    const plan = planAnnualGaps({
      windowStart: '2021',
      windowEnd: '2025',
      knownPeriods: ['2022', '2023', '2025'],
      presentPeriods: ['2022', '2023', '2025'],
      openGaps: [gap(7, '2022')],
    });
    expect(plan.toRecord).toEqual(['2024']);
    expect(plan.toResolve).toEqual([7]);

    const none = planAnnualGaps({ windowStart: '2021', windowEnd: '2025', knownPeriods: [], presentPeriods: [], openGaps: [] });
    expect(none).toEqual({ toRecord: [], toResolve: [] });
  });
  test('does not re-record a year that already has an open gap; window start clips earlier known years', () => {
    const plan = planAnnualGaps({
      windowStart: '2023',
      windowEnd: '2025',
      knownPeriods: ['2019', '2025'],
      presentPeriods: ['2025'],
      openGaps: [gap(1, '2024')],
    });
    expect(plan.toRecord).toEqual(['2023']);
    expect(plan.toResolve).toEqual([]);
  });
});

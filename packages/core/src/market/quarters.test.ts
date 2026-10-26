import { describe, expect, test } from 'vitest';
import {
  addQuarters,
  comparePeriods,
  latestExpectedPeriod,
  parsePeriod,
  periodOf,
  planFinancialGaps,
  quarterBounds,
} from './quarters';

describe('period math', () => {
  test('periodOf / parsePeriod round-trip; addQuarters across the year boundary', () => {
    expect(periodOf(2026, 1)).toBe('2026Q1');
    expect(parsePeriod('2026Q1')).toEqual({ year: 2026, quarter: 1 });
    expect(parsePeriod('2026Q5')).toBeNull();
    expect(addQuarters('2026Q1', -1)).toBe('2025Q4');
    expect(addQuarters('2025Q4', 1)).toBe('2026Q1');
    expect(addQuarters('2026Q2', -11)).toBe('2023Q3');
    expect(comparePeriods('2025Q4', '2026Q1')).toBe(-1);
  });
  test('quarterBounds is VN time as UTC; Q4 ends 12-31 VN', () => {
    expect(quarterBounds('2026Q1')).toEqual({ fromTs: '2025-12-31T17:00:00.000Z', toTs: '2026-03-31T16:59:59.000Z' });
    expect(quarterBounds('2026Q4').toTs).toBe('2026-12-31T16:59:59.000Z');
  });
});

describe('latestExpectedPeriod', () => {
  test('boundary: last day + lag on or before today (Q1 ends 03-31, +45 days = 05-15)', () => {
    expect(latestExpectedPeriod('2026-05-14', 45)).toBe('2025Q4');
    expect(latestExpectedPeriod('2026-05-15', 45)).toBe('2026Q1');
    expect(latestExpectedPeriod('2026-05-14', 44)).toBe('2026Q1');
    expect(latestExpectedPeriod('2026-05-15', 46)).toBe('2025Q4');
    expect(latestExpectedPeriod('2026-10-26', 45)).toBe('2026Q2');
  });
});

describe('planFinancialGaps', () => {
  const base = { windowStart: '2025Q1', windowEnd: '2026Q1', openGaps: [] };
  test('interior hole reported; nothing before firstKnown; nothing after windowEnd', () => {
    const known = ['2025Q2', '2025Q4', '2026Q1', '2026Q2'];
    const plan = planFinancialGaps({ ...base, knownPeriods: known, presentPeriods: known });
    expect(plan).toEqual({ toRecord: ['2025Q3'], toResolve: [] });
  });
  test('present stored period is not a gap; no known period -> []', () => {
    expect(planFinancialGaps({ ...base, knownPeriods: ['2025Q1'], presentPeriods: ['2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1'] }).toRecord).toEqual([]);
    expect(planFinancialGaps({ ...base, knownPeriods: [], presentPeriods: [] })).toEqual({ toRecord: [], toResolve: [] });
  });
  test('windowStart bounds the expected range', () => {
    const plan = planFinancialGaps({ ...base, windowStart: '2025Q3', knownPeriods: ['2024Q1', '2025Q4'], presentPeriods: ['2025Q4'] });
    expect(plan.toRecord).toEqual(['2025Q3', '2026Q1']);
  });
  test('existing open gap not re-planned; open gap whose period is present is resolved (by instant)', () => {
    const b3 = quarterBounds('2025Q3');
    const openGaps = [
      { id: 7, fromTs: b3.fromTs.replace('.000Z', 'Z'), toTs: b3.toTs.replace('.000Z', '+00:00') },
      { id: 8, ...quarterBounds('2025Q4') },
    ];
    const plan = planFinancialGaps({ ...base, openGaps, knownPeriods: ['2025Q2', '2026Q1'], presentPeriods: ['2025Q2', '2025Q4', '2026Q1'] });
    expect(plan).toEqual({ toRecord: [], toResolve: [8] });
  });
});

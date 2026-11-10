import { describe, expect, test } from 'vitest';
import { aiBudgetWindow, budgetLevel, budgetStatus, fitsBudget } from './budget';

describe('aiBudgetWindow', () => {
  test('window for 2026-11-15T05:00Z is [2026-10-31T17:00:00.000Z, 2026-11-30T17:00:00.000Z)', () => {
    expect(aiBudgetWindow(new Date('2026-11-15T05:00:00Z'))).toEqual({ fromTs: '2026-10-31T17:00:00.000Z', toTs: '2026-11-30T17:00:00.000Z' });
  });
  test('2026-11-30T16:59:59.999Z is November; 2026-11-30T17:00:00.000Z is December', () => {
    expect(aiBudgetWindow(new Date('2026-11-30T16:59:59.999Z')).fromTs).toBe('2026-10-31T17:00:00.000Z');
    expect(aiBudgetWindow(new Date('2026-11-30T17:00:00.000Z'))).toEqual({ fromTs: '2026-11-30T17:00:00.000Z', toTs: '2026-12-31T17:00:00.000Z' });
  });
  test('2026-12-31T17:00:00.000Z rolls the year to 2027-01', () => {
    expect(aiBudgetWindow(new Date('2026-12-31T17:00:00.000Z'))).toEqual({ fromTs: '2026-12-31T17:00:00.000Z', toTs: '2027-01-31T17:00:00.000Z' });
  });
});

describe('budgetLevel', () => {
  test.each([
    [3_950_000, 'ok'],
    [3_999_999, 'ok'],
    [4_000_000, 'warn'],
    [4_999_999, 'warn'],
    [5_000_000, 'exhausted'],
    [5_500_000, 'exhausted'],
  ] as const)('%i -> %s', (spent, level) => {
    expect(budgetLevel(spent)).toBe(level);
  });
});

describe('fitsBudget', () => {
  test('spent + reserve == cap allowed; > cap refused; spent >= cap refused even with reserve 0', () => {
    expect(fitsBudget(4_000_000, 1_000_000, 5_000_000)).toBe(true);
    expect(fitsBudget(4_000_000, 1_000_001, 5_000_000)).toBe(false);
    expect(fitsBudget(5_000_000, 0, 5_000_000)).toBe(false);
    expect(fitsBudget(0, 0, 5_000_000)).toBe(true);
  });
  test('a new month starts at 0 spent', () => {
    expect(fitsBudget(0, 5_000_000, 5_000_000)).toBe(true);
  });
});

describe('budgetStatus', () => {
  test('returns spent, cap, remaining (never negative), percent, level', () => {
    expect(budgetStatus(4_000_000)).toEqual({ spentMicroUsd: 4_000_000, capMicroUsd: 5_000_000, remainingMicroUsd: 1_000_000, percent: 80, level: 'warn' });
    expect(budgetStatus(6_000_000)).toMatchObject({ remainingMicroUsd: 0, percent: 120, level: 'exhausted' });
  });
});

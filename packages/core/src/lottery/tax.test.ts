import { describe, expect, it } from 'vitest';
import { LOTTERY_TAX_SCHEDULE } from './config';
import { prizeTax, taxRuleFor } from './tax';

const [OLD, NEW] = LOTTERY_TAX_SCHEDULE as [(typeof LOTTERY_TAX_SCHEDULE)[0], (typeof LOTTERY_TAX_SCHEDULE)[0]];

describe('prizeTax', () => {
  it('from 2026-07-01 threshold 20,000,000', () => {
    expect(prizeTax(20_000_000, NEW)).toBe(0);
    expect(prizeTax(20_000_001, NEW)).toBe(0);
    expect(prizeTax(20_000_010, NEW)).toBe(1);
    expect(prizeTax(40_000_000, NEW)).toBe(2_000_000);
  });
  it('before 2026-07-01 threshold 10,000,000', () => {
    expect(prizeTax(10_000_000, OLD)).toBe(0);
    expect(prizeTax(10_000_001, OLD)).toBe(0);
    expect(prizeTax(10_000_010, OLD)).toBe(1);
    expect(prizeTax(40_000_000, OLD)).toBe(3_000_000);
  });
  it('below threshold is 0; jackpot-size gross stays safe', () => {
    expect(prizeTax(5_000_000, NEW)).toBe(0);
    expect(Number.isSafeInteger(prizeTax(300_000_000_000, NEW))).toBe(true);
    expect(prizeTax(300_000_000_000, NEW)).toBe(29_998_000_000);
  });
});

describe('taxRuleFor', () => {
  it('selects by draw date', () => {
    expect(taxRuleFor(LOTTERY_TAX_SCHEDULE, '2026-06-30')).toBe(OLD);
    expect(taxRuleFor(LOTTERY_TAX_SCHEDULE, '2026-07-01')).toBe(NEW);
    expect(taxRuleFor(LOTTERY_TAX_SCHEDULE, '2026-11-05')).toBe(NEW);
    expect(taxRuleFor(LOTTERY_TAX_SCHEDULE, '2016-01-01')).toBe(OLD);
  });
});

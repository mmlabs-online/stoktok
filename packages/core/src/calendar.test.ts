import { describe, expect, it } from 'vitest';
import { addTradingDays, vnDateOf } from './calendar';

describe('addTradingDays', () => {
  it('Mon+2 = Wed; Thu+2 = Mon; Fri+2 = Tue', () => {
    expect(addTradingDays('2026-03-02', 2, [])).toBe('2026-03-04');
    expect(addTradingDays('2026-03-05', 2, [])).toBe('2026-03-09');
    expect(addTradingDays('2026-03-06', 2, [])).toBe('2026-03-10');
  });
  it('skips a listed holiday', () => {
    expect(addTradingDays('2026-03-05', 2, ['2026-03-09'])).toBe('2026-03-10');
  });
  it('rejects malformed date string', () => {
    expect(() => addTradingDays('2026-3-5', 2, [])).toThrow(RangeError);
    expect(() => addTradingDays('2026-02-30', 2, [])).toThrow(RangeError);
  });
});

describe('vnDateOf', () => {
  it('returns the Vietnam calendar date of an instant', () => {
    expect(vnDateOf(new Date('2026-10-22T17:30:00Z'))).toBe('2026-10-23');
    expect(vnDateOf(new Date('2026-10-22T16:59:00Z'))).toBe('2026-10-22');
  });
});

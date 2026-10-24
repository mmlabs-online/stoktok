import { describe, expect, it } from 'vitest';
import { addTradingDays, subtractTradingDays, previousTradingDay, vnDateOf, vnMinutesOf } from './calendar';

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

describe('previousTradingDay', () => {
  it('Tue -> Mon, Mon -> Fri, Sat/Sun -> Fri', () => {
    expect(previousTradingDay('2026-10-20', [])).toBe('2026-10-19');
    expect(previousTradingDay('2026-10-19', [])).toBe('2026-10-16');
    expect(previousTradingDay('2026-10-24', [])).toBe('2026-10-23');
    expect(previousTradingDay('2026-10-25', [])).toBe('2026-10-23');
  });
  it('skips consecutive holidays', () => {
    const tet = ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20'];
    expect(previousTradingDay('2026-02-23', tet)).toBe('2026-02-13');
  });
});

describe('vnMinutesOf', () => {
  it('converts to minutes since midnight in Vietnam time', () => {
    expect(vnMinutesOf(new Date('2026-10-23T10:59:00Z'))).toBe(1079);
    expect(vnMinutesOf(new Date('2026-10-23T11:00:00Z'))).toBe(1080);
    expect(vnMinutesOf(new Date('2026-10-23T23:30:00Z'))).toBe(6 * 60 + 30);
  });
});

describe('subtractTradingDays', () => {
  it('n = 0 returns the date', () => {
    expect(subtractTradingDays('2026-03-04', 0, [])).toBe('2026-03-04');
  });
  it('Mon - 1 = Fri; Wed - 2 = Mon', () => {
    expect(subtractTradingDays('2026-03-09', 1, [])).toBe('2026-03-06');
    expect(subtractTradingDays('2026-03-04', 2, [])).toBe('2026-03-02');
  });
  it('skips a listed holiday', () => {
    expect(subtractTradingDays('2026-03-10', 1, ['2026-03-09'])).toBe('2026-03-06');
  });
  it('skips a multi-day holiday block', () => {
    const tet = ['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20'];
    expect(subtractTradingDays('2026-02-23', 1, tet)).toBe('2026-02-13');
  });
  it('rejects negative or non-integer n', () => {
    expect(() => subtractTradingDays('2026-03-04', -1, [])).toThrow(RangeError);
    expect(() => subtractTradingDays('2026-03-04', 1.5, [])).toThrow(RangeError);
  });
});

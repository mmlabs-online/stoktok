import { describe, expect, test } from 'vitest';
import { ADJUSTED_HISTORY_REASON, adjustedHistoryCutoff } from './adjusted-history';

const bar = (tradeDate: string | undefined, over: Record<string, unknown> = {}) => ({
  tradeDate, open: 10000, high: 10100, low: 9900, close: 10000, ...over,
});
const UNKNOWN = '2026-10-30';

describe('adjustedHistoryCutoff', () => {
  test('reason code is stable', () => {
    expect(ADJUSTED_HISTORY_REASON).toBe('adjusted_price_history');
  });

  test('all-integer bars → null', () => {
    expect(adjustedHistoryCutoff([bar('2026-10-20'), bar('2026-10-21')], UNKNOWN)).toBeNull();
    expect(adjustedHistoryCutoff([], UNKNOWN)).toBeNull();
  });

  test('one fractional bar → its date', () => {
    expect(adjustedHistoryCutoff([bar('2026-10-20'), bar('2026-10-21', { close: 10000.5 })], UNKNOWN)).toBe('2026-10-21');
  });

  test('several fractional bars → the latest date, regardless of array order', () => {
    const bars = [bar('2026-10-22', { open: 1.5 }), bar('2026-10-20', { open: 1.5 }), bar('2026-10-21', { open: 1.5 })];
    expect(adjustedHistoryCutoff(bars, UNKNOWN)).toBe('2026-10-22');
  });

  test.each(['open', 'high', 'low', 'close'])('fractional %s counts', (field) => {
    expect(adjustedHistoryCutoff([bar('2026-10-20', { [field]: 22701.14 })], UNKNOWN)).toBe('2026-10-20');
  });

  test('fractional bar with undefined date → unknownDateCutoff (and max with dated ones)', () => {
    expect(adjustedHistoryCutoff([bar(undefined, { open: 1.5 })], UNKNOWN)).toBe(UNKNOWN);
    expect(adjustedHistoryCutoff([bar(undefined, { open: 1.5 }), bar('2026-10-20', { open: 1.5 })], UNKNOWN)).toBe(UNKNOWN);
    expect(adjustedHistoryCutoff([bar(undefined, { open: 1.5 }), bar('2026-11-02', { open: 1.5 })], UNKNOWN)).toBe('2026-11-02');
  });

  test('non-number values (string, null, NaN, Infinity) are ignored', () => {
    const bars = [bar('2026-10-20', { open: '1.5', high: null, low: Number.NaN, close: Number.POSITIVE_INFINITY })];
    expect(adjustedHistoryCutoff(bars, UNKNOWN)).toBeNull();
  });
});

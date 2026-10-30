import { describe, expect, test } from 'vitest';
import { subtractTradingDays, tradingDaysBetween } from '../calendar';
import { planBackfillChunks } from './backfill';

const TO = '2026-10-23';

describe('planBackfillChunks', () => {
  test('260 days / chunk 60 → 5 chunks, newest first, contiguous, no overlap, union = tradingDaysBetween', () => {
    const from = subtractTradingDays(TO, 259, []);
    const chunks = planBackfillChunks(from, TO, 60, []);
    expect(chunks).toHaveLength(5);
    expect(chunks[0]?.to).toBe(TO);
    expect(chunks[4]?.from).toBe(from);
    const all = tradingDaysBetween(from, TO, []);
    const union = chunks.flatMap((c) => tradingDaysBetween(c.from, c.to, [])).sort();
    expect(union).toEqual(all);
    expect(chunks.map((c) => tradingDaysBetween(c.from, c.to, []).length)).toEqual([60, 60, 60, 60, 20]);
    for (let i = 1; i < chunks.length; i++) {
      expect(subtractTradingDays((chunks[i - 1] as { from: string }).from, 1, [])).toBe((chunks[i] as { to: string }).to);
    }
  });

  test('range smaller than chunk → 1 chunk equal to the range', () => {
    const from = subtractTradingDays(TO, 9, []);
    expect(planBackfillChunks(from, TO, 60, [])).toEqual([{ from, to: TO }]);
  });

  test('chunk boundaries skip weekends and holidays (no chunk starts or ends on a non-trading day)', () => {
    const holidays = ['2026-10-14', '2026-10-09'];
    const from = '2026-09-01';
    const chunks = planBackfillChunks(from, TO, 5, holidays);
    const trading = new Set(tradingDaysBetween(from, TO, holidays));
    for (const c of chunks) {
      expect(trading.has(c.from)).toBe(true);
      expect(trading.has(c.to)).toBe(true);
    }
  });

  test('from > to → []; chunk 0 / 1.5 / negative → RangeError', () => {
    expect(planBackfillChunks(TO, '2026-10-01', 60, [])).toEqual([]);
    for (const n of [0, 1.5, -3]) expect(() => planBackfillChunks('2026-10-01', TO, n, [])).toThrow(RangeError);
  });
});

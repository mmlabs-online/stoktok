import { describe, expect, test } from 'vitest';
import { NEWS_GAP_TYPE, planNewsGap } from './gaps';

const now = new Date('2026-11-09T03:00:00.000Z');
const gapLookbackMs = 3_600_000;

describe('planNewsGap', () => {
  test('type is news', () => expect(NEWS_GAP_TYPE).toBe('news'));
  test('failure without open gap -> insert {from: now - gapLookbackMs, to: now}', () => {
    expect(planNewsGap({ failed: true, openGaps: [], now, gapLookbackMs })).toEqual({
      insert: { from: '2026-11-09T02:00:00.000Z', to: '2026-11-09T03:00:00.000Z' },
      extendIds: [],
      resolveIds: [],
    });
  });
  test('failure with open gap(s) -> extend newest to now, no insert', () => {
    const plan = planNewsGap({ failed: true, openGaps: [{ id: 4 }, { id: 9 }, { id: 7 }], now, gapLookbackMs });
    expect(plan).toEqual({ extendIds: [9], resolveIds: [] });
  });
  test('success -> resolve all open gaps of that source; no open gap -> no-op', () => {
    expect(planNewsGap({ failed: false, openGaps: [{ id: 1 }, { id: 2 }], now, gapLookbackMs })).toEqual({ extendIds: [], resolveIds: [1, 2] });
    expect(planNewsGap({ failed: false, openGaps: [], now, gapLookbackMs })).toEqual({ extendIds: [], resolveIds: [] });
  });
});

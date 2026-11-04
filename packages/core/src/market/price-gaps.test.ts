import { describe, expect, test } from 'vitest';
import { vnDayBoundsUtc } from '../calendar';
import { SEEDED_HOLIDAY_DATES } from './holiday-calendar';
import { holidayOnlyGapIds, planPriceGaps, priceGapReadRange } from './price-gaps';

const W = { windowStart: '2026-10-19', windowEnd: '2026-10-27' }; // Mon .. next Tue
const day = (d: string) => ({ id: 1, ...vnDayBoundsUtc(d) });
const base = { ...W, firstStoredDate: '2026-10-19', storedDates: [] as string[], openGaps: [] as ReturnType<typeof day>[], holidays: [] as string[] };

describe('planPriceGaps', () => {
  test('records missing trading days; weekends and holidays are not gaps', () => {
    const out = planPriceGaps({ ...base, windowStart: '2026-10-23', firstStoredDate: '2026-10-23', storedDates: ['2026-10-23', '2026-10-27'] });
    expect(out).toEqual({ toRecord: ['2026-10-26'], toResolve: [] });
    const h = planPriceGaps({ ...base, windowStart: '2026-10-23', firstStoredDate: '2026-10-23', storedDates: ['2026-10-23', '2026-10-27'], holidays: ['2026-10-26'] });
    expect(h.toRecord).toEqual([]);
  });
  test('no stored data -> no gaps', () => {
    expect(planPriceGaps({ ...base, firstStoredDate: null })).toEqual({ toRecord: [], toResolve: [] });
  });
  test('start clamps to first stored date', () => {
    const out = planPriceGaps({ ...base, firstStoredDate: '2026-10-26', storedDates: ['2026-10-26'] });
    expect(out.toRecord).toEqual(['2026-10-27']);
  });
  test('start clamps to windowStart', () => {
    const out = planPriceGaps({ ...base, firstStoredDate: '2020-01-02', storedDates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'] });
    expect(out.toRecord).toEqual(['2026-10-27']);
  });
  test('an open gap stored as +00:00 matches a day computed as Z (no re-record)', () => {
    const b = vnDayBoundsUtc('2026-10-27');
    const g = { id: 3, fromTs: b.fromTs.replace('Z', '+00:00'), toTs: b.toTs.replace('Z', '+00:00') };
    const out = planPriceGaps({ ...base, storedDates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'], openGaps: [g] });
    expect(out).toEqual({ toRecord: [], toResolve: [] });
  });
  test('an open gap that differs only in ms formatting still matches', () => {
    const b = vnDayBoundsUtc('2026-10-27');
    const g = { id: 3, fromTs: b.fromTs.replace('.000Z', 'Z'), toTs: b.toTs.replace('.000Z', 'Z') };
    const out = planPriceGaps({ ...base, storedDates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'], openGaps: [g] });
    expect(out.toRecord).toEqual([]);
  });
  test('second plan over the same state is empty', () => {
    const state = { ...base, storedDates: ['2026-10-19', '2026-10-23'] };
    const first = planPriceGaps(state);
    expect(first.toRecord).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-26', '2026-10-27']);
    const openGaps = first.toRecord.map((d, i) => ({ id: i + 1, ...vnDayBoundsUtc(d) }));
    expect(planPriceGaps({ ...state, openGaps })).toEqual({ toRecord: [], toResolve: [] });
  });
  test('resolves an open gap once its day is stored', () => {
    const out = planPriceGaps({ ...base, storedDates: ['2026-10-19', '2026-10-20'], openGaps: [{ ...day('2026-10-20'), id: 9 }] });
    expect(out.toResolve).toEqual([9]);
    expect(out.toRecord).not.toContain('2026-10-20');
  });
  test('resolves a gap whose day became a holiday', () => {
    const out = planPriceGaps({ ...base, storedDates: ['2026-10-19'], holidays: ['2026-10-20'], openGaps: [{ ...day('2026-10-20'), id: 9 }] });
    expect(out.toResolve).toEqual([9]);
  });
  test('multi-day open gap resolves only when every trading day is stored; while open it covers its days', () => {
    const multi = { id: 5, fromTs: vnDayBoundsUtc('2026-10-20').fromTs, toTs: vnDayBoundsUtc('2026-10-21').toTs };
    const partial = planPriceGaps({ ...base, storedDates: ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'], openGaps: [multi] });
    expect(partial).toEqual({ toRecord: [], toResolve: [] });
    const full = planPriceGaps({ ...base, storedDates: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'], openGaps: [multi] });
    expect(full.toResolve).toEqual([5]);
  });
  test('open gap before windowStart: not re-recorded, resolved when stored, never resolved for being outside the window', () => {
    const old = { ...day('2026-10-05'), id: 7 };
    const open = planPriceGaps({ ...base, storedDates: [], openGaps: [old], firstStoredDate: null });
    expect(open).toEqual({ toRecord: [], toResolve: [] });
    const done = planPriceGaps({ ...base, storedDates: ['2026-10-05'], openGaps: [old], firstStoredDate: null });
    expect(done.toResolve).toEqual([7]);
  });
});

describe('priceGapReadRange', () => {
  test('no open gaps -> the window', () => {
    expect(priceGapReadRange({ ...W, openGaps: [] })).toEqual({ from: W.windowStart, to: W.windowEnd });
  });
  test('extends to the earliest and latest open gap day', () => {
    const out = priceGapReadRange({ ...W, openGaps: [day('2026-10-05'), day('2026-10-30')] });
    expect(out).toEqual({ from: '2026-10-05', to: '2026-10-30' });
  });
});

describe('holidayOnlyGapIds', () => {
  const range = (id: number, from: string, to: string) => ({ id, fromTs: vnDayBoundsUtc(from).fromTs, toTs: vnDayBoundsUtc(to).toTs });
  const H = [...SEEDED_HOLIDAY_DATES];
  test('a Tet gap resolves', () => {
    expect(holidayOnlyGapIds([range(1, '2026-02-16', '2026-02-20')], H)).toEqual([1]);
  });
  test('a single-day holiday gap resolves', () => {
    expect(holidayOnlyGapIds([range(2, '2026-09-02', '2026-09-02')], H)).toEqual([2]);
  });
  test('a gap with a holiday plus real trading days stays open', () => {
    expect(holidayOnlyGapIds([range(3, '2026-02-13', '2026-02-23')], H)).toEqual([]);
  });
  test('a weekend-only gap resolves', () => {
    expect(holidayOnlyGapIds([range(4, '2026-10-24', '2026-10-25')], [])).toEqual([4]);
  });
  test('with no holidays a weekday gap is not returned', () => {
    expect(holidayOnlyGapIds([range(5, '2026-09-02', '2026-09-02')], [])).toEqual([]);
  });
  test('output is sorted and unique', () => {
    const g = range(7, '2026-09-02', '2026-09-02');
    expect(holidayOnlyGapIds([g, range(6, '2026-09-01', '2026-09-01'), g], H)).toEqual([6, 7]);
  });
});

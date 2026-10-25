import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_RULES } from '../settings/market-rules';
import { priceTone } from '../tone';
import { DEFAULT_TICK_BANDS } from './config';
import type { TickBand } from './config';
import { buildPriceBoardRow, isOnTick, priceLimits, splitWatchlistGroups, tickSize } from './price-board';
import type { StoredClose } from './price-board';

const rules = DEFAULT_MARKET_RULES;
const tickBands = DEFAULT_TICK_BANDS;
const limits = (ref: number, exchange: 'HOSE' | 'HNX' | 'UPCOM', r = rules) =>
  priceLimits({ ref, exchange, rules: r, tickBands });

describe('tickSize', () => {
  it.each([
    [9_990, 10],
    [10_000, 50],
    [49_950, 50],
    [50_000, 100],
  ])('HOSE %i -> %i', (price, step) => {
    expect(tickSize(price, tickBands.HOSE)).toBe(step);
  });
  it('HNX and UPCOM are 100 at any price', () => {
    for (const p of [500, 9_990, 80_000]) {
      expect(tickSize(p, tickBands.HNX)).toBe(100);
      expect(tickSize(p, tickBands.UPCOM)).toBe(100);
    }
  });
  it('isOnTick', () => {
    expect(isOnTick(10_050, tickBands.HOSE)).toBe(true);
    expect(isOnTick(10_030, tickBands.HOSE)).toBe(false);
  });
  it('throws RangeError on invalid bands', () => {
    const bad: TickBand[][] = [
      [],
      [{ below: 50_000, step: 50 }, { below: 10_000, step: 10 }, { below: null, step: 100 }],
      [{ below: 10_000, step: 10 }, { below: 20_000, step: 50 }],
      [{ below: 10_005, step: 10 }, { below: null, step: 50 }],
      [{ below: null, step: 0 }],
    ];
    for (const b of bad) {
      expect(() => tickSize(100, b)).toThrow(RangeError);
      expect(() => priceLimits({ ref: 100, exchange: 'HOSE', rules, tickBands: { ...tickBands, HOSE: b } })).toThrow(RangeError);
    }
  });
});

describe('priceLimits', () => {
  it('HOSE +-7%: ref 20_000 -> 21_400 / 18_600', () => {
    expect(limits(20_000, 'HOSE')).toEqual({ ceiling: 21_400, floor: 18_600 });
  });
  it('HOSE tick rounding: ceiling down, floor up', () => {
    expect(limits(25_400, 'HOSE')).toEqual({ ceiling: 27_150, floor: 23_650 });
  });
  it('HOSE crossing band edges', () => {
    expect(limits(9_500, 'HOSE')).toEqual({ ceiling: 10_150, floor: 8_840 });
    expect(limits(10_500, 'HOSE').floor).toBe(9_770);
    expect(limits(53_000, 'HOSE').floor).toBe(49_300);
  });
  it('HNX +-10% and UPCOM +-15%', () => {
    expect(limits(15_000, 'HNX')).toEqual({ ceiling: 16_500, floor: 13_500 });
    expect(limits(12_300, 'UPCOM')).toEqual({ ceiling: 14_100, floor: 10_500 });
  });
  it('uses the rules input, not a hard-coded rate', () => {
    const custom = { priceLimitPpm: { ...rules.priceLimitPpm, HOSE: 50_000 } };
    expect(limits(20_000, 'HOSE', custom as typeof rules)).toEqual({ ceiling: 21_000, floor: 19_000 });
    expect(limits(20_000, 'HOSE')).toEqual({ ceiling: 21_400, floor: 18_600 });
  });
  it('ppm 0 gives ceiling = floor = ref', () => {
    const zero = { priceLimitPpm: { ...rules.priceLimitPpm, HOSE: 0 } };
    expect(limits(20_000, 'HOSE', zero as typeof rules)).toEqual({ ceiling: 20_000, floor: 20_000 });
  });
  it('throws RangeError on a bad ref', () => {
    for (const ref of [0, -100, 20_000.5, 10_030]) expect(() => limits(ref, 'HOSE')).toThrow(RangeError);
  });
  it('round-trips through priceTone', () => {
    const l = limits(20_000, 'HOSE');
    expect(priceTone({ price: l.ceiling, ref: 20_000, ...l })).toBe('ceiling');
    expect(priceTone({ price: l.floor, ref: 20_000, ...l })).toBe('floor');
    expect(priceTone({ price: 20_000, ref: 20_000, ...l })).toBe('ref');
  });
});

const bar = (tradeDate: string, close: number, over: Partial<StoredClose> = {}): StoredClose => ({
  symbol: 'VNM',
  close,
  tradeDate,
  volume: 1_000,
  source: 'tcbs',
  fetchedAt: '2026-10-23T11:30:00Z',
  ...over,
});
// 2026-10-23 is a Friday, 2026-10-22 Thursday, 2026-10-19 Monday.
const build = (bars: StoredClose[], over: Partial<Parameters<typeof buildPriceBoardRow>[0]> = {}) =>
  buildPriceBoardRow({
    symbol: 'VNM',
    bars,
    exchange: 'HOSE',
    rules,
    tickBands,
    expectedDate: '2026-10-23',
    holidays: [],
    exDates: [],
    ...over,
  });

describe('buildPriceBoardRow', () => {
  it('no bars -> missing, all values null', () => {
    const r = build([]);
    expect(r.status).toBe('missing');
    expect([r.close, r.volume, r.source, r.fetchedAt, r.ref, r.ceiling, r.floor, r.change, r.changePctPpm, r.tone]).toEqual(
      Array(10).fill(null),
    );
  });
  it('one bar -> no reference, nothing fabricated', () => {
    const r = build([bar('2026-10-23', 20_000)]);
    expect(r).toMatchObject({ close: 20_000, volume: 1_000, source: 'tcbs', fetchedAt: '2026-10-23T11:30:00Z', ref: null, change: null, ceiling: null, floor: null, tone: null });
    expect(r.flags.noReference).toBe(true);
  });
  it('two consecutive bars -> ref, change, pct, limits, tone', () => {
    const r = build([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)]);
    expect(r).toMatchObject({ ref: 20_000, change: 500, changePctPpm: 25_000, ceiling: 21_400, floor: 18_600, tone: 'up', status: 'fresh' });
  });
  it('ceiling close has ceiling tone', () => {
    expect(build([bar('2026-10-23', 21_400), bar('2026-10-22', 20_000)]).tone).toBe('ceiling');
    expect(build([bar('2026-10-23', 18_600), bar('2026-10-22', 20_000)]).tone).toBe('floor');
  });
  it('negative change rounds half away from zero', () => {
    // -1/3 of 1% steps: change -50 on ref 30_000 = -1666.67 ppm -> -1667
    const r = build([bar('2026-10-23', 29_950), bar('2026-10-22', 30_000)]);
    expect(r.change).toBe(-50);
    expect(r.changePctPpm).toBe(-1_667);
    expect(r.tone).toBe('down');
  });
  it('gapped when prev is not the previous trading day; a holiday is not a gap', () => {
    const gapped = build([bar('2026-10-23', 20_500), bar('2026-10-21', 20_000)]);
    expect(gapped.flags.gapped).toBe(true);
    expect([gapped.ref, gapped.change, gapped.ceiling]).toEqual([null, null, null]);
    const holiday = build([bar('2026-10-23', 20_500), bar('2026-10-21', 20_000)], { holidays: ['2026-10-22'] });
    expect(holiday.flags.gapped).toBe(false);
    expect(holiday.ref).toBe(20_000);
  });
  it('weekend between bars is not a gap', () => {
    const r = build([bar('2026-10-19', 20_500), bar('2026-10-16', 20_000)], { expectedDate: '2026-10-19' });
    expect(r.flags.gapped).toBe(false);
  });
  it('ex-date session is flagged, close shown, no reference', () => {
    const r = build([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)], { exDates: ['2026-10-23'] });
    expect(r.flags.exDate).toBe(true);
    expect(r).toMatchObject({ close: 20_500, ref: null, change: null, ceiling: null, floor: null });
  });
  it('unknown exchange -> change set, limits null, change tone', () => {
    const r = build([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)], { exchange: null });
    expect(r).toMatchObject({ change: 500, changePctPpm: 25_000, ceiling: null, floor: null, tone: 'up' });
    expect(r.flags.exchangeUnknown).toBe(true);
  });
  it('stale: ceiling/floor tone downgraded, limits still returned', () => {
    const r = build([bar('2026-10-23', 21_400), bar('2026-10-22', 20_000)], { expectedDate: '2026-10-26' });
    expect(r.status).toBe('stale');
    expect(r).toMatchObject({ tone: 'up', ceiling: 21_400, floor: 18_600 });
  });
  it('ref off its tick -> no limits, flagged, no throw', () => {
    const r = build([bar('2026-10-23', 10_100), bar('2026-10-22', 10_030)]);
    expect(r.flags.refOffTick).toBe(true);
    expect([r.ceiling, r.floor]).toEqual([null, null]);
    expect(r.ref).toBe(10_030);
    expect(r.tone).toBe('up');
  });
});

describe('splitWatchlistGroups', () => {
  it('held and watched appear only in holdings plus alsoWatched; sorted', () => {
    expect(splitWatchlistGroups(['VNM', 'FPT'], ['VNM', 'HPG', 'ACB'])).toEqual({
      holdings: ['FPT', 'VNM'],
      watching: ['ACB', 'HPG'],
      alsoWatched: ['VNM'],
    });
  });
  it('empty inputs', () => {
    expect(splitWatchlistGroups([], [])).toEqual({ holdings: [], watching: [], alsoWatched: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { vnDayBoundsUtc } from '../calendar';
import { CHART_GEOMETRY, buildChartSeries, chartWindow, subtractCalendarMonths } from './chart-series';
import type { ChartWindow } from './chart-series';
import type { StoredClose } from './price-board';

const bar = (tradeDate: string, close = 100_000, volume = 1000, over: Partial<StoredClose> = {}): StoredClose => ({
  symbol: 'FPT',
  tradeDate,
  close,
  volume,
  source: 'tcbs',
  fetchedAt: '2026-10-23T11:30:00Z',
  ...over,
});
// Mon 2026-10-19 .. Fri 2026-10-23
const win = (from: string, to: string): ChartWindow => ({ from, to, trimmed: false });
const W = win('2026-10-19', '2026-10-23');
const build = (bars: StoredClose[], over: Partial<Parameters<typeof buildChartSeries>[0]> = {}) =>
  buildChartSeries({ bars, openGaps: [], window: W, holidays: [], ...over });
const full = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((d) => bar(d));

describe('subtractCalendarMonths', () => {
  it('clamps the day, wraps years, handles leap years', () => {
    expect(subtractCalendarMonths('2026-10-30', 1)).toBe('2026-09-30');
    expect(subtractCalendarMonths('2026-03-31', 1)).toBe('2026-02-28');
    expect(subtractCalendarMonths('2024-03-31', 1)).toBe('2024-02-29');
    expect(subtractCalendarMonths('2026-01-15', 3)).toBe('2025-10-15');
    expect(subtractCalendarMonths('2026-10-30', 12)).toBe('2025-10-30');
  });
  it('throws on an invalid date', () => {
    expect(() => subtractCalendarMonths('2026-13-01', 1)).toThrow(RangeError);
  });
});

describe('chartWindow', () => {
  it('starts at the range start when enough history is stored', () => {
    expect(chartWindow({ endDate: '2026-10-30', range: '3T', firstStoredDate: '2025-01-01' })).toEqual({
      from: '2026-07-30',
      to: '2026-10-30',
      trimmed: false,
    });
  });
  it('trims to the first stored date', () => {
    expect(chartWindow({ endDate: '2026-10-30', range: '1N', firstStoredDate: '2026-09-01' })).toEqual({
      from: '2026-09-01',
      to: '2026-10-30',
      trimmed: true,
    });
  });
  it('is empty without stored data or when the first date is after the end', () => {
    for (const first of [null, '2026-11-01']) {
      const w = chartWindow({ endDate: '2026-10-30', range: '1T', firstStoredDate: first });
      expect(w.from > w.to).toBe(true);
    }
  });
});

describe('buildChartSeries', () => {
  it('slots are trading days only (weekend and holiday off-axis)', () => {
    const s = build([], { window: win('2026-10-22', '2026-10-27'), holidays: ['2026-10-26'] });
    expect(s.slots.map((x) => x.date)).toEqual(['2026-10-22', '2026-10-23', '2026-10-27']);
  });

  it('every bar slot carries close, volume, source and fetchedAt', () => {
    const s = build(full);
    expect(s.slots.every((x) => x.kind === 'bar' && x.bar?.source === 'tcbs' && x.bar.fetchedAt !== '')).toBe(true);
    expect(s.stats.barDays).toBe(5);
  });

  it('a missing day splits the line into two segments and no segment covers the missing x', () => {
    const s = build(full.filter((b) => b.tradeDate !== '2026-10-21'));
    expect(s.segments).toHaveLength(2);
    expect(s.segments.map((g) => [g.fromDate, g.toDate])).toEqual([
      ['2026-10-19', '2026-10-20'],
      ['2026-10-22', '2026-10-23'],
    ]);
    const missingX = (s.slots[2] as { x: number }).x;
    for (const g of s.segments) {
      const xs = [...g.d.matchAll(/[ML] ([\d.]+) /g)].map((m) => Number(m[1]));
      expect(xs.some((x) => x === missingX)).toBe(false);
      expect(Math.min(...xs) < missingX && Math.max(...xs) > missingX).toBe(false);
    }
  });

  it('a single bar between two missing days is a dot', () => {
    const s = build([bar('2026-10-21')]);
    expect(s.segments).toEqual([]);
    expect(s.dots).toHaveLength(1);
    expect(s.dots[0]?.date).toBe('2026-10-21');
  });

  it('classifies recorded vs unrecorded; market-wide gaps are just open gaps', () => {
    const b = vnDayBoundsUtc('2026-10-20');
    const s = build(full.filter((x) => x.tradeDate !== '2026-10-20' && x.tradeDate !== '2026-10-22'), {
      openGaps: [{ id: 7, fromTs: b.fromTs, toTs: b.toTs }],
    });
    expect(s.slots[1]).toMatchObject({ kind: 'gap_recorded', gapId: 7 });
    expect(s.slots[3]).toMatchObject({ kind: 'missing_unrecorded' });
    expect(s.stats.recordedGapDays).toBe(1);
    expect(s.stats.unrecordedDays).toBe(1);
  });

  it('a stored bar beats an open gap', () => {
    const b = vnDayBoundsUtc('2026-10-20');
    const s = build(full, { openGaps: [{ id: 1, fromTs: b.fromTs, toTs: b.toTs }] });
    expect(s.slots[1]?.kind).toBe('bar');
  });

  it('gap containment compares epoch ms of the VN day bounds', () => {
    const b = vnDayBoundsUtc('2026-10-20');
    const short = { id: 1, fromTs: b.fromTs, toTs: '2026-10-20T16:59:58Z' };
    const exact = { id: 2, fromTs: b.fromTs.replace('Z', '+00:00'), toTs: b.toTs };
    expect(build([], { openGaps: [short] }).slots[1]?.kind).toBe('missing_unrecorded');
    expect(build([], { openGaps: [exact] }).slots[1]?.kind).toBe('gap_recorded');
  });

  it('merges consecutive same-kind missing slots into bands; different kinds stay separate; width >= 3', () => {
    const b = vnDayBoundsUtc('2026-10-20');
    const s = build([bar('2026-10-19')], { openGaps: [{ id: 1, fromTs: b.fromTs, toTs: b.toTs }] });
    expect(s.bands.map((x) => [x.kind, x.days])).toEqual([
      ['gap_recorded', 1],
      ['missing_unrecorded', 3],
    ]);
    const one = build(full.slice(0, 4), { window: win('2026-10-19', '2026-10-23') });
    expect(one.bands).toHaveLength(1);
    const many = build([], { window: win('2025-01-01', '2026-10-23') });
    expect(many.bands[0]?.w).toBeGreaterThanOrEqual(3);
  });

  it('trailing missing slots up to the end date are unrecorded bands at the right edge', () => {
    const s = build(full.slice(0, 3));
    const band = s.bands[0];
    expect(band).toMatchObject({ kind: 'missing_unrecorded', days: 2, toDate: '2026-10-23' });
    expect((band?.x ?? 0) + (band?.w ?? 0)).toBeLessThanOrEqual(CHART_GEOMETRY.width - CHART_GEOMETRY.plotRight + 0.01);
  });

  it('volume: one rect per bar slot, zero volume has height 0, max volume fills the panel', () => {
    const s = build([bar('2026-10-19', 100, 0), bar('2026-10-21', 100, 500), bar('2026-10-23', 100, 250)]);
    expect(s.volumeBars).toHaveLength(3);
    expect(s.volumeBars[0]?.h).toBe(0);
    expect(s.volumeBars[1]?.h).toBe(CHART_GEOMETRY.volumeHeight);
    expect(s.volumeBars[2]?.h).toBe(CHART_GEOMETRY.volumeHeight / 2);
    const zero = build([bar('2026-10-19', 100, 0)]);
    expect(zero.volumeBars[0]?.h).toBe(0);
  });

  it('price ticks are min and max close; a flat series stays finite', () => {
    const s = build([bar('2026-10-19', 100_000), bar('2026-10-20', 120_000)]);
    expect(s.priceTicks.map((t) => t.value)).toEqual([100_000, 120_000]);
    expect((s.priceTicks[0]?.y ?? 0) > (s.priceTicks[1]?.y ?? 0)).toBe(true);
    const flat = build([bar('2026-10-19', 100_000), bar('2026-10-20', 100_000)]);
    expect(flat.segments[0]?.d).not.toMatch(/NaN|Infinity/);
    expect(flat.priceTicks.every((t) => Number.isFinite(t.y))).toBe(true);
  });

  it('x labels: first, middle, last; one slot gives one label', () => {
    expect(build(full).xLabels.map((l) => [l.text, l.anchor])).toEqual([
      ['19/10', 'start'],
      ['21/10', 'middle'],
      ['23/10', 'end'],
    ]);
    expect(build([], { window: win('2026-10-19', '2026-10-19') }).xLabels).toHaveLength(1);
  });

  it('stats: first/last, high/low, counts, sources and latest fetch', () => {
    const s = build([
      bar('2026-10-19', 100_000, 1, { source: 'a', fetchedAt: '2026-10-19T10:00:00Z' }),
      bar('2026-10-20', 130_000, 1, { source: 'b', fetchedAt: '2026-10-21T10:00:00+07:00' }),
      bar('2026-10-23', 110_000, 1, { source: 'a', fetchedAt: '2026-10-19T12:00:00Z' }),
    ]);
    expect(s.stats).toMatchObject({
      barDays: 3,
      unrecordedDays: 2,
      first: { date: '2026-10-19', close: 100_000 },
      last: { date: '2026-10-23', close: 110_000 },
      high: 130_000,
      low: 100_000,
      latestFetchedAt: '2026-10-21T10:00:00+07:00',
      sources: ['a', 'b'],
    });
  });

  it('empty window and zero bars give hasData false without throwing', () => {
    const e = buildChartSeries({ bars: [], openGaps: [], window: win('2026-10-30', '2026-09-30'), holidays: [] });
    expect(e).toMatchObject({ hasData: false, slots: [], segments: [], volumeBars: [], priceTicks: [], xLabels: [] });
    expect(build([]).hasData).toBe(false);
  });

  it('ignores bars outside the window or on non-trading days', () => {
    const s = build([bar('2026-10-18'), bar('2026-10-24'), bar('2026-10-10')]);
    expect(s.hasData).toBe(false);
  });

  it('250 slots: all numbers finite, non-negative sizes, x inside the plot, deterministic', () => {
    const w = win('2025-10-30', '2026-10-30');
    const days = build([], { window: w }).slots.map((x) => x.date);
    const bars = days.filter((_, i) => i % 7 !== 3).map((d, i) => bar(d, 90_000 + i * 100, i * 10));
    const a = build(bars, { window: w });
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity|null/);
    expect(a.slots.length).toBeGreaterThan(240);
    for (const x of a.slots) expect(x.x).toBeGreaterThan(CHART_GEOMETRY.plotLeft);
    for (const v of a.volumeBars) expect(v.w >= 0 && v.h >= 0).toBe(true);
    expect(a).toEqual(build(bars, { window: w }));
  });
});

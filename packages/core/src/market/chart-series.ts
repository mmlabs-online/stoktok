/**
 * Price + volume chart series (R1, R4): one slot per trading day, scales and paths computed here so the
 * component only maps fields. A missing day is never interpolated: the line is split into segments.
 */
import { isValidDate, tradingDaysBetween, vnDayBoundsUtc } from '../calendar';
import { mulDiv } from '../money';
import type { StoredClose } from './price-board';
import type { OpenGap } from './quarters';

export const CHART_RANGES = ['1T', '3T', '6T', '1N'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const DEFAULT_CHART_RANGE: ChartRange = '3T';
const RANGE_MONTHS: Record<ChartRange, number> = { '1T': 1, '3T': 3, '6T': 6, '1N': 12 };

export interface ChartWindow {
  from: string;
  to: string;
  /** The axis starts at the first stored date because the range reaches further back. */
  trimmed: boolean;
}

export type SlotKind = 'bar' | 'gap_recorded' | 'missing_unrecorded';

export interface ChartSlot {
  index: number;
  date: string;
  x: number;
  kind: SlotKind;
  bar?: StoredClose;
  gapId?: number;
}

export interface ChartSegment {
  d: string;
  fromDate: string;
  toDate: string;
}
export interface ChartDot {
  x: number;
  y: number;
  date: string;
}
export interface ChartVolumeBar {
  x: number;
  y: number;
  w: number;
  h: number;
  date: string;
}
export interface ChartBand {
  kind: Exclude<SlotKind, 'bar'>;
  fromDate: string;
  toDate: string;
  days: number;
  x: number;
  w: number;
}
export interface ChartTick {
  /** Integer VND for price ticks, volume for the volume tick. */
  value: number;
  y: number;
}
export interface ChartXLabel {
  x: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
}
export interface ChartStats {
  barDays: number;
  recordedGapDays: number;
  unrecordedDays: number;
  first?: { date: string; close: number };
  last?: { date: string; close: number };
  high?: number;
  low?: number;
  latestFetchedAt?: string;
  sources: string[];
}
export interface ChartSeries {
  window: ChartWindow;
  hasData: boolean;
  slots: ChartSlot[];
  segments: ChartSegment[];
  dots: ChartDot[];
  volumeBars: ChartVolumeBar[];
  bands: ChartBand[];
  priceTicks: ChartTick[];
  volumeMaxTick: ChartTick | null;
  xLabels: ChartXLabel[];
  stats: ChartStats;
}

export const CHART_GEOMETRY = {
  width: 360,
  height: 240,
  plotLeft: 44,
  plotRight: 8,
  priceTop: 8,
  priceHeight: 150,
  volumeTop: 166,
  volumeHeight: 48,
  labelY: 232,
} as const;

const G = CHART_GEOMETRY;
const PLOT_W = G.width - G.plotLeft - G.plotRight;
const r2 = (n: number) => Math.round(n * 100) / 100;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar months back from a date, day clamped to the target month's length. Throws on an invalid date. */
export function subtractCalendarMonths(date: string, months: number): string {
  if (!isValidDate(date)) throw new RangeError(`invalid date: ${date}`);
  const total = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Inclusive window ending at `endDate`, trimmed to the first stored date. Empty (from > to) without stored data. */
export function chartWindow(input: { endDate: string; range: ChartRange; firstStoredDate: string | null }): ChartWindow {
  const { endDate, firstStoredDate } = input;
  const rangeStart = subtractCalendarMonths(endDate, RANGE_MONTHS[input.range]);
  if (firstStoredDate === null || firstStoredDate > endDate) {
    return { from: endDate, to: rangeStart, trimmed: false };
  }
  const trimmed = firstStoredDate > rangeStart;
  return { from: trimmed ? firstStoredDate : rangeStart, to: endDate, trimmed };
}

export function buildChartSeries(input: {
  bars: readonly StoredClose[];
  openGaps: readonly OpenGap[];
  window: ChartWindow;
  holidays: readonly string[];
}): ChartSeries {
  const { window } = input;
  const days = window.from > window.to ? [] : tradingDaysBetween(window.from, window.to, input.holidays);
  const byDate = new Map(input.bars.map((b) => [b.tradeDate, b]));
  const slotW = days.length > 0 ? PLOT_W / days.length : 0;

  const slots: ChartSlot[] = days.map((date, index) => {
    const x = r2(G.plotLeft + (index + 0.5) * slotW);
    const bar = byDate.get(date);
    if (bar) return { index, date, x, kind: 'bar', bar };
    const b = vnDayBoundsUtc(date);
    const from = Date.parse(b.fromTs);
    const to = Date.parse(b.toTs);
    const gap = input.openGaps.find((g) => Date.parse(g.fromTs) <= from && Date.parse(g.toTs) >= to);
    return gap ? { index, date, x, kind: 'gap_recorded', gapId: gap.id } : { index, date, x, kind: 'missing_unrecorded' };
  });

  const barSlots = slots.filter((s) => s.bar);
  const closes = barSlots.map((s) => (s.bar as StoredClose).close);
  const lo = closes.length > 0 ? Math.min(...closes) : 0;
  const hi = closes.length > 0 ? Math.max(...closes) : 0;
  const pad = Math.max(hi > lo ? mulDiv(hi - lo, 5, 100) : mulDiv(hi, 1, 100), 1);
  const yOf = (close: number) => r2(G.priceTop + G.priceHeight - ((close - (lo - pad)) * G.priceHeight) / (hi + pad - (lo - pad)));

  const segments: ChartSegment[] = [];
  const dots: ChartDot[] = [];
  const bands: ChartBand[] = [];
  let run: ChartSlot[] = [];
  const flushRun = () => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first && last) {
      if (run.length === 1) dots.push({ x: first.x, y: yOf((first.bar as StoredClose).close), date: first.date });
      else {
        const d = run.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.x} ${yOf((s.bar as StoredClose).close)}`).join(' ');
        segments.push({ d, fromDate: first.date, toDate: last.date });
      }
    }
    run = [];
  };
  let band: ChartSlot[] = [];
  const flushBand = () => {
    const first = band[0];
    const last = band[band.length - 1];
    if (first && last) {
      const w = Math.min(Math.max(r2(band.length * slotW), 3), PLOT_W);
      const x = Math.min(r2(G.plotLeft + first.index * slotW), G.width - G.plotRight - w);
      bands.push({ kind: first.kind as ChartBand['kind'], fromDate: first.date, toDate: last.date, days: band.length, x, w });
    }
    band = [];
  };
  for (const s of slots) {
    if (s.kind === 'bar') {
      flushBand();
      run.push(s);
    } else {
      flushRun();
      if (band.length > 0 && (band[0] as ChartSlot).kind !== s.kind) flushBand();
      band.push(s);
    }
  }
  flushRun();
  flushBand();

  const maxVolume = barSlots.reduce((m, s) => Math.max(m, (s.bar as StoredClose).volume), 0);
  const barW = Math.max(r2(slotW * 0.7), 1);
  const volumeBars: ChartVolumeBar[] = barSlots.map((s) => {
    const h = maxVolume > 0 ? r2((((s.bar as StoredClose).volume) * G.volumeHeight) / maxVolume) : 0;
    return { x: r2(s.x - barW / 2), y: r2(G.volumeTop + G.volumeHeight - h), w: barW, h, date: s.date };
  });

  const labelIdx = [...new Set([0, Math.floor((slots.length - 1) / 2), slots.length - 1])].filter((i) => i >= 0 && i < slots.length);
  const xLabels: ChartXLabel[] = labelIdx.map((i) => {
    const s = slots[i] as ChartSlot;
    const anchor = labelIdx.length === 1 ? 'middle' : i === 0 ? 'start' : i === slots.length - 1 ? 'end' : 'middle';
    return { x: s.x, text: `${s.date.slice(8, 10)}/${s.date.slice(5, 7)}`, anchor };
  });

  const firstBar = barSlots[0];
  const lastBar = barSlots[barSlots.length - 1];
  const fetched = barSlots.map((s) => (s.bar as StoredClose).fetchedAt);
  const latestFetchedAt = fetched.reduce<string | undefined>(
    (m, f) => (m === undefined || Date.parse(f) > Date.parse(m) ? f : m),
    undefined,
  );
  const stats: ChartStats = {
    barDays: barSlots.length,
    recordedGapDays: slots.filter((s) => s.kind === 'gap_recorded').length,
    unrecordedDays: slots.filter((s) => s.kind === 'missing_unrecorded').length,
    sources: [...new Set(barSlots.map((s) => (s.bar as StoredClose).source))],
    ...(firstBar && lastBar
      ? {
          first: { date: firstBar.date, close: (firstBar.bar as StoredClose).close },
          last: { date: lastBar.date, close: (lastBar.bar as StoredClose).close },
          high: hi,
          low: lo,
        }
      : {}),
    ...(latestFetchedAt !== undefined ? { latestFetchedAt } : {}),
  };

  const hasData = barSlots.length > 0;
  return {
    window,
    hasData,
    slots,
    segments,
    dots,
    volumeBars,
    bands,
    priceTicks: hasData ? [{ value: lo, y: yOf(lo) }, { value: hi, y: yOf(hi) }] : [],
    volumeMaxTick: hasData ? { value: maxVolume, y: G.volumeTop } : null,
    xLabels,
    stats,
  };
}

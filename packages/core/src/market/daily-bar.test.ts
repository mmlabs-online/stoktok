import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_SANITY } from './config';
import { normalizeDailyBar, toVnd } from './daily-bar';
import type { RawDailyBar } from './daily-bar';

const good: RawDailyBar = { open: 61000, high: 62000, low: 60500, close: 61500, volume: 1_200_000, tradeDate: '2026-10-23' };
const norm = (over: Partial<Record<keyof RawDailyBar, unknown>> = {}, last?: number, unit: 'VND' | 'THOUSAND_VND' = 'VND') =>
  normalizeDailyBar('VNM', { ...good, ...over }, unit, DEFAULT_PRICE_SANITY, last);
const reason = (r: ReturnType<typeof norm>) => (r.ok ? 'ok' : r.reason);

describe('toVnd', () => {
  it('keeps VND integers', () => expect(toVnd(61500, 'VND')).toBe(61500));
  it('rejects fractional VND', () => expect(toVnd(61.5, 'VND')).toBeNull());
  it('converts thousand VND, float-safe', () => {
    expect(toVnd(61.5, 'THOUSAND_VND')).toBe(61500);
    expect(toVnd(61.55, 'THOUSAND_VND')).toBe(61550);
  });
  it('rejects sub-VND precision', () => expect(toVnd(61.5555, 'THOUSAND_VND')).toBeNull());
  it('rejects non-finite, string, null', () => {
    for (const v of [NaN, Infinity, '61500', null, undefined]) expect(toVnd(v, 'VND')).toBeNull();
  });
});

describe('normalizeDailyBar', () => {
  it('valid bar -> integer VND, foreignNet null', () => {
    expect(norm()).toEqual({ ok: true, bar: { symbol: 'VNM', tradeDate: '2026-10-23', open: 61000, high: 62000, low: 60500, close: 61500, volume: 1_200_000, foreignNet: null } });
  });
  it('converts thousand VND', () => {
    const r = norm({ open: 61, high: 62, low: 60.5, close: 61.5 }, undefined, 'THOUSAND_VND');
    expect(r.ok && r.bar.close).toBe(61500);
  });
  it('rejects missing field, negative price, bad volume, bad date', () => {
    expect(reason(norm({ close: undefined }))).toBe('missing_close');
    expect(reason(norm({ open: null }))).toBe('missing_open');
    expect(reason(norm({ volume: undefined }))).toBe('missing_volume');
    expect(reason(norm({ low: -60000 }))).toBe('price_out_of_band');
    expect(reason(norm({ close: NaN }))).toBe('invalid_close');
    expect(reason(norm({ volume: -1 }))).toBe('invalid_volume');
    expect(reason(norm({ volume: 1.5 }))).toBe('invalid_volume');
    expect(reason(norm({ tradeDate: '2026-02-30' }))).toBe('invalid_trade_date');
    expect(reason(norm({ tradeDate: undefined }))).toBe('invalid_trade_date');
  });
  it('rejects low > high and open/close outside [low, high]', () => {
    expect(reason(norm({ low: 63000 }))).toBe('low_above_high');
    expect(reason(norm({ open: 59000 }))).toBe('open_outside_range');
    expect(reason(norm({ close: 62500 }))).toBe('close_outside_range');
  });
  it('unit guard', () => {
    expect(reason(norm({ open: 61, high: 62, low: 60.5, close: 61.5 }))).toBe('invalid_low');
    expect(reason(norm({ open: 61, high: 61, low: 61, close: 61 }))).toBe('price_out_of_band');
    const big = 61_500_000;
    expect(reason(norm({ open: big, high: big, low: big, close: big }))).toBe('price_out_of_band');
    expect(reason(norm({ open: 61505, high: 61505, low: 61505, close: 61505 }))).toBe('price_off_step');
  });
  it('jump guard', () => {
    expect(reason(norm({}, 61500))).toBe('ok');
    expect(reason(norm({ open: 6150, high: 6150, low: 6150, close: 6150 }, 61500))).toBe('close_jump');
    expect(reason(norm({}, 6000))).toBe('close_jump');
    expect(reason(norm({ open: 30750, high: 30750, low: 30750, close: 30750 }, 61500))).toBe('ok');
  });
});

import { describe, expect, test } from 'vitest';
import { DEFAULT_PRICE_SANITY } from './config';
import { DEFAULT_INTRADAY_CONFIG, intradayQuoteFromMinuteBars, isInIntradayWindow, validateIntradayConfig } from './intraday';
import type { IntradayConfig } from './intraday';

// 2026-11-05 is a Thursday. VN = UTC+7.
const vn = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);

describe('isInIntradayWindow', () => {
  test.each([
    ['08:59', false],
    ['09:00', true],
    ['11:29', true],
    ['11:30', false],
    ['12:59', false],
    ['13:00', true],
    ['14:59', true],
    ['15:00', true],
    ['15:02', true],
    ['15:03', false],
  ])('weekday %s -> %s', (hhmm, expected) => {
    expect(isInIntradayWindow(vn('2026-11-05', hhmm), [])).toBe(expected);
  });

  test('UTC instant input', () => {
    expect(isInIntradayWindow(new Date('2026-11-05T02:00:00Z'), [])).toBe(true);
  });

  test('weekend and holiday', () => {
    expect(isInIntradayWindow(vn('2026-11-07', '10:00'), [])).toBe(false);
    expect(isInIntradayWindow(vn('2026-11-08', '10:00'), [])).toBe(false);
    expect(isInIntradayWindow(vn('2026-11-05', '10:00'), ['2026-11-05'])).toBe(false);
    expect(isInIntradayWindow(vn('2026-11-06', '10:00'), ['2026-11-05'])).toBe(true);
  });

  test('reads the config, not literals', () => {
    const c: IntradayConfig = { ...DEFAULT_INTRADAY_CONFIG, sessions: [{ fromMinutesVn: 600, toMinutesVn: 620 }], postCloseGraceMinutes: 0 };
    expect(isInIntradayWindow(vn('2026-11-05', '10:00'), [], c)).toBe(true);
    expect(isInIntradayWindow(vn('2026-11-05', '10:20'), [], c)).toBe(false);
    expect(isInIntradayWindow(vn('2026-11-05', '09:30'), [], c)).toBe(false);
  });
});

describe('validateIntradayConfig', () => {
  const d = DEFAULT_INTRADAY_CONFIG;
  test('default passes', () => expect(() => validateIntradayConfig(d)).not.toThrow());
  test.each<[string, IntradayConfig]>([
    ['empty', { ...d, sessions: [] }],
    ['from >= to', { ...d, sessions: [{ fromMinutesVn: 600, toMinutesVn: 600 }] }],
    ['overlap', { ...d, sessions: [{ fromMinutesVn: 540, toMinutesVn: 700 }, { fromMinutesVn: 690, toMinutesVn: 900 }] }],
    ['unsorted', { ...d, sessions: [{ fromMinutesVn: 780, toMinutesVn: 900 }, { fromMinutesVn: 540, toMinutesVn: 690 }] }],
    ['minutes > 1440', { ...d, sessions: [{ fromMinutesVn: 540, toMinutesVn: 1441 }] }],
    ['minutes < 0', { ...d, sessions: [{ fromMinutesVn: -1, toMinutesVn: 100 }] }],
    ['negative grace', { ...d, postCloseGraceMinutes: -1 }],
    ['throttleMs 0', { ...d, throttleMs: 0 }],
    ['refreshIntervalMs 0', { ...d, refreshIntervalMs: 0 }],
    ['staleAfterMs -1', { ...d, staleAfterMs: -1 }],
  ])('rejects %s', (_n, c) => expect(() => validateIntradayConfig(c)).toThrow(RangeError));
});

describe('intradayQuoteFromMinuteBars', () => {
  const sec = (date: string, hhmm: string) => Math.floor(vn(date, hhmm).getTime() / 1000);
  const base = { today: '2026-11-05', unit: 'VND' as const, sanity: DEFAULT_PRICE_SANITY, source: 'vci-public', fetchedAt: '2026-11-05T03:00:00.000Z' };
  const today = (hhmm: string, c: unknown, v: unknown = 100) => ({ t: sec('2026-11-05', hhmm), c, v });

  test('newest of today, volume summed over today only', () => {
    const r = intradayQuoteFromMinuteBars(
      'VNM',
      [today('10:02', 61_500, 30), { t: sec('2026-11-04', '14:59'), c: 60_000, v: 999 }, today('10:00', 61_000, 10), today('10:01', 61_300, 20)],
      base,
    );
    expect(r).toEqual({
      ok: true,
      quote: { symbol: 'VNM', ts: '2026-11-05T03:02:00.000Z', price: 61_500, volume: 60, source: 'vci-public', fetchedAt: base.fetchedAt },
    });
  });

  test.each<[string, unknown[], string, Partial<typeof base & { lastClose: number }>?]>([
    ['empty', [], 'no_bars_today'],
    ['only yesterday', [{ t: 1_793_000_000 - 86_400 * 2, c: 61_500, v: 1 }], 'no_bars_today'],
    ['bad ts', [{ t: 'x', c: 61_500, v: 1 }], 'invalid_ts'],
    ['non-integer price', [today('10:00', 61_500.5)], 'invalid_price'],
    ['NaN price', [today('10:00', Number.NaN)], 'invalid_price'],
    ['missing price', [{ t: sec('2026-11-05', '10:00'), v: 1 }], 'invalid_price'],
    ['band', [today('10:00', 50)], 'price_out_of_band'],
    ['step', [today('10:00', 61_505)], 'price_off_step'],
    ['jump', [today('10:00', 61_500)], 'close_jump', { lastClose: 1_000 }],
    ['negative volume', [today('10:00', 61_500, -1)], 'invalid_volume'],
    ['fractional volume', [today('10:00', 61_500, 1.5)], 'invalid_volume'],
    ['unsafe sum', [today('10:00', 61_500, Number.MAX_SAFE_INTEGER), today('10:01', 61_500, 5)], 'invalid_volume'],
  ])('rejects %s', (_n, bars, reason, extra) => {
    expect(intradayQuoteFromMinuteBars('VNM', bars as never, { ...base, ...extra })).toEqual({ ok: false, reason });
  });

  test('THOUSAND_VND unit', () => {
    const r = intradayQuoteFromMinuteBars('VNM', [today('10:00', 61.5)], { ...base, unit: 'THOUSAND_VND' });
    expect(r.ok && r.quote.price).toBe(61_500);
  });
});

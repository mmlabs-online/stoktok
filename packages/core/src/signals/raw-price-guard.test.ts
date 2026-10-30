import { describe, expect, test } from 'vitest';
import type { CorporateAction } from '../ledger/types';
import type { StoredClose } from '../market/price-board';
import { DEFAULT_MARKET_RULES } from '../settings/market-rules';
import { SIGNAL_DATE, closes, tradingDates } from './fixtures';
import { checkRawPriceWindow, isBeyondDailyLimit, resolveLimitPpm } from './raw-price-guard';

const L = DEFAULT_MARKET_RULES.priceLimitPpm;
const series = (vals: number[]): StoredClose[] => closes('A', SIGNAL_DATE, vals.length, (i) => vals[i] as number);
const check = (window: StoredClose[], over: Partial<Parameters<typeof checkRawPriceWindow>[0]> = {}) =>
  checkRawPriceWindow({ symbol: 'A', window, exchange: 'HOSE', priceLimitPpm: L, actions: [], holidays: [], ...over });
const stock = (exDate: string, symbol = 'A'): CorporateAction => ({ type: 'stock_dividend', id: 'sd1', symbol, exDate, ratio: { held: 100, received: 20 } });
const cash = (exDate: string): CorporateAction => ({ type: 'cash_dividend', id: 'cd1', symbol: 'A', exDate, amountPerShare: 1000 });

describe('jump check', () => {
  test('HOSE exactly +7% does not trigger; one tick more triggers', () => {
    expect(check(series([20_000, 21_400])).reasons).toEqual([]);
    expect(check(series([20_000, 21_450])).reasons).toEqual(['price_jump_beyond_limit']);
  });
  test('HOSE exactly -7% does not trigger; one tick more triggers', () => {
    expect(check(series([20_000, 18_600])).reasons).toEqual([]);
    expect(check(series([20_000, 18_550])).reasons).toEqual(['price_jump_beyond_limit']);
  });
  test('snapped ceiling 25,400 -> 27,150 passes; 27,200 triggers', () => {
    expect(check(series([25_400, 27_150])).reasons).toEqual([]);
    expect(check(series([25_400, 27_200])).reasons).toEqual(['price_jump_beyond_limit']);
  });
  test('HNX 15,000 -> 16,500 and UPCOM 12,300 -> 14,100 do not trigger', () => {
    expect(check(series([15_000, 16_500]), { exchange: 'HNX' }).reasons).toEqual([]);
    expect(check(series([12_300, 14_100]), { exchange: 'UPCOM' }).reasons).toEqual([]);
  });
  test('null exchange: +12% passes, +16% triggers, widest limit used and flagged', () => {
    const ok = check(series([10_000, 11_200]), { exchange: null });
    expect(ok).toMatchObject({ reasons: [], exchangeUnknown: true, limitPpmUsed: 150_000 });
    expect(check(series([10_000, 11_600]), { exchange: null }).reasons).toEqual(['price_jump_beyond_limit']);
  });
  test('null exchange follows a changed config max', () => {
    const r = check(series([10_000, 10_000]), { exchange: null, priceLimitPpm: { ...L, HNX: 200_000 } });
    expect(r.limitPpmUsed).toBe(200_000);
  });
  test('known exchange: not unknown, uses its own ppm', () => {
    expect(check(series([10_000, 10_000]), { exchange: 'HNX' })).toMatchObject({ exchangeUnknown: false, limitPpmUsed: 100_000, exchange: 'HNX' });
    expect(resolveLimitPpm('HOSE', L)).toEqual({ limitPpm: 70_000, exchangeUnknown: false });
  });
  test('the first bar is not compared with anything', () => {
    expect(check(series([30_000])).reasons).toEqual([]);
  });
  test('a pair that is not adjacent trading days is skipped', () => {
    const w = series([10_000, 10_000, 20_000]);
    const gapped = [w[0] as StoredClose, w[2] as StoredClose];
    expect(check(gapped).reasons).toEqual([]);
  });
  test('prevClose <= 0 is skipped; an off-tick prevClose does not throw', () => {
    expect(check(series([0, 10_000])).reasons).toEqual([]);
    expect(check(series([25_433, 27_200])).reasons).toEqual([]);
  });
  test('jumps list date, prevClose, close and movePpm', () => {
    expect(check(series([10_000, 12_000])).jumps).toEqual([{ date: SIGNAL_DATE, prevClose: 10_000, close: 12_000, movePpm: 200_000 }]);
  });
  test('isBeyondDailyLimit is symmetric and exact for large values', () => {
    expect(isBeyondDailyLimit(1000, 1071, 70_000)).toBe(true);
    expect(isBeyondDailyLimit(1000, 929, 70_000)).toBe(true);
    expect(isBeyondDailyLimit(1000, 1070, 70_000)).toBe(false);
    expect(isBeyondDailyLimit(1000, 930, 70_000)).toBe(false);
    expect(isBeyondDailyLimit(999_999_950, 1_069_999_946, 70_000)).toBe(false);
    expect(isBeyondDailyLimit(999_999_950, 1_069_999_947, 70_000)).toBe(true);
  });
});

describe('corporate action check', () => {
  const w = series(Array(10).fill(10_000));
  const d = tradingDates(SIGNAL_DATE, 10);
  test('stock dividend strictly inside triggers and cites its id', () => {
    const r = check(w, { actions: [stock(d[4] as string)] });
    expect(r.reasons).toEqual(['corporate_action_in_window']);
    expect(r.actionRefs).toEqual([{ ref: 'corporate_actions:sd1' }]);
  });
  test('exDate == first bar does not trigger; == last bar triggers', () => {
    expect(check(w, { actions: [stock(d[0] as string)] }).reasons).toEqual([]);
    expect(check(w, { actions: [stock(d[9] as string)] }).reasons).toEqual(['corporate_action_in_window']);
  });
  test('exDate after the last bar or before the first is ignored', () => {
    expect(check(w, { actions: [stock('2026-10-27'), stock('2026-01-01')] }).reasons).toEqual([]);
  });
  test('exDate on a non-trading day inside the window still triggers', () => {
    expect(check(w, { actions: [stock('2026-10-24')] }).reasons).toEqual(['corporate_action_in_window']);
  });
  test('cash dividend and other symbols are ignored', () => {
    expect(check(w, { actions: [cash(d[4] as string), stock(d[4] as string, 'B')] }).reasons).toEqual([]);
  });
  test('both reasons are returned in REASON_ORDER', () => {
    const j = series([10_000, 10_000, 12_000]);
    expect(check(j, { actions: [stock(tradingDates(SIGNAL_DATE, 3)[1] as string)] }).reasons).toEqual(['corporate_action_in_window', 'price_jump_beyond_limit']);
  });
  test('empty window -> no reasons', () => {
    expect(check([], { actions: [stock(d[4] as string)] }).reasons).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { formatRatePercentInput, parseIntegerInput, parseRatePercentInput } from './parse-input';

const max = 2_147_483_647;
const parse = (s: string) => parseIntegerInput(s, { max });

describe('parseIntegerInput', () => {
  it('accepts plain and dot-grouped integers', () => {
    expect(parse('125400')).toEqual({ ok: true, value: 125400 });
    expect(parse('125.400')).toEqual({ ok: true, value: 125400 });
    expect(parse(' 1.250.000 ')).toEqual({ ok: true, value: 1250000 });
    expect(parse('0')).toEqual({ ok: true, value: 0 });
  });
  it('rejects blank as REQUIRED', () => {
    expect(parse('')).toEqual({ ok: false, code: 'REQUIRED' });
    expect(parse('   ')).toEqual({ ok: false, code: 'REQUIRED' });
  });
  it.each(['125,4', '12.34', '1.2345', '1e3', '-5', '+5', 'abc', '1 000'])('rejects %s as NOT_INTEGER', (s) => {
    expect(parse(s)).toEqual({ ok: false, code: 'NOT_INTEGER' });
  });
  it('rejects values above max or the safe integer range', () => {
    expect(parse('2147483648')).toEqual({ ok: false, code: 'TOO_LARGE' });
    expect(parse('2147483647')).toEqual({ ok: true, value: max });
    expect(parseIntegerInput('9007199254740993', { max: Number.MAX_SAFE_INTEGER })).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    });
    expect(parseIntegerInput('99999999999999999999', { max: Number.MAX_SAFE_INTEGER })).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    });
  });
});

describe('parseRatePercentInput', () => {
  const rate = (s: string, maxPpm = 1_000_000) => parseRatePercentInput(s, { maxPpm });
  it('converts percent text to ppm', () => {
    expect(rate('0,15')).toEqual({ ok: true, ppm: 1500 });
    expect(rate('0.15')).toEqual({ ok: true, ppm: 1500 });
    expect(rate('0,1')).toEqual({ ok: true, ppm: 1000 });
    expect(rate('7')).toEqual({ ok: true, ppm: 70000 });
    expect(rate('100')).toEqual({ ok: true, ppm: 1_000_000 });
    expect(rate(' 0,0001 ')).toEqual({ ok: true, ppm: 1 });
  });
  it('rejects blank, negative, too precise and malformed text', () => {
    expect(rate('')).toEqual({ ok: false, code: 'REQUIRED' });
    expect(rate('-1')).toEqual({ ok: false, code: 'NEGATIVE' });
    expect(rate('0,12345')).toEqual({ ok: false, code: 'TOO_PRECISE' });
    for (const s of ['1,2,3', '1.000,5', 'abc', '1e3', ',']) expect(rate(s)).toEqual({ ok: false, code: 'INVALID' });
  });
  it('rejects huge values without precision loss and honours the max edge', () => {
    expect(rate('99999999999999999999')).toEqual({ ok: false, code: 'TOO_LARGE' });
    expect(rate('5', 50000)).toEqual({ ok: true, ppm: 50000 });
    expect(rate('5,0001', 50000)).toEqual({ ok: false, code: 'TOO_LARGE' });
  });
});

describe('formatRatePercentInput', () => {
  it('formats ppm as percent text with a comma', () => {
    expect(formatRatePercentInput(1500)).toBe('0,15');
    expect(formatRatePercentInput(1000)).toBe('0,1');
    expect(formatRatePercentInput(70000)).toBe('7');
    expect(formatRatePercentInput(0)).toBe('0');
    expect(formatRatePercentInput(1)).toBe('0,0001');
  });
  it('round-trips through parseRatePercentInput', () => {
    for (const ppm of [0, 1, 9, 10, 999, 1000, 1500, 70000, 150000, 999999, 1000000]) {
      expect(parseRatePercentInput(formatRatePercentInput(ppm), { maxPpm: 1_000_000 })).toEqual({ ok: true, ppm });
    }
  });
  it('rejects negative or non-integer ppm', () => {
    expect(() => formatRatePercentInput(-1)).toThrow(RangeError);
    expect(() => formatRatePercentInput(1.5)).toThrow(RangeError);
  });
});

import { describe, expect, it } from 'vitest';
import { parseIntegerInput } from './parse-input';

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

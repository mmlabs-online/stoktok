import { describe, expect, it } from 'vitest';
import { chartRangeHref, parseChartRange } from './chart-range-query';

describe('parseChartRange', () => {
  it('accepts the four ranges', () => {
    for (const r of ['1T', '3T', '6T', '1N']) expect(parseChartRange({ range: r })).toBe(r);
  });
  it('falls back to 3T for missing, lower-case or unknown values; arrays use the first element', () => {
    expect(parseChartRange({})).toBe('3T');
    expect(parseChartRange({ range: '1t' })).toBe('3T');
    expect(parseChartRange({ range: 'ALL' })).toBe('3T');
    expect(parseChartRange({ range: ['6T', '1N'] })).toBe('6T');
  });
});

describe('chartRangeHref', () => {
  it('encodes the symbol and sets range', () => {
    expect(chartRangeHref('FPT', '1N')).toBe('/symbols/FPT?range=1N');
    expect(chartRangeHref('A/B', '1T')).toBe('/symbols/A%2FB?range=1T');
  });
});

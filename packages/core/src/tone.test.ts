import { describe, expect, it } from 'vitest';
import { PRICE_TONES, changeTone, priceTone } from './tone';

const lim = { ref: 100000, ceiling: 107000, floor: 93000 };

describe('priceTone', () => {
  it.each([
    [107000, 'ceiling'],
    [108000, 'ceiling'],
    [93000, 'floor'],
    [92000, 'floor'],
    [100000, 'ref'],
    [100100, 'up'],
    [99900, 'down'],
    [106900, 'up'],
  ])('price %i -> %s', (price, tone) => {
    expect(priceTone({ price, ...lim })).toBe(tone);
  });
  it('throws on bad input', () => {
    expect(() => priceTone({ price: 1.5, ...lim })).toThrow(RangeError);
    expect(() => priceTone({ price: 100, ref: 100, ceiling: 107, floor: 101 })).toThrow(RangeError);
    expect(() => priceTone({ price: 100, ref: 100, ceiling: 99, floor: 93 })).toThrow(RangeError);
  });
});

describe('changeTone', () => {
  it('maps sign', () => {
    expect(changeTone(1)).toBe('up');
    expect(changeTone(0)).toBe('ref');
    expect(changeTone(-1)).toBe('down');
    expect(() => changeTone(0.5)).toThrow(RangeError);
  });
});

describe('PRICE_TONES', () => {
  it('lists five tones', () => {
    expect([...PRICE_TONES]).toEqual(['up', 'down', 'ref', 'ceiling', 'floor']);
  });
});

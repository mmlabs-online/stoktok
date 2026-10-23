import { describe, expect, it } from 'vitest';
import { normalizeSymbol } from './symbol';

describe('normalizeSymbol', () => {
  it('accepts and normalizes', () => {
    expect(normalizeSymbol(' fpt ')).toBe('FPT');
    expect(normalizeSymbol('FUEVFVND')).toBe('FUEVFVND');
    expect(normalizeSymbol('CFPT2301')).toBe('CFPT2301');
  });
  it('rejects invalid', () => {
    for (const v of ['FP', 'ABCDEFGHIJK', '', 'FPT/../x', 'FPT%20']) {
      expect(normalizeSymbol(v)).toBeNull();
    }
  });
});

import { describe, expect, test } from 'vitest';
import { EOD_SYNC_CONFIG } from '../config';
import type { PriceSourceId } from '../config';
import { createPriceSource } from './select-price-source';
import { TcbsPriceSource } from './tcbs';
import { VciPriceSource } from './vci';

let fetched = 0;
const deps = {
  fetchImpl: (async () => {
    fetched += 1;
    throw new Error('no network');
  }) as unknown as typeof fetch,
  http: { timeoutMs: 1, maxAttempts: 1, backoffBaseMs: 1, sleep: async () => undefined, log: () => undefined },
};

describe('createPriceSource', () => {
  test('config default is vci-public', () => {
    expect(EOD_SYNC_CONFIG.priceSource).toBe('vci-public');
  });
  test('vci-public builds VciPriceSource, no fetch at construction', () => {
    const s = createPriceSource('vci-public', deps);
    expect(s).toBeInstanceOf(VciPriceSource);
    expect(s.name).toBe('vci-public');
    expect(fetched).toBe(0);
  });
  test('tcbs-public builds TcbsPriceSource', () => {
    const s = createPriceSource('tcbs-public', deps);
    expect(s).toBeInstanceOf(TcbsPriceSource);
    expect(s.name).toBe('tcbs-public');
  });
  test('unknown id throws', () => {
    expect(() => createPriceSource('nope' as PriceSourceId, deps)).toThrow('unknown price source');
  });
});

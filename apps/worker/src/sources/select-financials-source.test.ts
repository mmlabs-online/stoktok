import { describe, expect, test } from 'vitest';
import type { FinancialsSourceId } from '../config';
import { createFinancialsSource } from './select-financials-source';
import { TcbsFinancialsSource } from './tcbs-financials';
import { VciIqFinancialsSource } from './vci-iq-financials';

let fetched = 0;
const deps = {
  fetchImpl: (async () => {
    fetched += 1;
    throw new Error('no network');
  }) as unknown as typeof fetch,
  http: { timeoutMs: 1, maxAttempts: 1, backoffBaseMs: 1, sleep: async () => undefined, log: () => undefined },
};

describe('createFinancialsSource', () => {
  test('vci-iq -> VciIqFinancialsSource; tcbs-public -> TcbsFinancialsSource; unknown -> throws', () => {
    const a = createFinancialsSource('vci-iq', deps);
    expect(a).toBeInstanceOf(VciIqFinancialsSource);
    expect(a.name).toBe('vci-iq');
    const b = createFinancialsSource('tcbs-public', deps);
    expect(b).toBeInstanceOf(TcbsFinancialsSource);
    expect(b.name).toBe('tcbs-public');
    expect(() => createFinancialsSource('nope' as FinancialsSourceId, deps)).toThrow('unknown financials source');
    expect(fetched).toBe(0);
  });
});

import { describe, expect, test } from 'vitest';
import { normalizeSymbol } from '../symbol';
import { NEWS_LINK_CONFIG, NEWS_SYMBOL_ALIASES } from './config';

describe('news link config', () => {
  test('every alias key passes normalizeSymbol; aliases unique across symbols; none shorter than 4 chars; none generic', () => {
    const generic = ['việt nam', 'ngân hàng', 'sài gòn'];
    const seen = new Map<string, string>();
    for (const [symbol, names] of Object.entries(NEWS_SYMBOL_ALIASES)) {
      expect(normalizeSymbol(symbol)).toBe(symbol);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) {
        const key = n.toLowerCase();
        expect(n.length, n).toBeGreaterThanOrEqual(4);
        expect(generic, n).not.toContain(key);
        expect(seen.get(key), n).toBeUndefined();
        seen.set(key, symbol);
      }
    }
  });
  test('stop tokens and ambiguous tickers are disjoint, upper-case', () => {
    for (const t of [...NEWS_LINK_CONFIG.stopTokens, ...NEWS_LINK_CONFIG.ambiguousTickers]) expect(t).toBe(t.toUpperCase());
    expect(NEWS_LINK_CONFIG.stopTokens.filter((t) => NEWS_LINK_CONFIG.ambiguousTickers.includes(t))).toEqual([]);
    expect(NEWS_LINK_CONFIG.maxSymbols).toBeLessThanOrEqual(50);
  });
});

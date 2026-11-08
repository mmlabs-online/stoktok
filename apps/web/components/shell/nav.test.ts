import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive } from './nav';

describe('nav', () => {
  it('has 4 Vietnamese items in order', () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ['Tài sản', '/'],
      ['Sổ giao dịch', '/transactions'],
      ['Danh sách theo dõi', '/watchlist'],
      ['Cài đặt', '/settings'],
    ]);
  });
  it('isNavActive', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/transactions', '/')).toBe(false);
    expect(isNavActive('/transactions/x', '/transactions')).toBe(true);
    for (const i of NAV_ITEMS) expect(isNavActive('/symbols/FPT', i.href)).toBe(false);
  });
});

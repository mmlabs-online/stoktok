import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isNavActive } from './nav';

describe('nav', () => {
  it('has 5 Vietnamese items in order', () => {
    expect(NAV_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ['Tổng quan', '/'],
      ['Sổ giao dịch', '/transactions'],
      ['Nhập sao kê', '/import'],
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

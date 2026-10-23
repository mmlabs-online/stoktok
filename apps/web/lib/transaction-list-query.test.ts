import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, listHref, pageMeta, parseTransactionListQuery } from './transaction-list-query';

describe('parseTransactionListQuery', () => {
  it('returns defaults for an empty query', () => {
    expect(parseTransactionListQuery({})).toEqual({ query: { page: 1 }, notices: [] });
  });
  it('whitelists side and normalises the symbol', () => {
    expect(parseTransactionListQuery({ side: 'sell', symbol: ' fpt ' }).query).toEqual({
      page: 1,
      side: 'sell',
      symbol: 'FPT',
    });
    expect(parseTransactionListQuery({ side: 'hold' }).query.side).toBeUndefined();
  });
  it('drops and reports an invalid symbol', () => {
    const r = parseTransactionListQuery({ symbol: '!!' });
    expect(r.query.symbol).toBeUndefined();
    expect(r.notices).toHaveLength(1);
  });
  it('drops invalid dates and swaps from > to', () => {
    expect(parseTransactionListQuery({ from: 'x', to: '2026-02-30' }).query).toEqual({ page: 1 });
    expect(parseTransactionListQuery({ from: '2026-06-30', to: '2026-01-01' }).query).toMatchObject({
      from: '2026-01-01',
      to: '2026-06-30',
    });
  });
  it('clamps the page to >= 1 and treats non-numeric as 1', () => {
    expect(parseTransactionListQuery({ page: '0' }).query.page).toBe(1);
    expect(parseTransactionListQuery({ page: '-3' }).query.page).toBe(1);
    expect(parseTransactionListQuery({ page: 'abc' }).query.page).toBe(1);
    expect(parseTransactionListQuery({ page: ['4', '5'] }).query.page).toBe(4);
  });
});

describe('pageMeta', () => {
  it('computes page count and neighbours', () => {
    expect(pageMeta(45, 3, 20)).toEqual({
      page: 3,
      pageCount: 3,
      offset: 40,
      prevPage: 2,
      nextPage: 3,
      hasPrev: true,
      hasNext: false,
    });
    expect(pageMeta(0, 1, 20)).toMatchObject({ pageCount: 1, hasPrev: false, hasNext: false });
    expect(PAGE_SIZE).toBe(20);
  });
});

describe('listHref', () => {
  it('keeps filters and overrides the page', () => {
    const q = { symbol: 'FPT', side: 'buy' as const, from: '2026-01-01', page: 2 };
    expect(listHref(q, { page: 3 })).toBe('/transactions?symbol=FPT&side=buy&from=2026-01-01&page=3');
    expect(listHref(q, { page: 1 })).toBe('/transactions?symbol=FPT&side=buy&from=2026-01-01');
    expect(listHref(q, { symbol: undefined, side: undefined, from: undefined, page: 1 })).toBe('/transactions');
  });
});

import { expect, it } from 'vitest';
import { describeCorporateAction } from './describe';

it('describes cash and stock dividends', () => {
  expect(
    describeCorporateAction({ type: 'cash_dividend', id: 'a', symbol: 'FPT', exDate: '2026-10-20', amountPerShare: 1000 }),
  ).toBe('Cổ tức tiền 1.000 ₫/cp');
  expect(
    describeCorporateAction({
      type: 'stock_dividend',
      id: 'a',
      symbol: 'FPT',
      exDate: '2026-10-20',
      ratio: { held: 100, received: 20 },
    }),
  ).toBe('Cổ tức cổ phiếu 100:20');
});

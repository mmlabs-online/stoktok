import type { Transaction } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { TransactionForm } from './transaction-form';
import { TransactionList } from './transaction-list';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const buy: Transaction = { id: 'a', seq: 1, tradeDate: '2026-10-12', symbol: 'FPT', side: 'buy', quantity: 100, price: 125400, fee: 1000, tax: 0 };
const sell: Transaction = { id: 'b', seq: 2, tradeDate: '2026-10-16', symbol: 'FPT', side: 'sell', quantity: 200, price: 130000 };

describe('TransactionList', () => {
  it('renders buy and sell badges, formatted price, estimate label, table and cards', () => {
    const out = html(<TransactionList rows={[buy, sell]} filtered={false} />);
    expect(out).toContain('Mua');
    expect(out).toContain('Bán');
    expect(out).toContain('125,40');
    expect(out).toContain('12/10/2026');
    expect(out).toContain('Ước tính');
    expect(out).toContain('hidden w-full text-sm md:table');
    expect(out).toContain('md:hidden');
    expect(out).toContain('/transactions/a/edit');
    expect(out).toContain('/transactions/b/delete');
  });
  it('shows the clear-filters link when empty and filtered', () => {
    const out = html(<TransactionList rows={[]} filtered />);
    expect(out).toContain('Xóa bộ lọc');
  });
});

describe('TransactionForm', () => {
  it('renders field error messages from the state', () => {
    const out = html(
      <TransactionForm
        action={async (s) => s}
        initial={{
          ok: false,
          fieldErrors: {
            price: { code: 'PRICE_LOW_UNCONFIRMED', message: 'Giá nhập bằng đồng' },
            quantity: { code: 'QTY_NOT_LOT', message: 'Khối lượng phải là bội số của 100' },
          },
          formError: { code: 'SAVE_FAILED', message: 'Không lưu được' },
          values: { tradeDate: '2026-10-20', symbol: 'FPT', side: 'buy', quantity: '150', price: '500', fee: '', tax: '', oddLot: false, confirmLowPrice: false },
        }}
        today="2026-10-23"
        feeRateConfigured={false}
        submitLabel="Lưu"
      />,
    );
    expect(out).toContain('Giá nhập bằng đồng');
    expect(out).toContain('Khối lượng phải là bội số của 100');
    expect(out).toContain('Không lưu được');
    expect(out).toContain('aria-describedby="quantity-error"');
    expect(out).toContain('Tôi xác nhận giá dưới 1.000 ₫');
    expect(out).toContain('Chưa cài đặt phí giao dịch');
    expect(out).toContain('max="2026-10-23"');
  });
  it('keeps the submitted side selected (controlled select)', () => {
    const out = html(
      <TransactionForm
        action={async (s) => s}
        initial={{
          ok: false,
          fieldErrors: {},
          values: { tradeDate: '2026-10-20', symbol: 'FPT', side: 'sell', quantity: '100', price: '125400', fee: '', tax: '', oddLot: false, confirmLowPrice: false },
        }}
        today="2026-10-23"
        feeRateConfigured
        submitLabel="Lưu"
      />,
    );
    expect(out).toMatch(/<option value="sell" selected="">/);
    expect(out).not.toMatch(/<option value="buy" selected="">/);
  });
});

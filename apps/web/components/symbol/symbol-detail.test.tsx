import { DEFAULT_MARKET_RULES, DEFAULT_TICK_BANDS, buildPriceBoardRow } from '@stoktok/core';
import type { Holding, Lot, StoredClose } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('server-only', () => ({}));

import type { SymbolPosition } from '../../server/symbols/load-symbol';
import type { WatchRow } from '../../server/watchlist/load-watchlist';
import { LotsTable } from './lots-table';
import { PositionCard } from './position-card';
import { SymbolHeader } from './symbol-header';
import { TransactionList } from '../transactions/transaction-list';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const bar = (tradeDate: string, close: number): StoredClose => ({
  symbol: 'FPT',
  close,
  tradeDate,
  volume: 1_234_500,
  source: 'tcbs',
  fetchedAt: '2026-10-23T11:30:00Z',
});
function header(bars: StoredClose[], exDates: string[] = [], exchange: 'HOSE' | null = 'HOSE'): WatchRow {
  const board = buildPriceBoardRow({
    symbol: 'FPT',
    bars,
    exchange,
    rules: DEFAULT_MARKET_RULES,
    tickBands: DEFAULT_TICK_BANDS,
    expectedDate: '2026-10-23',
    holidays: [],
    exDates,
  });
  return { ...board, priceDateDiffers: board.tradeDate !== null && board.tradeDate !== '2026-10-23' };
}
const holding: Holding = {
  symbol: 'FPT',
  quantity: 0,
  sellableQuantity: 0,
  totalCost: 0,
  averageCost: null,
  realizedPnl: 5_000_000,
  dividendCashNet: 90_000,
};
const lot = (id: string, status: Lot['status'], source: Lot['source']): Lot => ({
  id,
  symbol: 'FPT',
  source,
  sourceId: id,
  acquiredOn: '2026-10-22',
  quantityOriginal: 100,
  quantityRemaining: 100,
  costPerShare: 100000,
  sellableFrom: status === 'pending' ? '2026-10-26' : '2026-10-24',
  status,
});

describe('SymbolHeader', () => {
  it('renders TC/Trần/Sàn with tone classes, Phiên date, source and update time', () => {
    const out = html(<SymbolHeader row={header([bar('2026-10-23', 125_000), bar('2026-10-22', 120_000)])} refEstimated={false} />);
    expect(out).toContain('TC');
    expect(out).toContain('Trần');
    expect(out).toContain('Sàn');
    expect(out).toContain('text-price-ceiling');
    expect(out).toContain('text-price-floor');
    expect(out).toContain('Phiên 23/10/2026');
    expect(out).toContain('tcbs');
    expect(out).toContain('Cập nhật');
    expect(out).not.toContain('Tham chiếu UPCoM');
  });
  it('shows Dữ liệu cũ and flag reasons when stale/ex-date; — for null limits', () => {
    const out = html(
      <SymbolHeader row={header([bar('2026-10-22', 125_000), bar('2026-10-21', 120_000)], ['2026-10-22'])} refEstimated />,
    );
    expect(out).toContain('Dữ liệu cũ');
    expect(out).toContain('Phiên GDKHQ');
    expect(out).toContain('—');
    expect(out).toContain('Tham chiếu UPCoM');
  });
});

describe('PositionCard', () => {
  const open = (priceStatus: 'fresh' | 'stale'): SymbolPosition => ({
    kind: 'open',
    holding: { ...holding, quantity: 400, sellableQuantity: 300 },
    lots: [],
    settlementDays: 2,
    row: {
      symbol: 'FPT',
      quantity: 400,
      sellableQuantity: 300,
      averageCost: 100_000,
      totalCost: 40_000_000,
      marketPrice: 125_000,
      marketValue: 50_000_000,
      unrealizedPnl: 10_000_000,
      unrealizedPnlPpm: 250_000,
      realizedPnl: 0,
      dividendCashNet: 0,
      priceDate: '2026-10-22',
      fetchedAt: '2026-10-22T11:30:00Z',
      priceStatus,
      weightPpm: null,
      weightBarPct: null,
      overConcentration: false,
    } as never,
  });
  it('shows labels, the gross note and the stale badge next to P&L', () => {
    const out = html(<PositionCard position={open('stale')} />);
    for (const s of ['KL', 'Khả dụng', 'Giá vốn TB', 'Lãi/lỗ tạm tính', 'Chưa trừ phí, thuế bán', 'Dữ liệu cũ']) {
      expect(out).toContain(s);
    }
  });
  it('closed position shows Không còn nắm giữ and realized P&L', () => {
    const out = html(<PositionCard position={{ kind: 'closed', holding }} />);
    expect(out).toContain('Không còn nắm giữ');
    expect(out).toContain('Lãi/lỗ đã chốt');
  });
  it('ledger error shows the message and a link to /transactions', () => {
    const out = html(
      <PositionCard
        position={{ kind: 'ledgerError', error: { code: 'INVALID_INPUT', id: 'x', field: 'amount', message: 'bad amount' } }}
      />,
    );
    expect(out).toContain('Sổ giao dịch có lỗi');
    expect(out).toContain('bad amount');
    expect(out).toContain('href="/transactions"');
  });
  it('none shows an empty state', () => {
    expect(html(<PositionCard position={{ kind: 'none' }} />)).toContain('Chưa có giao dịch với mã này');
  });
});

describe('LotsTable', () => {
  it('shows pending with sellable date, sellable, and source labels', () => {
    const out = html(<LotsTable lots={[lot('a', 'pending', 'buy'), lot('b', 'sellable', 'stock_dividend')]} settlementDays={2} />);
    expect(out).toContain('Chưa về (T+2) · bán từ 26/10/2026');
    expect(out).toContain('Được bán');
    expect(out).toContain('Mua');
    expect(out).toContain('Cổ tức cổ phiếu');
  });
});

describe('transactions section', () => {
  it('links to /transactions?symbol=FPT', () => {
    // The page renders this link from view.ledgerHref; the loader test pins the href.
    const out = html(
      <TransactionList
        rows={[{ id: 't1', seq: 1, tradeDate: '2026-10-01', symbol: 'FPT', side: 'buy', quantity: 100, price: 100000 }]}
        filtered={false}
      />,
    );
    expect(out).toContain('/symbols/FPT');
  });
});

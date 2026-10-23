import { buildPortfolio } from '@stoktok/core';
import type { Holding, PriceQuote } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { HoldingsTable } from './holdings-table';
import { PortfolioSummary } from './portfolio-summary';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const EXPECTED = '2026-10-23';

const holding = (symbol: string, quantity: number, totalCost: number, extra: Partial<Holding> = {}): Holding => ({
  symbol,
  quantity,
  sellableQuantity: quantity,
  totalCost,
  averageCost: Math.round(totalCost / quantity),
  realizedPnl: 0,
  dividendCashNet: 0,
  ...extra,
});
const quote = (symbol: string, close: number, tradeDate = EXPECTED): PriceQuote => ({
  symbol,
  close,
  tradeDate,
  source: 'test',
  fetchedAt: '2026-10-23T11:30:00Z',
});

function portfolio(holdings: Holding[], quotes: PriceQuote[], threshold = 200_000) {
  return buildPortfolio({
    holdings,
    quotes: Object.fromEntries(quotes.map((q) => [q.symbol, q])),
    assets: [{ type: 'cash', value: 5_000_000 }],
    expectedPriceDate: EXPECTED,
    concentrationThresholdPpm: threshold,
  });
}

describe('HoldingsTable', () => {
  const p = portfolio(
    [holding('FPT', 100, 10_000_000, { sellableQuantity: 40 }), holding('VNM', 300, 18_000_000)],
    [quote('FPT', 125_400), quote('VNM', 60_000)],
  );

  it('holdings row renders all columns, as table and cards', () => {
    const out = html(<HoldingsTable portfolio={p} />);
    expect(out).toContain('FPT');
    expect(out).toContain('hidden w-full text-sm md:table');
    expect(out).toContain('md:hidden');
    expect(out).toContain('Khả dụng');
    expect(out).toContain('125,40'); // last close
    expect(out).toContain('giá 23/10/2026');
    expect(out).toContain('12.540.000 ₫'); // market value
    expect(out).toContain('+2.540.000 ₫');
    expect(out).toContain('+25,40%');
    expect(out).toContain('41,06%'); // weight 12.54M / 30.54M
  });
  it('over-threshold row shows warning text; banner lists symbols', () => {
    const out = html(<HoldingsTable portfolio={p} />);
    expect(out).toContain('Vượt ngưỡng 20,00%');
    expect(out).toContain('role="status"');
    expect(out).toContain('VNM, FPT');
  });
  it('weight bar inline width equals weightBarPct', () => {
    const out = html(<HoldingsTable portfolio={p} />);
    expect(out).toContain(`width:${p.rows[0]?.weightBarPct}%`);
  });
  it('stale row shows "Dữ liệu cũ" and its price date', () => {
    const s = portfolio([holding('FPT', 100, 10_000_000)], [quote('FPT', 125_400, '2026-10-20')]);
    const out = html(<HoldingsTable portfolio={s} />);
    expect(out).toContain('Dữ liệu cũ');
    expect(out).toContain('giá 20/10/2026');
  });
  it('missing-price row shows dashes and "Chưa có dữ liệu", never 0 ₫', () => {
    const m = portfolio([holding('FPT', 100, 10_000_000)], []);
    const out = html(<HoldingsTable portfolio={m} />);
    expect(out).toContain('Chưa có dữ liệu');
    expect(out).toContain('—');
    expect(out).not.toContain('0 ₫');
  });
});

describe('PortfolioSummary', () => {
  it('shows incomplete, stale and partial-weights notes and the fee banner', () => {
    const p = portfolio(
      [holding('FPT', 100, 10_000_000), holding('VNM', 100, 6_000_000), holding('NOP', 10, 1_000_000)],
      [quote('FPT', 125_400, '2026-10-20'), quote('VNM', 60_000)],
    );
    const out = html(<PortfolioSummary totals={p.totals} feeRateConfigured={false} />);
    expect(out).toContain('Chưa tính 1 mã chưa có giá');
    expect(out).toContain('Gồm 1 mã dùng giá cũ');
    expect(out).toContain('Tỷ trọng chỉ tính trên mã có giá');
    expect(out).toContain('Chưa cài tỷ lệ phí giao dịch');
    expect(out).toContain('Tổng tài sản');
  });
  it('no fee banner and no notes when everything is complete', () => {
    const p = portfolio([holding('FPT', 100, 10_000_000)], [quote('FPT', 125_400)]);
    const out = html(<PortfolioSummary totals={p.totals} feeRateConfigured />);
    expect(out).not.toContain('Chưa cài tỷ lệ phí');
    expect(out).not.toContain('Chưa tính');
  });
});

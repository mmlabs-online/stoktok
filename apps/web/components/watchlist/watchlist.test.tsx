import { DEFAULT_MARKET_RULES, DEFAULT_TICK_BANDS, buildPriceBoardRow } from '@stoktok/core';
import type { StoredClose } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('server-only', () => ({}));

import type { WatchRow } from '../../server/watchlist/load-watchlist';
import { AddSymbolForm } from './add-symbol-form';
import { PriceBoard } from './price-board';
import type { RowActions } from './price-board';
import { RemoveWatchButton } from './row-forms';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const EXPECTED = '2026-10-23';

const bar = (tradeDate: string, close: number): StoredClose => ({
  symbol: 'VNM',
  close,
  tradeDate,
  volume: 1_234_500,
  source: 'tcbs',
  fetchedAt: '2026-10-23T11:30:00Z',
});

function row(
  bars: StoredClose[],
  over: { exchange?: 'HOSE' | null; expectedDate?: string; exDates?: string[]; symbol?: string } = {},
): WatchRow {
  const expectedDate = over.expectedDate ?? EXPECTED;
  const board = buildPriceBoardRow({
    symbol: over.symbol ?? 'VNM',
    bars,
    exchange: over.exchange === undefined ? 'HOSE' : over.exchange,
    rules: DEFAULT_MARKET_RULES,
    tickBands: DEFAULT_TICK_BANDS,
    expectedDate,
    holidays: [],
    exDates: over.exDates ?? [],
  });
  return { ...board, priceDateDiffers: board.tradeDate !== null && board.tradeDate !== expectedDate };
}
const render = (rows: WatchRow[]) => html(<PriceBoard rows={rows} watched={[]} />);

describe('PriceBoard', () => {
  it('renders TC/Trần/Sàn/Giá/+/-/%/KL from a row', () => {
    const out = render([row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)])]);
    for (const t of ['TC', 'Trần', 'Sàn', '20,0', '21,4', '18,6', '20,5', '+0,5', '+2,50%', '1.234.500']) {
      expect(out).toContain(t);
    }
  });
  it('tones: ceiling, floor, ref, up, down', () => {
    const ceil = render([row([bar('2026-10-23', 21_400), bar('2026-10-22', 20_000)])]);
    expect(ceil).toContain('text-price-ceiling');
    expect(ceil).toContain('Trần');
    expect(ceil).toContain('giá trần');
    const floor = render([row([bar('2026-10-23', 18_600), bar('2026-10-22', 20_000)])]);
    expect(floor).toContain('text-price-floor');
    expect(floor).toContain('Sàn');
    expect(floor).toContain('giá sàn');
    expect(render([row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)])])).toContain('text-price-up');
    expect(render([row([bar('2026-10-23', 19_500), bar('2026-10-22', 20_000)])])).toContain('text-price-down');
    expect(render([row([bar('2026-10-23', 20_000), bar('2026-10-22', 20_000)])])).toContain('text-price-ref');
  });
  it('stale row shows "Dữ liệu cũ" and the trade date', () => {
    const out = render([row([bar('2026-10-22', 20_500), bar('2026-10-21', 20_000)])]);
    expect(out).toContain('Dữ liệu cũ');
    expect(out).toContain('giá 22/10/2026');
  });
  it('gapped and ex-date rows show their warnings', () => {
    expect(render([row([bar('2026-10-23', 20_500), bar('2026-10-21', 20_000)])])).toContain('Thiếu phiên trước');
    expect(render([row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)], { exDates: ['2026-10-23'] })])).toContain(
      'Phiên GDKHQ',
    );
  });
  it('shows update time and source per row', () => {
    const out = render([row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)])]);
    expect(out).toContain('Cập nhật 18:30 23/10/2026');
    expect(out).toContain('tcbs');
  });
  it('missing row shows "Chưa có dữ liệu" and dashes, no zeros', () => {
    const out = render([row([])]);
    expect(out).toContain('Chưa có dữ liệu');
    expect(out).toContain('—');
    expect(out).not.toMatch(/>0</);
  });
  it('unknown exchange shows "—" for Trần/Sàn and "Chưa rõ sàn"', () => {
    const out = render([row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)], { exchange: null })]);
    expect(out).toContain('Chưa rõ sàn');
    expect(out).not.toContain('text-price-ceiling');
    expect(out).toContain('+2,50%');
  });
});

describe('slice 3 forms', () => {
  const actions: RowActions = {
    remove: (r) => <RemoveWatchButton symbol={r.symbol} action={async () => ({ ok: true })} />,
  };
  const two = [
    row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)], { symbol: 'FPT' }),
    row([bar('2026-10-23', 20_500), bar('2026-10-22', 20_000)], { symbol: 'VNM' }),
  ];

  it('holding-only row has no remove control; watched rows do', () => {
    const out = html(<PriceBoard rows={two} watched={['VNM']} markWatched rowActions={actions} />);
    expect(out).not.toContain('Bỏ theo dõi FPT');
    expect(out).toContain('Bỏ theo dõi VNM');
    expect(out).toContain('Đang theo dõi');
  });
  it('watching rows have the remove control and no marker', () => {
    const out = html(<PriceBoard rows={two} watched={['FPT', 'VNM']} rowActions={actions} />);
    expect(out).toContain('Bỏ theo dõi FPT');
    expect(out).toContain('Bỏ theo dõi VNM');
    expect(out).not.toContain('Đang theo dõi');
  });
  it('board has no exchange column or exchange form', () => {
    const out = html(<PriceBoard rows={[two[0] as WatchRow]} watched={[]} rowActions={actions} />);
    expect(out).not.toContain('Sàn GD');
    expect(out).not.toContain('Sàn của FPT');
    expect(out).not.toContain('HOSE');
  });
  it('add form is rendered with the exchange options and keeps values on error', () => {
    const out = html(
      <AddSymbolForm
        action={async (s) => s}
        initial={{
          ok: false,
          fieldErrors: { exchange: { code: 'EXCHANGE_INVALID', message: 'Chọn sàn HOSE, HNX, UPCoM hoặc để trống.' } },
          values: { symbol: 'VNM', exchange: 'HSX' },
        }}
      />,
    );
    for (const t of ['Chưa rõ', 'HOSE', 'HNX', 'UPCoM', 'Thêm theo dõi', 'value="VNM"', 'Chọn sàn']) expect(out).toContain(t);
  });
});

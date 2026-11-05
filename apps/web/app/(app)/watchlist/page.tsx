import { formatQuantity } from '@stoktok/core';
import { PriceRefreshBar } from '../../../components/price-refresh-bar';
import { EmptyState } from '../../../components/empty-state';
import { AddSymbolForm } from '../../../components/watchlist/add-symbol-form';
import { PriceBoard } from '../../../components/watchlist/price-board';
import type { RowActions } from '../../../components/watchlist/price-board';
import { ExchangeForm, RemoveWatchButton } from '../../../components/watchlist/row-forms';
import { nowInstant } from '../../../server/clock';
import { getDb } from '../../../server/db';
import { loadWatchlist } from '../../../server/watchlist/load-watchlist';
import { refreshPricesAction } from '../prices/actions';
import { addWatchAction, removeWatchAction, setExchangeAction } from './actions';
import { requireUser } from '../../../server/auth/require-user';

const rowActions: RowActions = {
  exchange: (r) => (
    <ExchangeForm symbol={r.symbol} exchange={r.exchange} action={setExchangeAction.bind(null, r.symbol)} />
  ),
  remove: (r) => <RemoveWatchButton symbol={r.symbol} action={removeWatchAction.bind(null, r.symbol)} />,
};

// Reads the database per request; never prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireUser();
  const view = await loadWatchlist(getDb(), nowInstant());
  const { holdings, watching, alsoWatched } = view;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Danh sách theo dõi</h1>
          <p className="text-fg-muted text-sm">
            Giá đóng cửa phiên gần nhất, cập nhật sau mỗi lần đồng bộ cuối ngày.
          </p>
        </div>
        {(holdings.ok ? holdings.rows.length : 0) + watching.length > 0 && (
          <PriceRefreshBar view={view.refreshBar} action={refreshPricesAction} />
        )}
      </div>

      <section aria-label="Đang nắm giữ" className="space-y-3">
        <h2 className="text-lg font-semibold">
          Đang nắm giữ {holdings.ok ? `(${formatQuantity(holdings.rows.length)})` : ''}
        </h2>
        <p className="text-fg-muted text-sm">Tự động theo danh mục</p>
        {!holdings.ok ? (
          <EmptyState title="Sổ giao dịch có lỗi, không xác định được các mã đang nắm giữ" />
        ) : holdings.rows.length === 0 ? (
          <EmptyState title="Chưa có mã nào đang nắm giữ" />
        ) : (
          <PriceBoard rows={holdings.rows} watched={alsoWatched} markWatched rowActions={rowActions} />
        )}
      </section>

      <section aria-label="Đang theo dõi" className="space-y-3">
        <h2 className="text-lg font-semibold">Đang theo dõi ({formatQuantity(watching.length)})</h2>
        <AddSymbolForm action={addWatchAction} />
        {watching.length === 0 ? (
          <EmptyState title="Chưa theo dõi mã nào" />
        ) : (
          <PriceBoard rows={watching} watched={watching.map((r) => r.symbol)} rowActions={rowActions} />
        )}
      </section>
    </div>
  );
}

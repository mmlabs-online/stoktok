import type { ReactNode } from 'react';
import { EXCHANGE_LABELS, formatDate, formatQuantity } from '@stoktok/core';
import type { WatchRow } from '../../server/watchlist/load-watchlist';
import { PriceChange } from '../price-change';
import { Close, LimitValue, Status } from '../watchlist/price-board';

const DASH = '—';

export function SymbolHeader({
  row,
  refEstimated,
  refresh,
}: {
  row: WatchRow;
  refEstimated: boolean;
  refresh?: ReactNode;
}) {
  return (
    <section aria-label="Giá" className="bg-surface border-border space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">
            <span className="font-mono">{row.symbol}</span>{' '}
            <span className="text-fg-muted text-sm font-normal">
              {row.exchange === null ? 'Chưa rõ sàn' : EXCHANGE_LABELS[row.exchange]}
            </span>
          </h1>
          {row.tradeDate !== null && <span className="text-fg-muted text-sm">Phiên {formatDate(row.tradeDate)}</span>}
        </div>
        {refresh}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-3 text-2xl">
          <Close row={row} />
          {row.change !== null && row.changePctPpm !== null && row.tone !== null ? (
            <PriceChange change={row.change} changePct={row.changePctPpm} tone={row.tone} />
          ) : (
            <span className="num text-fg-muted">{DASH}</span>
          )}
        </span>
        <Status row={row} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <LimitValue value={row.ref} tone="ref" label="TC" />
        <LimitValue value={row.ceiling} tone="ceiling" label="Trần" />
        <LimitValue value={row.floor} tone="floor" label="Sàn" />
        <span className="text-fg-muted">KL {row.volume === null ? DASH : formatQuantity(row.volume)}</span>
      </div>
      {refEstimated && (
        <p className="text-fg-muted text-xs">Tham chiếu UPCoM: ước tính theo giá đóng cửa phiên trước</p>
      )}
    </section>
  );
}

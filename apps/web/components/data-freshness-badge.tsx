import { formatDateTime } from '@stoktok/core';
import { AlertTriangle } from 'lucide-react';

/** Presentational only: the caller decides freshness (R4). Never reads the clock. */
export function DataFreshnessBadge({
  fresh,
  updatedAt,
  hideWhenFresh,
}: {
  fresh: boolean | null;
  updatedAt?: string | null;
  hideWhenFresh?: boolean;
}) {
  if (fresh === false) {
    return (
      <span className="text-warn inline-flex items-center gap-1 text-xs font-semibold">
        <AlertTriangle aria-hidden className="size-4" />
        Dữ liệu cũ
      </span>
    );
  }
  if (fresh === null) {
    return <span className="text-fg-muted text-xs">Chưa có dữ liệu</span>;
  }
  if (hideWhenFresh || !updatedAt) return null;
  return <span className="text-fg-muted text-xs">Cập nhật {formatDateTime(updatedAt)}</span>;
}

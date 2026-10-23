import { formatDate } from '@stoktok/core';
import type { Lot } from '@stoktok/core';
import { CheckCircle2, Clock } from 'lucide-react';

export function LotStatusBadge({
  status,
  sellableFrom,
  settlementDays,
}: {
  status: Lot['status'];
  sellableFrom: string;
  settlementDays?: number;
}) {
  if (status === 'sellable') {
    return (
      <span className="text-price-up bg-price-up-bg inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
        <CheckCircle2 aria-hidden className="size-4" />
        Được bán
      </span>
    );
  }
  return (
    <span className="text-price-ref bg-price-ref-bg inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
      <Clock aria-hidden className="size-4" />
      Chưa về{settlementDays !== undefined ? ` (T+${settlementDays})` : ''} · bán từ{' '}
      {formatDate(sellableFrom)}
    </span>
  );
}

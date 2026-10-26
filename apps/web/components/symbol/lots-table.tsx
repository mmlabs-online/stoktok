import { formatDate, formatQuantity } from '@stoktok/core';
import type { Lot } from '@stoktok/core';
import { LotStatusBadge } from '../lot-status-badge';

const SOURCE_LABEL = { buy: 'Mua', stock_dividend: 'Cổ tức cổ phiếu' } as const;

export function LotsTable({ lots, settlementDays }: { lots: readonly Lot[]; settlementDays: number }) {
  return (
    <section aria-label="Lô cổ phiếu" className="space-y-3">
      <h2 className="text-lg font-semibold">Các lô đang nắm giữ</h2>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-border text-fg-muted border-b text-left">
            <th className="py-2">Ngày mua</th>
            <th>Nguồn</th>
            <th className="text-right">KL còn / gốc</th>
            <th>Bán được từ</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => (
            <tr key={l.id} className="border-border border-b">
              <td className="num py-2">{formatDate(l.acquiredOn)}</td>
              <td>{SOURCE_LABEL[l.source]}</td>
              <td className="num text-right">
                {formatQuantity(l.quantityRemaining)} / {formatQuantity(l.quantityOriginal)}
              </td>
              <td className="num">{formatDate(l.sellableFrom)}</td>
              <td>
                <LotStatusBadge status={l.status} sellableFrom={l.sellableFrom} settlementDays={settlementDays} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-3 md:hidden">
        {lots.map((l) => (
          <li key={l.id} className="bg-surface border-border space-y-2 rounded-lg border p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="num">{formatDate(l.acquiredOn)}</span>
              <span>{SOURCE_LABEL[l.source]}</span>
            </div>
            <p className="num">
              KL {formatQuantity(l.quantityRemaining)} / {formatQuantity(l.quantityOriginal)}
            </p>
            <LotStatusBadge status={l.status} sellableFrom={l.sellableFrom} settlementDays={settlementDays} />
          </li>
        ))}
      </ul>
    </section>
  );
}

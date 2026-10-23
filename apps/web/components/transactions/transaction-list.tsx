import { formatDate, formatPrice, formatQuantity } from '@stoktok/core';
import type { Transaction } from '@stoktok/core';
import Link from 'next/link';
import { EmptyState } from '../empty-state';
import { MoneyText } from '../money-text';
import { SymbolLink } from '../symbol-link';

const SIDE_LABEL = { buy: 'Mua', sell: 'Bán' } as const;
const SIDE_STYLE = {
  buy: 'bg-price-up-bg text-price-up',
  sell: 'bg-price-down-bg text-price-down',
} as const;

function SideBadge({ side }: { side: Transaction['side'] }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${SIDE_STYLE[side]}`}>{SIDE_LABEL[side]}</span>;
}

function Estimated({ vnd }: { vnd: number | undefined }) {
  return vnd === undefined ? <span className="text-fg-muted text-xs">Ước tính</span> : <MoneyText vnd={vnd} />;
}

function RowActions({ id }: { id: string }) {
  const link = 'inline-flex min-h-11 items-center px-2 underline';
  return (
    <span className="flex gap-1">
      <Link href={`/transactions/${id}/edit`} className={link}>
        Sửa
      </Link>
      <Link href={`/transactions/${id}/delete`} className={link}>
        Xóa
      </Link>
    </span>
  );
}

export function TransactionList({ rows, filtered }: { rows: Transaction[]; filtered: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Không có giao dịch"
        action={
          filtered ? (
            <Link href="/transactions" className="underline">
              Xóa bộ lọc
            </Link>
          ) : (
            <Link href="/transactions/new" className="underline">
              Thêm giao dịch
            </Link>
          )
        }
      />
    );
  }
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-border text-fg-muted border-b text-left">
            <th className="py-2">Ngày</th>
            <th>Mã</th>
            <th>Loại</th>
            <th className="text-right">KL</th>
            <th className="text-right">Giá (nghìn ₫)</th>
            <th className="text-right">Phí</th>
            <th className="text-right">Thuế</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((tx) => (
            <tr key={tx.id} className="border-border border-b">
              <td className="num py-2">{formatDate(tx.tradeDate)}</td>
              <td>
                <SymbolLink symbol={tx.symbol} />
              </td>
              <td>
                <SideBadge side={tx.side} />
              </td>
              <td className="num text-right">{formatQuantity(tx.quantity)}</td>
              <td className="num text-right">{formatPrice(tx.price)}</td>
              <td className="text-right">
                <Estimated vnd={tx.fee} />
              </td>
              <td className="text-right">
                <Estimated vnd={tx.tax} />
              </td>
              <td>
                <RowActions id={tx.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-3 md:hidden">
        {rows.map((tx) => (
          <li key={tx.id} className="bg-surface border-border space-y-1 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <SymbolLink symbol={tx.symbol} />
                <SideBadge side={tx.side} />
              </span>
              <span className="num text-fg-muted text-sm">{formatDate(tx.tradeDate)}</span>
            </div>
            <p className="num text-sm">
              {formatQuantity(tx.quantity)} cp × {formatPrice(tx.price)} nghìn ₫
            </p>
            <p className="text-sm">
              Phí: <Estimated vnd={tx.fee} /> · Thuế: <Estimated vnd={tx.tax} />
            </p>
            <RowActions id={tx.id} />
          </li>
        ))}
      </ul>
    </>
  );
}

import Link from 'next/link';
import { changeTone, formatPrice, formatQuantity } from '@stoktok/core';
import { EmptyState } from '../empty-state';
import { MoneyText } from '../money-text';
import { Pnl, Price } from '../portfolio/holdings-table';
import type { SymbolPosition } from '../../server/symbols/load-symbol';

export function PositionCard({ position }: { position: SymbolPosition }) {
  return (
    <section aria-label="Vị thế" className="bg-surface border-border space-y-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Vị thế</h2>
      <Body position={position} />
    </section>
  );
}

function Body({ position }: { position: SymbolPosition }) {
  if (position.kind === 'ledgerError') {
    const e = position.error;
    return (
      <div className="space-y-2 text-sm">
        <p className="text-warn font-semibold">Sổ giao dịch có lỗi, chưa tính được vị thế</p>
        <p className="text-fg-muted">
          {e.code === 'OVERSELL' ? `Bán vượt số lượng ${e.symbol} ngày ${e.date}` : e.message}
        </p>
        <Link href="/transactions" className="underline">
          Xem sổ giao dịch
        </Link>
      </div>
    );
  }
  if (position.kind === 'none') return <EmptyState title="Chưa có giao dịch với mã này" />;
  const h = position.holding;
  const dividend = (
    <>
      <dt>Cổ tức tiền (ròng)</dt>
      <dd className="text-fg text-right">
        <MoneyText vnd={h.dividendCashNet} signed />
      </dd>
    </>
  );
  const realized = (
    <>
      <dt>Lãi/lỗ đã chốt</dt>
      <dd className="text-fg text-right">
        <MoneyText vnd={h.realizedPnl} signed tone={changeTone(h.realizedPnl)} />
      </dd>
    </>
  );
  if (position.kind === 'closed') {
    return (
      <div className="space-y-2">
        <p className="font-semibold">Không còn nắm giữ</p>
        <dl className="text-fg-muted grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {realized}
          {dividend}
        </dl>
      </div>
    );
  }
  const r = position.row;
  return (
    <dl className="text-fg-muted grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <dt>KL</dt>
      <dd className="num text-fg text-right">{formatQuantity(r.quantity)}</dd>
      <dt>Khả dụng</dt>
      <dd className="num text-fg text-right">{formatQuantity(r.sellableQuantity)}</dd>
      <dt>Giá vốn TB</dt>
      <dd className="num text-fg text-right">{r.averageCost === null ? '—' : formatPrice(r.averageCost)}</dd>
      <dt>Giá</dt>
      <dd className="text-fg">
        <Price row={r} />
      </dd>
      <dt>Lãi/lỗ tạm tính</dt>
      <dd className="text-fg">
        <Pnl row={r} />
      </dd>
      <dd className="col-span-2 text-xs">Chưa trừ phí, thuế bán</dd>
      {realized}
      {dividend}
    </dl>
  );
}

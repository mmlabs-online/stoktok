import { describeCorporateAction, formatDate } from '@stoktok/core';
import type { CorporateAction } from '@stoktok/core';
import { SymbolLink } from '../symbol-link';

const TYPE_LABEL = { cash_dividend: 'Cổ tức tiền', stock_dividend: 'Cổ tức cổ phiếu' } as const;

export function CorporateActionList({ actions }: { actions: CorporateAction[] }) {
  if (actions.length === 0) return <p className="text-fg-muted text-sm">Chưa có sự kiện quyền.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border text-fg-muted border-b text-left">
            <th className="py-2">Ngày GDKHQ</th>
            <th>Mã</th>
            <th>Loại</th>
            <th>Mô tả</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id} className="border-border border-b">
              <td className="num py-2">{formatDate(a.exDate)}</td>
              <td>
                <SymbolLink symbol={a.symbol} />
              </td>
              <td>{TYPE_LABEL[a.type]}</td>
              <td>{describeCorporateAction(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

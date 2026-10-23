import Link from 'next/link';
import type { TransactionListQuery } from '../../lib/transaction-list-query';
import { inputClass, primaryButtonClass, secondaryLinkClass } from './form-fields';

export function TransactionFilters({ query }: { query: TransactionListQuery }) {
  return (
    <form method="get" action="/transactions" className="grid grid-cols-2 items-end gap-3 md:grid-cols-5">
      <label className="space-y-1 text-sm">
        <span className="block font-medium">Mã</span>
        <input name="symbol" defaultValue={query.symbol ?? ''} autoComplete="off" className={inputClass} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block font-medium">Loại</span>
        <select name="side" defaultValue={query.side ?? ''} className={inputClass}>
          <option value="">Tất cả</option>
          <option value="buy">Mua</option>
          <option value="sell">Bán</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="block font-medium">Từ ngày</span>
        <input type="date" name="from" defaultValue={query.from ?? ''} className={inputClass} />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block font-medium">Đến ngày</span>
        <input type="date" name="to" defaultValue={query.to ?? ''} className={inputClass} />
      </label>
      <div className="col-span-2 flex gap-2 md:col-span-1">
        <button type="submit" className={primaryButtonClass}>
          Lọc
        </button>
        <Link href="/transactions" className={secondaryLinkClass}>
          Xóa bộ lọc
        </Link>
      </div>
    </form>
  );
}

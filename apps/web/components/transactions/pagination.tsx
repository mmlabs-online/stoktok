import Link from 'next/link';
import { listHref, pageMeta } from '../../lib/transaction-list-query';
import type { TransactionListQuery } from '../../lib/transaction-list-query';

type Meta = ReturnType<typeof pageMeta>;

export function Pagination({ query, meta }: { query: TransactionListQuery; meta: Meta }) {
  const link = 'border-border inline-flex min-h-11 items-center rounded-lg border px-4';
  const off = `${link} text-fg-muted opacity-60`;
  return (
    <nav aria-label="Phân trang" className="flex items-center justify-between">
      {meta.hasPrev ? (
        <Link href={listHref(query, { page: meta.prevPage })} className={link}>
          Trước
        </Link>
      ) : (
        <span className={off}>Trước</span>
      )}
      <span className="num text-sm">
        Trang {meta.page}/{meta.pageCount}
      </span>
      {meta.hasNext ? (
        <Link href={listHref(query, { page: meta.nextPage })} className={link}>
          Sau
        </Link>
      ) : (
        <span className={off}>Sau</span>
      )}
    </nav>
  );
}

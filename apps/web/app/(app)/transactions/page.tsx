import Link from 'next/link';
import { CorporateActionList } from '../../../components/transactions/corporate-action-list';
import { EmptyState } from '../../../components/empty-state';
import { Pagination } from '../../../components/transactions/pagination';
import { TransactionFilters } from '../../../components/transactions/transaction-filters';
import { TransactionList } from '../../../components/transactions/transaction-list';
import { listHref, pageMeta, parseTransactionListQuery, PAGE_SIZE } from '../../../lib/transaction-list-query';
import { getDb, listCorporateActions, listTransactionsPage } from '../../../server/db';
import { requireUser } from '../../../server/auth/require-user';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { query, notices } = parseTransactionListQuery(await searchParams);
  const db = getDb();
  const { offset } = pageMeta(0, query.page, PAGE_SIZE);
  const [{ rows, total }, actions] = await Promise.all([
    listTransactionsPage(db, { ...query, limit: PAGE_SIZE, offset }),
    listCorporateActions(db),
  ]);
  const meta = pageMeta(total, query.page, PAGE_SIZE);
  const filtered = Boolean(query.symbol || query.side || query.from || query.to);
  const button = 'border-border inline-flex min-h-11 items-center rounded-lg border px-4 font-medium';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Sổ giao dịch</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/transactions/new" className={button}>
            Thêm giao dịch
          </Link>
          <Link href="/transactions/corporate-actions/new" className={button}>
            Thêm sự kiện quyền
          </Link>
        </div>
      </div>
      <TransactionFilters query={query} />
      {notices.map((n) => (
        <p key={n} className="text-warn text-sm">
          {n}
        </p>
      ))}
      {rows.length === 0 && total > 0 ? (
        <EmptyState
          title="Trang này không có dữ liệu"
          action={
            <Link href={listHref(query, { page: meta.pageCount })} className="underline">
              Về trang cuối
            </Link>
          }
        />
      ) : (
        <TransactionList rows={rows} filtered={filtered} />
      )}
      <Pagination query={query} meta={meta} />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sự kiện quyền</h2>
        <CorporateActionList actions={[...actions].reverse()} />
      </section>
    </div>
  );
}

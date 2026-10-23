import { formatDate, formatQuantity } from '@stoktok/core';
import { notFound } from 'next/navigation';
import { DeleteTransactionForm } from '../../../../../components/transactions/delete-transaction-form';
import { DataError, getDb, getTransaction } from '../../../../../server/db';
import { isUuid } from '../../../../../server/is-uuid';
import { deleteTransactionAction } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tx = await getTransaction(getDb(), id).catch((e: unknown) => {
    if (e instanceof DataError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Xóa giao dịch</h1>
      <p>
        Xóa giao dịch {tx.side === 'buy' ? 'Mua' : 'Bán'} {formatQuantity(tx.quantity)} {tx.symbol} ngày{' '}
        {formatDate(tx.tradeDate)}? Danh mục và lãi/lỗ sẽ được tính lại.
      </p>
      <DeleteTransactionForm action={deleteTransactionAction.bind(null, id)} />
    </div>
  );
}

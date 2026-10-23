import { DEFAULT_TRADING_RULES, transactionToFormValues } from '@stoktok/core';
import { notFound } from 'next/navigation';
import { TransactionForm } from '../../../../../components/transactions/transaction-form';
import { todayVn } from '../../../../../server/clock';
import { DataError, getDb, getEntrySettings, getTransaction } from '../../../../../server/db';
import { isUuid } from '../../../../../server/is-uuid';
import { updateTransactionAction } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const [tx, { feeRateConfigured }] = await Promise.all([
    getTransaction(db, id).catch((e: unknown) => {
      if (e instanceof DataError && e.code === 'NOT_FOUND') notFound();
      throw e;
    }),
    getEntrySettings(db),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sửa giao dịch</h1>
      <TransactionForm
        action={updateTransactionAction.bind(null, id)}
        initial={{ ok: false, fieldErrors: {}, values: transactionToFormValues(tx, DEFAULT_TRADING_RULES) }}
        today={todayVn()}
        feeRateConfigured={feeRateConfigured}
        submitLabel="Lưu thay đổi"
      />
    </div>
  );
}

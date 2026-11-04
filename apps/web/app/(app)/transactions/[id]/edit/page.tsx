import { transactionToFormValues } from '@stoktok/core';
import { notFound } from 'next/navigation';
import { TransactionForm } from '../../../../../components/transactions/transaction-form';
import { todayVn } from '../../../../../server/clock';
import { DataError, getDb, getEntrySettings, getMarketRules, getTransaction } from '../../../../../server/db';
import { isUuid } from '../../../../../server/is-uuid';
import { updateTransactionAction } from '../../actions';
import { requireUser } from '../../../../../server/auth/require-user';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const [tx, { feeRateConfigured }, rules] = await Promise.all([
    getTransaction(db, id).catch((e: unknown) => {
      if (e instanceof DataError && e.code === 'NOT_FOUND') notFound();
      throw e;
    }),
    getEntrySettings(db),
    getMarketRules(db),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sửa giao dịch</h1>
      <TransactionForm
        action={updateTransactionAction.bind(null, id)}
        initial={{ ok: false, fieldErrors: {}, values: transactionToFormValues(tx, rules) }}
        today={todayVn()}
        feeRateConfigured={feeRateConfigured}
        submitLabel="Lưu thay đổi"
      />
    </div>
  );
}

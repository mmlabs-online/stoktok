import { TransactionForm } from '../../../../components/transactions/transaction-form';
import { todayVn } from '../../../../server/clock';
import { getDb, getEntrySettings } from '../../../../server/db';
import { createTransactionAction } from '../actions';
import { requireUser } from '../../../../server/auth/require-user';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireUser();
  const today = todayVn();
  const { feeRateConfigured } = await getEntrySettings(getDb());
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Thêm giao dịch</h1>
      <TransactionForm
        action={createTransactionAction}
        initial={{
          ok: false,
          fieldErrors: {},
          values: {
            tradeDate: today,
            symbol: '',
            side: 'buy',
            quantity: '',
            price: '',
            fee: '',
            tax: '',
            oddLot: false,
            confirmLowPrice: false,
          },
        }}
        today={today}
        feeRateConfigured={feeRateConfigured}
        submitLabel="Lưu giao dịch"
      />
    </div>
  );
}

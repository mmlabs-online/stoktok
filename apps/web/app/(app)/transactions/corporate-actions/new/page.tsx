import { CorporateActionForm } from '../../../../../components/transactions/corporate-action-form';
import { createCorporateActionAction } from '../../actions';
import { requireUser } from '../../../../../server/auth/require-user';

export default async function Page() {
  await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Thêm sự kiện quyền</h1>
      <CorporateActionForm
        action={createCorporateActionAction}
        initial={{
          ok: false,
          fieldErrors: {},
          values: {
            type: 'cash_dividend',
            symbol: '',
            exDate: '',
            amountPerShare: '',
            payDate: '',
            held: '',
            received: '',
            listingDate: '',
          },
        }}
      />
    </div>
  );
}

import { CorporateActionForm } from '../../../../../components/transactions/corporate-action-form';
import { createCorporateActionAction } from '../../actions';

export default function Page() {
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

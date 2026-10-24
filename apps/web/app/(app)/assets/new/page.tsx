import { AssetForm } from '../../../../components/assets/asset-form';
import { todayVn } from '../../../../server/clock';
import { createAssetAction } from '../actions';

export const dynamic = 'force-dynamic';

export default function Page() {
  const today = todayVn();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Thêm tài sản</h1>
      <AssetForm
        action={createAssetAction}
        initial={{ ok: false, fieldErrors: {}, values: { type: 'cash', name: '', value: '', asOf: today } }}
        today={today}
        submitLabel="Lưu tài sản"
      />
    </div>
  );
}

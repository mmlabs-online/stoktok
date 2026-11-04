import { AssetForm } from '../../../../components/assets/asset-form';
import { todayVn } from '../../../../server/clock';
import { createAssetAction } from '../actions';
import { requireUser } from '../../../../server/auth/require-user';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireUser();
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

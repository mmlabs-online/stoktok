import { assetToFormValues } from '@stoktok/core';
import { notFound } from 'next/navigation';
import { AssetForm } from '../../../../../components/assets/asset-form';
import { todayVn } from '../../../../../server/clock';
import { DataError, getAsset, getDb } from '../../../../../server/db';
import { isUuid } from '../../../../../server/is-uuid';
import { updateAssetAction } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const asset = await getAsset(getDb(), id).catch((e: unknown) => {
    if (e instanceof DataError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sửa tài sản</h1>
      <AssetForm
        action={updateAssetAction.bind(null, id)}
        initial={{ ok: false, fieldErrors: {}, values: assetToFormValues(asset) }}
        today={todayVn()}
        submitLabel="Lưu thay đổi"
      />
    </div>
  );
}

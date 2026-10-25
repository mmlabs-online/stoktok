import { formatVnd } from '@stoktok/core';
import { notFound } from 'next/navigation';
import { DeleteAssetForm } from '../../../../../components/assets/delete-asset-form';
import { DataError, getAsset, getDb } from '../../../../../server/db';
import { isUuid } from '../../../../../server/is-uuid';
import { deleteAssetAction } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const asset = await getAsset(getDb(), id).catch((e: unknown) => {
    if (e instanceof DataError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Xóa tài sản</h1>
      <p>
        Xóa {asset.name} ({formatVnd(asset.value)})? Tổng tài sản sẽ được tính lại.
      </p>
      <DeleteAssetForm action={deleteAssetAction.bind(null, id)} />
    </div>
  );
}

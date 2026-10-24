import Link from 'next/link';
import { AssetList } from '../../../components/assets/asset-list';
import { getDb, listAssets } from '../../../server/db';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const assets = await listAssets(getDb());
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Tiền mặt &amp; tài sản khác</h1>
        <Link href="/assets/new" className="border-border inline-flex min-h-11 items-center rounded-lg border px-4 font-medium">
          Thêm tài sản
        </Link>
      </div>
      <AssetList assets={assets} />
    </div>
  );
}

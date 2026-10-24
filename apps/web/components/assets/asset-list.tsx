import { formatDate } from '@stoktok/core';
import type { Asset } from '../../server/db';
import Link from 'next/link';
import { EmptyState } from '../empty-state';
import { MoneyText } from '../money-text';

const TYPE_LABEL = { cash: 'Tiền mặt', other: 'Khác' } as const;

function TypeBadge({ type }: { type: Asset['type'] }) {
  return <span className="bg-surface border-border rounded border px-2 py-0.5 text-xs font-semibold">{TYPE_LABEL[type]}</span>;
}

function RowActions({ id }: { id: string }) {
  const link = 'inline-flex min-h-11 items-center px-2 underline';
  return (
    <span className="flex gap-1">
      <Link href={`/assets/${id}/edit`} className={link}>
        Sửa
      </Link>
      <Link href={`/assets/${id}/delete`} className={link}>
        Xóa
      </Link>
    </span>
  );
}

export function AssetList({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) {
    return (
      <EmptyState
        title="Chưa có tiền mặt hoặc tài sản khác"
        action={
          <Link href="/assets/new" className="underline">
            Thêm tài sản
          </Link>
        }
      />
    );
  }
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-border text-fg-muted border-b text-left">
            <th className="py-2">Tên</th>
            <th>Loại</th>
            <th className="text-right">Giá trị</th>
            <th className="text-right">Cập nhật</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} className="border-border border-b">
              <td className="py-2 break-words">{a.name}</td>
              <td>
                <TypeBadge type={a.type} />
              </td>
              <td className="text-right">
                <MoneyText vnd={a.value} />
              </td>
              <td className="num text-right">{formatDate(a.asOf)}</td>
              <td>
                <RowActions id={a.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-3 md:hidden">
        {assets.map((a) => (
          <li key={a.id} className="bg-surface border-border space-y-1 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold break-words">{a.name}</span>
              <TypeBadge type={a.type} />
            </div>
            <p className="text-sm">
              <MoneyText vnd={a.value} />
            </p>
            <p className="text-fg-muted text-sm">Cập nhật {formatDate(a.asOf)}</p>
            <RowActions id={a.id} />
          </li>
        ))}
      </ul>
    </>
  );
}

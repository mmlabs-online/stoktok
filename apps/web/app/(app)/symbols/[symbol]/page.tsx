import { normalizeSymbol } from '@stoktok/core';
import { notFound } from 'next/navigation';
import { EmptyState } from '../../../../components/empty-state';

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  let normalized: string | null;
  try {
    normalized = normalizeSymbol(decodeURIComponent(symbol));
  } catch {
    normalized = null;
  }
  if (!normalized) notFound();
  return (
    <div className="space-y-4">
      <p className="text-fg-muted text-sm">Chi tiết mã</p>
      <h1 className="font-mono text-xl font-semibold">{normalized}</h1>
      <EmptyState
        title="Chưa có nội dung"
        description="Màn hình này sẽ được xây dựng ở ticket sau."
      />
    </div>
  );
}

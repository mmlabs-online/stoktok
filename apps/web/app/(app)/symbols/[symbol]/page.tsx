import { formatQuantity, normalizeSymbol } from '@stoktok/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '../../../../components/empty-state';
import { LotsTable } from '../../../../components/symbol/lots-table';
import { PositionCard } from '../../../../components/symbol/position-card';
import { SymbolHeader } from '../../../../components/symbol/symbol-header';
import { TransactionList } from '../../../../components/transactions/transaction-list';
import { nowInstant } from '../../../../server/clock';
import { getDb } from '../../../../server/db';
import { loadSymbol } from '../../../../server/symbols/load-symbol';

// Reads the database per request; never prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  let normalized: string | null;
  try {
    normalized = normalizeSymbol(decodeURIComponent(symbol));
  } catch {
    normalized = null;
  }
  if (!normalized) notFound();
  const view = await loadSymbol(getDb(), normalized, nowInstant());
  if (!view) notFound();

  return (
    <div className="space-y-6">
      <SymbolHeader row={view.header} refEstimated={view.refEstimated} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <PositionCard position={view.position} />
          {view.position.kind === 'open' && (
            <LotsTable lots={view.position.lots} settlementDays={view.position.settlementDays} />
          )}
        </div>
        <section aria-label="Giao dịch" className="space-y-3">
          <h2 className="text-lg font-semibold">Giao dịch</h2>
          {view.transactions.length === 0 ? (
            <EmptyState title="Chưa có giao dịch" />
          ) : (
            <>
              <TransactionList rows={view.transactions} filtered={false} />
              <p className="text-fg-muted text-sm">
                Đang hiển thị {formatQuantity(view.transactions.length)}/{formatQuantity(view.transactionCount)} giao
                dịch gần nhất
              </p>
            </>
          )}
          <Link href={view.ledgerHref} className="inline-flex min-h-11 items-center underline">
            Xem sổ giao dịch
          </Link>
        </section>
      </div>
    </div>
  );
}

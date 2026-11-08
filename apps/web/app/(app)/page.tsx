import Link from 'next/link';
import { PriceRefreshBar } from '../../components/price-refresh-bar';
import { EmptyState } from '../../components/empty-state';
import { HoldingsTable } from '../../components/portfolio/holdings-table';
import { PortfolioSummary } from '../../components/portfolio/portfolio-summary';
import { loadDashboard } from '../../server/dashboard/load-dashboard';
import { nowInstant } from '../../server/clock';
import { formatVnd } from '@stoktok/core';
import { getDb } from '../../server/db';
import { requireUser } from '../../server/auth/require-user';
import { refreshPricesAction } from './prices/actions';

// Reads the database per request; never prerendered at build time.
export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireUser();
  const result = await loadDashboard(getDb(), nowInstant());

  if (result.kind === 'ledgerError') {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Tài sản</h1>
        <EmptyState
          title="Sổ giao dịch có lỗi, không tính được danh mục"
          action={
            <Link href="/transactions" className="underline">
              Xem sổ giao dịch
            </Link>
          }
        />
      </div>
    );
  }

  const { portfolio, hasTransactions, feeRateConfigured, refreshBar } = result;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-semibold">Tài sản</h1>
        {portfolio.rows.length > 0 && <PriceRefreshBar view={refreshBar} action={refreshPricesAction} />}
      </div>
      <PortfolioSummary totals={portfolio.totals} feeRateConfigured={feeRateConfigured} />
      {!hasTransactions ? (
        <EmptyState
          title="Chưa có giao dịch"
          description="Thêm giao dịch để xem danh mục và lãi/lỗ."
          action={
            <Link href="/transactions/new" className="underline">
              Thêm giao dịch đầu tiên
            </Link>
          }
        />
      ) : portfolio.rows.length === 0 ? (
        <EmptyState
          title="Không còn mã nào đang nắm giữ"
          description={`Lãi/lỗ đã chốt: ${formatVnd(portfolio.totals.realizedPnl, { signed: true })}`}
        />
      ) : (
        <HoldingsTable portfolio={portfolio} />
      )}
    </div>
  );
}

import { AlertTriangle } from 'lucide-react';
import { changeTone, formatDate, formatPercent, formatPrice, formatQuantity } from '@stoktok/core';
import type { Portfolio, PortfolioRow } from '@stoktok/core';
import { DataFreshnessBadge } from '../data-freshness-badge';
import { MoneyText } from '../money-text';
import { SymbolLink } from '../symbol-link';
import { TONE_STYLES } from '../tone';

const badgeFresh = (s: PortfolioRow['priceStatus']) => (s === 'fresh' ? true : s === 'stale' ? false : null);

export function Price({ row }: { row: PortfolioRow }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="num">{row.marketPrice === null ? '—' : formatPrice(row.marketPrice)}</span>
      {row.priceDate && <span className="text-fg-muted text-xs">giá {formatDate(row.priceDate)}</span>}
      <DataFreshnessBadge fresh={badgeFresh(row.priceStatus)} updatedAt={row.fetchedAt} hideWhenFresh />
    </span>
  );
}

export function Pnl({ row }: { row: PortfolioRow }) {
  if (row.unrealizedPnl === null) return <span className="flex flex-col items-end"><MoneyText vnd={null} /></span>;
  const tone = changeTone(row.unrealizedPnl);
  return (
    <span className="flex flex-col items-end">
      <span className={`num ${TONE_STYLES[tone].text}`}>
        <span aria-hidden>{TONE_STYLES[tone].glyph} </span>
        <MoneyText vnd={row.unrealizedPnl} signed />
        <span className="sr-only"> {TONE_STYLES[tone].srLabel}</span>
      </span>
      {row.unrealizedPnlPpm !== null && (
        <span className={`num text-xs ${TONE_STYLES[tone].text}`}>{formatPercent(row.unrealizedPnlPpm, { signed: true })}</span>
      )}
    </span>
  );
}

function Weight({ row, thresholdPpm }: { row: PortfolioRow; thresholdPpm: number }) {
  if (row.weightPpm === null) return <span className="flex flex-col items-end"><span className="num">—</span></span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="num">{formatPercent(row.weightPpm)}</span>
      <span className="bg-border block h-1 w-20 rounded">
        <span className="bg-accent block h-1 rounded" style={{ width: `${row.weightBarPct}%` }} />
      </span>
      {row.overConcentration && (
        <span className="text-warn inline-flex items-center gap-1 text-xs font-semibold">
          <AlertTriangle aria-hidden className="size-4" />
          Vượt ngưỡng {formatPercent(thresholdPpm)}
        </span>
      )}
    </span>
  );
}

export function HoldingsTable({ portfolio }: { portfolio: Portfolio }) {
  const { rows, totals } = portfolio;
  return (
    <section aria-label="Danh mục nắm giữ" className="space-y-3">
      {totals.overConcentrated.length > 0 && (
        <p role="status" className="text-warn flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          Tỷ trọng vượt ngưỡng {formatPercent(totals.thresholdPpm)}: {totals.overConcentrated.join(', ')}
        </p>
      )}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-border text-fg-muted border-b text-right">
            <th className="py-2 text-left">Mã</th>
            <th>KL</th>
            <th>Khả dụng</th>
            <th>Giá vốn TB</th>
            <th>Giá</th>
            <th>Giá trị</th>
            <th>Lãi/lỗ</th>
            <th>Tỷ trọng (danh mục CP)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-border border-b text-right align-top">
              <td className="py-2 text-left">
                <SymbolLink symbol={r.symbol} />
              </td>
              <td className="num">{formatQuantity(r.quantity)}</td>
              <td className="num">{formatQuantity(r.sellableQuantity)}</td>
              <td className="num">{r.averageCost === null ? '—' : formatPrice(r.averageCost)}</td>
              <td>
                <Price row={r} />
              </td>
              <td>
                <MoneyText vnd={r.marketValue} />
              </td>
              <td>
                <Pnl row={r} />
              </td>
              <td>
                <Weight row={r} thresholdPpm={totals.thresholdPpm} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={r.symbol} className="bg-surface border-border space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <SymbolLink symbol={r.symbol} />
              <MoneyText vnd={r.marketValue} />
            </div>
            <dl className="text-fg-muted grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt>KL</dt>
              <dd className="num text-fg text-right">{formatQuantity(r.quantity)}</dd>
              <dt>Khả dụng</dt>
              <dd className="num text-fg text-right">{formatQuantity(r.sellableQuantity)}</dd>
              <dt>Giá vốn TB</dt>
              <dd className="num text-fg text-right">{r.averageCost === null ? '—' : formatPrice(r.averageCost)}</dd>
              <dt>Giá</dt>
              <dd className="text-fg">
                <Price row={r} />
              </dd>
              <dt>Lãi/lỗ</dt>
              <dd className="text-fg">
                <Pnl row={r} />
              </dd>
              <dt>Tỷ trọng</dt>
              <dd className="text-fg">
                <Weight row={r} thresholdPpm={totals.thresholdPpm} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

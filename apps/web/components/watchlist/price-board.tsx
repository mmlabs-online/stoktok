import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  EXCHANGE_LABELS,
  formatDate,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatQuantity,
} from '@stoktok/core';
import type { PriceTone } from '@stoktok/core';
import type { WatchRow } from '../../server/watchlist/load-watchlist';
import { DataFreshnessBadge } from '../data-freshness-badge';
import { PriceChange } from '../price-change';
import { SymbolLink } from '../symbol-link';
import { TONE_STYLES } from '../tone';

export interface RowActions {
  /** Replaces the plain exchange text (an edit form). */
  exchange?: (row: WatchRow) => ReactNode;
  /** Rendered only for symbols that are in the watchlist table. */
  remove?: (row: WatchRow) => ReactNode;
}

interface BoardProps {
  rows: readonly WatchRow[];
  /** Symbols stored in the watchlist table (they get the remove control). */
  watched: readonly string[];
  /** Mark watched rows with "Đang theo dõi" (holdings group). */
  markWatched?: boolean;
  rowActions?: RowActions;
}

const badgeFresh = (s: WatchRow['status']) => (s === 'fresh' ? true : s === 'stale' ? false : null);
const DASH = '—';

function Warn({ children }: { children: ReactNode }) {
  return (
    <span className="text-warn inline-flex items-center gap-1 text-xs font-semibold">
      <AlertTriangle aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  );
}

/** A reference/ceiling/floor value: label + glyph + color, "—" when unknown. */
export function LimitValue({ value, tone, label }: { value: number | null; tone: 'ref' | 'ceiling' | 'floor'; label: string }) {
  const s = TONE_STYLES[tone];
  if (value === null) {
    return (
      <span className="text-fg-muted">
        <span className="text-xs">{label} </span>
        <span className="num">{DASH}</span>
      </span>
    );
  }
  return (
    <span className={s.text}>
      <span className="text-xs">{label} </span>
      <span aria-hidden>{s.glyph} </span>
      <span className="num">{formatPrice(value)}</span>
      <span className="sr-only"> {s.srLabel}</span>
    </span>
  );
}

export function Close({ row }: { row: WatchRow }) {
  if (row.close === null) return <span className="num text-fg-muted">{DASH}</span>;
  const tone: PriceTone | null = row.tone;
  const s = tone ? TONE_STYLES[tone] : null;
  const tinted = tone === 'ceiling' || tone === 'floor';
  return (
    <span className={`num inline-flex items-center gap-1 rounded px-1 font-semibold ${s ? s.text : ''} ${tinted && s ? s.bg : ''}`}>
      {formatPrice(row.close)}
      {s && 'tag' in s && <span className="text-xs">{s.tag}</span>}
      {s && <span className="sr-only">{s.srLabel}</span>}
    </span>
  );
}

function ChangeCells({ row }: { row: WatchRow }) {
  if (row.change === null || row.changePctPpm === null || row.tone === null) {
    return (
      <>
        <td className="num text-fg-muted">{DASH}</td>
        <td className="num text-fg-muted">{DASH}</td>
      </>
    );
  }
  const s = TONE_STYLES[row.tone];
  return (
    <>
      <td className={`num ${s.text}`}>
        <span aria-hidden>{s.glyph} </span>
        {formatPrice(row.change, { signed: true })}
      </td>
      <td className={`num ${s.text}`}>{formatPercent(row.changePctPpm, { signed: true })}</td>
    </>
  );
}

export function Status({ row }: { row: WatchRow }) {
  const f = row.flags;
  return (
    <span className="flex flex-col items-end gap-0.5 text-right">
      {row.fetchedAt !== null && row.source !== null && (
        <span className="text-fg-muted text-xs">
          Cập nhật {formatDateTime(row.fetchedAt)} · {row.source}
        </span>
      )}
      {row.tradeDate !== null && row.priceDateDiffers && (
        <span className="text-fg-muted text-xs">giá {formatDate(row.tradeDate)}</span>
      )}
      <DataFreshnessBadge fresh={badgeFresh(row.status)} hideWhenFresh />
      {row.status === 'missing' && (
        <span className="text-fg-muted text-xs">Giá sẽ có sau lần đồng bộ cuối ngày tiếp theo</span>
      )}
      {f.gapped && <Warn>Thiếu phiên trước, chưa tính tham chiếu</Warn>}
      {f.exDate && <Warn>Phiên GDKHQ: tham chiếu chưa xác định</Warn>}
      {f.noReference && <Warn>Chưa có phiên trước</Warn>}
      {f.refOffTick && <Warn>Giá tham chiếu lệch bước giá</Warn>}
      {f.exchangeUnknown && row.status !== 'missing' && <span className="text-fg-muted text-xs">Chưa rõ sàn</span>}
    </span>
  );
}

function ExchangeText({ row, actions }: { row: WatchRow; actions?: RowActions }) {
  if (actions?.exchange) return <>{actions.exchange(row)}</>;
  return <span>{row.exchange === null ? DASH : EXCHANGE_LABELS[row.exchange]}</span>;
}

function Symbol({ row, markWatched, canRemove, actions }: { row: WatchRow; markWatched: boolean; canRemove: boolean; actions?: RowActions }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <SymbolLink symbol={row.symbol} />
      {markWatched && canRemove && <span className="text-fg-muted text-xs">Đang theo dõi</span>}
      {canRemove && actions?.remove && actions.remove(row)}
    </span>
  );
}

export function PriceBoard({ rows, watched, markWatched = false, rowActions }: BoardProps) {
  const isWatched = (symbol: string) => watched.includes(symbol);
  return (
    <div>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-border text-fg-muted border-b text-right">
            <th className="py-2 text-left">Mã</th>
            <th className="text-left">Sàn GD</th>
            <th>TC</th>
            <th>Trần</th>
            <th>Sàn</th>
            <th>Giá</th>
            <th>+/-</th>
            <th>%</th>
            <th>KL</th>
            <th>Cập nhật</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-border border-b text-right align-top">
              <td className="py-2 text-left">
                <Symbol row={r} markWatched={markWatched} canRemove={isWatched(r.symbol)} actions={rowActions} />
              </td>
              <td className="text-left">
                <ExchangeText row={r} actions={rowActions} />
              </td>
              <td>
                <LimitValue value={r.ref} tone="ref" label="TC" />
              </td>
              <td>
                <LimitValue value={r.ceiling} tone="ceiling" label="Trần" />
              </td>
              <td>
                <LimitValue value={r.floor} tone="floor" label="Sàn" />
              </td>
              <td>
                <Close row={r} />
              </td>
              <ChangeCells row={r} />
              <td className="num">{r.volume === null ? DASH : formatQuantity(r.volume)}</td>
              <td>
                <Status row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={r.symbol} className="bg-surface border-border space-y-2 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-2">
              <Symbol row={r} markWatched={markWatched} canRemove={isWatched(r.symbol)} actions={rowActions} />
              <ExchangeText row={r} actions={rowActions} />
            </div>
            <div className="flex items-center justify-between">
              <Close row={r} />
              {r.change !== null && r.changePctPpm !== null && r.tone !== null ? (
                <PriceChange change={r.change} changePct={r.changePctPpm} tone={r.tone} />
              ) : (
                <span className="num text-fg-muted">{DASH}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <LimitValue value={r.ref} tone="ref" label="TC" />
              <LimitValue value={r.ceiling} tone="ceiling" label="Trần" />
              <LimitValue value={r.floor} tone="floor" label="Sàn" />
            </div>
            <div className="flex items-start justify-between gap-2 text-sm">
              <span className="text-fg-muted">KL {r.volume === null ? DASH : formatQuantity(r.volume)}</span>
              <Status row={r} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { CHART_GEOMETRY, CHART_RANGES, formatDate, formatDateTime, formatPrice, formatQuantity } from '@stoktok/core';
import type { ChartRange, ChartSeries } from '@stoktok/core';
import Link from 'next/link';
import { chartRangeHref } from '../../lib/chart-range-query';
import { chartRangeLabel, chartSummaryLabel, slotStatusText } from '../../lib/price-chart-text';
import { EmptyState } from '../empty-state';

const G = CHART_GEOMETRY;
const GLYPH = { bar: '●', gap_recorded: '▨', missing_unrecorded: '▭' } as const;

export function ChartRangeTabs({ symbol, range }: { symbol: string; range: ChartRange }) {
  return (
    <nav aria-label="Khoảng thời gian">
      <ul className="grid grid-cols-4">
        {CHART_RANGES.map((r) => (
          <li key={r}>
            <Link
              href={chartRangeHref(symbol, r)}
              aria-current={r === range ? 'page' : undefined}
              title={chartRangeLabel(r)}
              className={`flex min-h-11 items-center justify-center ${r === range ? 'font-bold underline' : 'text-fg-muted'}`}
            >
              {r}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Swatch({ kind }: { kind: 'line' | 'recorded' | 'unrecorded' }) {
  return (
    <svg width={16} height={12} aria-hidden="true" className="inline-block">
      {kind === 'line' && <line x1={0} y1={6} x2={16} y2={6} stroke="currentColor" strokeWidth={1.5} className="text-fg" />}
      {kind === 'recorded' && <rect width={16} height={12} fill="url(#gap-hatch)" />}
      {kind === 'unrecorded' && (
        <rect x={0.5} y={0.5} width={15} height={11} fill="none" stroke="currentColor" strokeDasharray="2 2" className="text-fg-muted" />
      )}
    </svg>
  );
}

export function PriceChart({ series, range, symbol }: { series: ChartSeries; range: ChartRange; symbol: string }) {
  const { stats, window } = series;
  return (
    <section aria-label="Biểu đồ giá" className="space-y-3">
      <ChartRangeTabs symbol={symbol} range={range} />
      {!series.hasData ? (
        <EmptyState
          title="Chưa có dữ liệu giá trong khoảng này"
          description={stats.recordedGapDays > 0 ? `(${stats.recordedGapDays} ngày thiếu dữ liệu đã ghi nhận)` : undefined}
        />
      ) : (
        <figure className="space-y-2">
          <svg viewBox={`0 0 ${G.width} ${G.height}`} role="img" aria-label={chartSummaryLabel(series, range)} className="h-auto w-full max-w-lg">
            <defs>
              <pattern id="gap-hatch" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={4} stroke="currentColor" strokeWidth={1} className="text-warn" />
              </pattern>
            </defs>
            {series.bands.map((b) =>
              b.kind === 'gap_recorded' ? (
                <rect key={`${b.kind}-${b.fromDate}`} x={b.x} y={G.priceTop} width={b.w} height={G.volumeTop + G.volumeHeight - G.priceTop} fill="url(#gap-hatch)" />
              ) : (
                <rect
                  key={`${b.kind}-${b.fromDate}`}
                  x={b.x}
                  y={G.priceTop}
                  width={b.w}
                  height={G.volumeTop + G.volumeHeight - G.priceTop}
                  fill="none"
                  stroke="currentColor"
                  strokeDasharray="2 2"
                  className="text-fg-muted"
                />
              ),
            )}
            {series.volumeBars.map((v) => (
              <rect key={v.date} x={v.x} y={v.y} width={v.w} height={v.h} fill="currentColor" shapeRendering="crispEdges" className="text-fg-muted" />
            ))}
            {series.segments.map((s) => (
              <path key={s.fromDate} d={s.d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-fg" />
            ))}
            {series.dots.map((d) => (
              <circle key={d.date} cx={d.x} cy={d.y} r={2} fill="currentColor" className="text-fg" />
            ))}
            {series.priceTicks.map((t) => (
              <text key={t.value} x={G.plotLeft - 4} y={t.y} fontSize={10} textAnchor="end" fill="currentColor" className="text-fg-muted">
                {formatPrice(t.value)}
              </text>
            ))}
            {series.xLabels.map((l) => (
              <text key={l.text} x={l.x} y={G.labelY} fontSize={10} textAnchor={l.anchor} fill="currentColor" className="text-fg-muted">
                {l.text}
              </text>
            ))}
          </svg>
          <ul className="text-fg-muted flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <li className="flex items-center gap-1"><Swatch kind="line" /> Giá đóng cửa</li>
            <li className="flex items-center gap-1"><Swatch kind="recorded" /> {slotStatusText('gap_recorded')}</li>
            <li className="flex items-center gap-1"><Swatch kind="unrecorded" /> {slotStatusText('missing_unrecorded')}</li>
          </ul>
          <figcaption className="text-fg-muted text-sm">
            Giá đóng cửa chưa điều chỉnh theo cổ tức/quyền · Nguồn: {stats.sources.join(', ')}
            {stats.latestFetchedAt && ` · Cập nhật ${formatDateTime(stats.latestFetchedAt)}`}
            {window.trimmed && ` · Dữ liệu từ ${formatDate(window.from)}`}
          </figcaption>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center">Xem dữ liệu dạng bảng</summary>
            <div role="region" tabIndex={0} aria-label="Bảng dữ liệu giá" className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <caption className="text-fg-muted text-left">Mới nhất ở trên</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">Ngày</th>
                    <th scope="col" className="text-right">Giá đóng cửa</th>
                    <th scope="col" className="text-right">Khối lượng</th>
                    <th scope="col" className="text-left">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series.slots].reverse().map((s) => (
                    <tr key={s.date}>
                      <th scope="row" className="text-left font-normal">{formatDate(s.date)}</th>
                      <td className="text-right">{s.bar ? formatPrice(s.bar.close) : '—'}</td>
                      <td className="text-right">{s.bar ? formatQuantity(s.bar.volume) : '—'}</td>
                      <td>{GLYPH[s.kind]} {slotStatusText(s.kind)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </figure>
      )}
    </section>
  );
}

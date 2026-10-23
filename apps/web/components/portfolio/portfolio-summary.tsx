import { changeTone, formatPercent, formatVnd } from '@stoktok/core';
import type { PortfolioTotals } from '@stoktok/core';
import { MoneyText } from '../money-text';
import { StatCard } from '../stat-card';
import { TONE_STYLES } from '../tone';

export function PortfolioSummary({
  totals,
  feeRateConfigured,
}: {
  totals: PortfolioTotals;
  feeRateConfigured: boolean;
}) {
  const tone = changeTone(totals.unrealizedPnl);
  const style = TONE_STYLES[tone];
  const realizedTone = changeTone(totals.realizedPnl);
  const noteClass = 'text-fg-muted text-sm';
  return (
    <section aria-label="Tổng quan danh mục" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">
          <StatCard label="Tổng tài sản" value={<MoneyText vnd={totals.netWorth} />} />
        </div>
        <StatCard label="Giá trị cổ phiếu" value={<MoneyText vnd={totals.holdingsMarketValue} />} />
        <StatCard
          label="Tiền mặt + tài sản khác"
          value={<MoneyText vnd={totals.nonStockAssets} />}
          sub={`Tiền mặt ${formatVnd(totals.cash)} · Khác ${formatVnd(totals.otherAssets)}`}
        />
        <StatCard
          label="Lãi/lỗ chưa chốt"
          value={
            <span className={`num ${style.text}`}>
              <span aria-hidden>{style.glyph} </span>
              {formatVnd(totals.unrealizedPnl, { signed: true })}
              <span className="sr-only"> {style.srLabel}</span>
            </span>
          }
          sub={totals.unrealizedPnlPpm === null ? undefined : formatPercent(totals.unrealizedPnlPpm, { signed: true })}
        />
        <StatCard
          label="Lãi/lỗ đã chốt"
          value={<MoneyText vnd={totals.realizedPnl} signed tone={realizedTone} />}
          sub={`Cổ tức nhận (ròng) ${formatVnd(totals.dividendCashNet)}`}
        />
      </div>
      {totals.missingCount > 0 && <p className={noteClass}>Chưa tính {totals.missingCount} mã chưa có giá</p>}
      {totals.staleCount > 0 && <p className="text-warn text-sm">Gồm {totals.staleCount} mã dùng giá cũ</p>}
      {!totals.complete && <p className={noteClass}>Tỷ trọng chỉ tính trên mã có giá</p>}
      <p className={noteClass}>Lãi/lỗ chưa chốt chưa trừ phí và thuế bán.</p>
      {!feeRateConfigured && (
        <p role="note" className="text-warn text-sm">
          Chưa cài tỷ lệ phí giao dịch — giao dịch không nhập phí được tính phí 0 ₫, giá vốn có thể thấp hơn thực tế.
        </p>
      )}
    </section>
  );
}

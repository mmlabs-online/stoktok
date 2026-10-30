import { formatDate, formatPrice } from '@stoktok/core';
import type { ChartRange, ChartSeries, SlotKind } from '@stoktok/core';

const RANGE_LABELS: Record<ChartRange, string> = { '1T': '1 tháng', '3T': '3 tháng', '6T': '6 tháng', '1N': '1 năm' };
const SLOT_STATUS: Record<SlotKind, string> = {
  bar: 'Có dữ liệu',
  gap_recorded: 'Thiếu dữ liệu (đã ghi nhận)',
  missing_unrecorded: 'Chưa có dữ liệu',
};

export function chartRangeLabel(range: ChartRange): string {
  return RANGE_LABELS[range];
}

export function slotStatusText(kind: SlotKind): string {
  return SLOT_STATUS[kind];
}

/** Accessible summary of the chart (aria-label). No percentage change on purpose. */
export function chartSummaryLabel(series: ChartSeries, range: ChartRange): string {
  const { stats } = series;
  if (!stats.first || !stats.last || stats.high === undefined || stats.low === undefined) {
    return `Biểu đồ giá đóng cửa ${RANGE_LABELS[range]}: chưa có dữ liệu`;
  }
  return (
    `Giá đóng cửa ${RANGE_LABELS[range]}, từ ${formatDate(stats.first.date)} đến ${formatDate(stats.last.date)}: ` +
    `đầu kỳ ${formatPrice(stats.first.close)}, cuối kỳ ${formatPrice(stats.last.close)}, ` +
    `cao nhất ${formatPrice(stats.high)}, thấp nhất ${formatPrice(stats.low)}. ` +
    `Thiếu ${stats.recordedGapDays} ngày đã ghi nhận, ${stats.unrecordedDays} ngày chưa có dữ liệu.`
  );
}

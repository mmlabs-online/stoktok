import { buildChartSeries } from '@stoktok/core';
import type { StoredClose } from '@stoktok/core';
import { describe, expect, it } from 'vitest';
import { chartRangeLabel, chartSummaryLabel, slotStatusText } from './price-chart-text';

const bar = (tradeDate: string, close: number): StoredClose => ({
  symbol: 'FPT',
  tradeDate,
  close,
  volume: 1,
  source: 'tcbs',
  fetchedAt: '2026-10-23T11:30:00Z',
});
const window = { from: '2026-10-19', to: '2026-10-23', trimmed: false };

describe('chartSummaryLabel', () => {
  it('lists period, first/last close, high/low and gap counts, without a percentage', () => {
    const series = buildChartSeries({
      bars: [bar('2026-10-19', 125_400), bar('2026-10-20', 140_000), bar('2026-10-23', 131_000)],
      openGaps: [],
      window,
      holidays: [],
    });
    const text = chartSummaryLabel(series, '1T');
    expect(text).toContain('1 tháng');
    expect(text).toContain('19/10/2026');
    expect(text).toContain('23/10/2026');
    expect(text).toContain('đầu kỳ 125,40');
    expect(text).toContain('cuối kỳ 131,00');
    expect(text).toContain('cao nhất 140,00');
    expect(text).toContain('thấp nhất 125,40');
    expect(text).toContain('Thiếu 0 ngày đã ghi nhận, 2 ngày chưa có dữ liệu');
    expect(text).not.toContain('%');
  });
  it('says there is no data for an empty series; status text covers 3 kinds', () => {
    const series = buildChartSeries({ bars: [], openGaps: [], window, holidays: [] });
    expect(chartSummaryLabel(series, '3T')).toContain('chưa có dữ liệu');
    expect(new Set((['bar', 'gap_recorded', 'missing_unrecorded'] as const).map(slotStatusText)).size).toBe(3);
    expect(chartRangeLabel('1N')).toBe('1 năm');
  });
});

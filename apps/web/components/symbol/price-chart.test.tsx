import { buildChartSeries, vnDayBoundsUtc } from '@stoktok/core';
import type { ChartRange, ChartSeries, StoredClose } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { PriceChart } from './price-chart';

const bar = (tradeDate: string, close = 125_400): StoredClose => ({
  symbol: 'FPT',
  tradeDate,
  close,
  volume: 1_234_500,
  source: 'tcbs',
  fetchedAt: '2026-10-23T11:30:00Z',
});
const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
const mk = (bars: StoredClose[], trimmed = false, openGaps: { id: number; fromTs: string; toTs: string }[] = []): ChartSeries =>
  buildChartSeries({ bars, openGaps, window: { from: '2026-10-19', to: '2026-10-23', trimmed }, holidays: [] });
const html = (series: ChartSeries, range: ChartRange = '3T') =>
  renderToStaticMarkup(<PriceChart series={series} range={range} symbol="FPT" />);
const b20 = vnDayBoundsUtc('2026-10-20');
const gapped = mk(
  days.filter((d) => d !== '2026-10-20' && d !== '2026-10-22').map((d) => bar(d)),
  false,
  [{ id: 1, fromTs: b20.fromTs, toTs: b20.toTs }],
);

describe('PriceChart', () => {
  it('svg has role=img and the summary label; legend and table sit outside the svg', () => {
    const out = html(gapped);
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Giá đóng cửa 3 tháng/);
    const svg = out.slice(out.indexOf('<svg'), out.indexOf('</svg>'));
    expect(svg).not.toContain('<table');
    expect(svg).not.toContain('Xem dữ liệu dạng bảng');
  });

  it('tabs are 4 links with ?range= and aria-current only on the active one', () => {
    const out = html(gapped, '6T');
    for (const r of ['1T', '3T', '6T', '1N']) expect(out).toContain(`href="/symbols/FPT?range=${r}"`);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/href="\/symbols\/FPT\?range=6T"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/symbols\/FPT\?range=6T"/);
  });

  it('table has one row per slot, newest first, with status text', () => {
    const out = html(gapped);
    expect(out.match(/<tr>/g)).toHaveLength(6);
    const body = out.slice(out.indexOf('<tbody'));
    expect(body.indexOf('23/10/2026')).toBeLessThan(body.indexOf('19/10/2026'));
    expect(out).toContain('Thiếu dữ liệu (đã ghi nhận)');
    expect(out).toContain('Chưa có dữ liệu');
    expect(out).toContain('Có dữ liệu');
  });

  it('legend shows both gap kinds; recorded uses the hatch, unrecorded a dashed outline', () => {
    const out = html(gapped);
    expect(out).toContain('fill="url(#gap-hatch)"');
    expect(out).toContain('stroke-dasharray="2 2"');
  });

  it('draws one path per segment, none spanning a missing slot', () => {
    const split = mk(days.filter((d) => d !== '2026-10-21').map((d) => bar(d)));
    expect(split.segments).toHaveLength(2);
    expect(html(split).match(/<path /g)).toHaveLength(2);
  });

  it('caption shows unadjusted note, source, fetched-at and the trimmed start date', () => {
    const out = html(mk(days.map((d) => bar(d)), true));
    expect(out).toContain('chưa điều chỉnh');
    expect(out).toContain('tcbs');
    expect(out).toContain('18:30 23/10/2026');
    expect(out).toContain('Dữ liệu từ 19/10/2026');
    expect(html(mk(days.map((d) => bar(d))))).not.toContain('Dữ liệu từ');
  });

  it('without data it renders the empty state and still the tabs', () => {
    const out = html(mk([]));
    expect(out).toContain('Chưa có dữ liệu giá trong khoảng này');
    expect(out).toContain('range=1N');
    expect(out).not.toContain('<svg');
  });
});

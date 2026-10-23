import { PRICE_TONES } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { DataFreshnessBadge } from './data-freshness-badge';
import { DISCLAIMER_TEXT, DisclaimerNote } from './disclaimer-note';
import { EmptyState } from './empty-state';
import { LotStatusBadge } from './lot-status-badge';
import { MoneyText } from './money-text';
import { PriceChange } from './price-change';
import { AppShell } from './shell/app-shell';
import { StatCard } from './stat-card';
import { SymbolLink, symbolHref } from './symbol-link';
import { TONE_STYLES } from './tone';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('PriceChange', () => {
  it('renders each of five tones', () => {
    for (const tone of PRICE_TONES) {
      const s: { text: string; glyph: string; srLabel: string } = TONE_STYLES[tone];
      const out = html(<PriceChange change={1200} tone={tone} />);
      expect(out).toContain(s.text);
      expect(out).toContain(s.glyph);
      expect(out).toContain(s.srLabel);
    }
  });
  it('formats change and percent, tags and omits percent', () => {
    const out = html(<PriceChange change={1200} changePct={9700} tone="up" />);
    expect(out).toContain('+1,20');
    expect(out).toContain('+0,97%');
    expect(html(<PriceChange change={1200} tone="ceiling" />)).toContain('Trần');
    expect(html(<PriceChange change={-1200} tone="floor" />)).toContain('Sàn');
    expect(html(<PriceChange change={1200} tone="up" />)).not.toContain('%');
  });
});

describe('MoneyText', () => {
  it('handles null and negatives', () => {
    expect(html(<MoneyText vnd={null} />)).toContain('—');
    expect(html(<MoneyText vnd={-1234567} symbol={false} />)).toContain('-1.234.567');
    expect(html(<MoneyText vnd={1} />)).toContain('num');
  });
});

describe('DataFreshnessBadge', () => {
  it('covers states', () => {
    expect(html(<DataFreshnessBadge fresh={false} />)).toContain('Dữ liệu cũ');
    expect(html(<DataFreshnessBadge fresh updatedAt="2026-10-23T02:05:00Z" />)).toContain(
      'Cập nhật 09:05 23/10/2026',
    );
    expect(html(<DataFreshnessBadge fresh hideWhenFresh />)).toBe('');
    expect(html(<DataFreshnessBadge fresh={null} />)).toContain('Chưa có dữ liệu');
  });
});

describe('LotStatusBadge', () => {
  it('covers states', () => {
    const p = html(<LotStatusBadge status="pending" sellableFrom="2026-10-27" />);
    expect(p).toContain('Chưa về');
    expect(p).toContain('27/10/2026');
    expect(p).not.toContain('T+');
    expect(
      html(<LotStatusBadge status="pending" sellableFrom="2026-10-27" settlementDays={2} />),
    ).toContain('(T+2)');
    expect(
      html(<LotStatusBadge status="pending" sellableFrom="2026-10-27" settlementDays={3} />),
    ).toContain('(T+3)');
    expect(html(<LotStatusBadge status="sellable" sellableFrom="2026-10-27" />)).toContain(
      'Được bán',
    );
  });
});

describe('SymbolLink', () => {
  it('builds href and renders', () => {
    expect(symbolHref(' fpt ')).toBe('/symbols/FPT');
    expect(symbolHref('bad/../x')).toBeNull();
    const out = html(<SymbolLink symbol="fpt" />);
    expect(out).toContain('href="/symbols/FPT"');
    expect(out).toContain('>FPT<');
    expect(html(<SymbolLink symbol="bad/../x" />)).not.toContain('<a');
  });
});

describe('StatCard / EmptyState / DisclaimerNote', () => {
  it('render their slots', () => {
    const s = html(<StatCard label="Giá trị" value={<b>1</b>} sub="ghi chú" />);
    expect(s).toContain('<dt');
    expect(s).toContain('<dd');
    expect(s).toContain('ghi chú');
    const e = html(<EmptyState title="T" description="D" action={<button>A</button>} />);
    expect(e).toContain('T');
    expect(e).toContain('D');
    expect(e).toContain('<button>A</button>');
    expect(html(<DisclaimerNote />)).toContain(DISCLAIMER_TEXT);
    expect(DISCLAIMER_TEXT).toBe(
      'Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư',
    );
  });
});

describe('AppShell', () => {
  it('renders sidebar, top bar, toggle, freshness indicator', () => {
    const out = html(
      <AppShell>
        <p>x</p>
      </AppShell>,
    );
    expect(out).toContain('<nav');
    expect(out).toContain('Stock Assistant');
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-label="Giao diện: Hệ thống"');
    expect(out).toContain(DISCLAIMER_TEXT);
    expect(out).toMatch(/aria-current="page"[^>]*>(?:<svg[^>]*>.*?<\/svg>)<span[^>]*>Tổng quan/);
  });
});

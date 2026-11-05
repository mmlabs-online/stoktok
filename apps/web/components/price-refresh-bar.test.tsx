import type { RefreshBarView } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { PriceRefreshBar, RefreshBarContent } from './price-refresh-bar';

const base: RefreshBarView = {
  state: 'live',
  sessionOpen: true,
  nextInMs: 0,
  intervalMs: 30_000,
  label: 'Cập nhật lúc 10:15:42',
  announcement: 'Giá đang được cập nhật',
  failedLabel: 'Không làm mới được · giá cũ lúc 10:15:42',
  failedAnnouncement: 'Không làm mới được giá',
  missingText: null,
  note: null,
};
const html = (view: RefreshBarView, failed = false, busy = false) =>
  renderToStaticMarkup(<RefreshBarContent view={view} failed={failed} busy={busy} onRefresh={() => {}} />);

describe('RefreshBarContent', () => {
  const states: [RefreshBarView['state'], string, boolean][] = [
    ['live', 'Cập nhật lúc 10:15:42', false],
    ['delayed', 'Giá đang trễ · cập nhật lúc 10:10:52', true],
    ['closed', 'Ngoài phiên giao dịch · cập nhật lúc 15:30:12', true],
    ['non_trading_day', 'Hôm nay không giao dịch · chưa có giá', true],
    ['no_data', 'Chưa có giá', false],
  ];
  it.each(states)('renders %s with exact text (and an icon when expected)', (state, label, hasIcon) => {
    const out = html({ ...base, state, label });
    expect(out).toContain(label);
    // the button always carries one svg; state icons add a second
    expect(out.match(/<svg/g)?.length).toBe(hasIcon ? 2 : 1);
  });

  it('failed shows failedLabel with warn style, an icon and its announcement', () => {
    const out = html(base, true);
    expect(out).toContain(base.failedLabel);
    expect(out).not.toContain(base.label);
    expect(out).toContain('text-warn');
    expect(out.match(/<svg/g)?.length).toBe(2);
    expect(out).toContain('>Không làm mới được giá</p>');
  });

  it('has exactly one polite status region holding the announcement, outside the time label', () => {
    const out = html(base);
    expect(out.match(/role="status"/g)?.length).toBe(1);
    expect(out).toContain('aria-live="polite"');
    expect(out).toMatch(/<p role="status"[^>]*>Giá đang được cập nhật<\/p>/);
    expect(out).not.toMatch(/role="status"[^>]*>[^<]*10:15:42/);
  });

  it('button is a 44px touch target', () => {
    const out = html(base);
    expect(out).toContain('type="button"');
    expect(out).toContain('min-h-11 min-w-11');
    expect(out).toContain('Làm mới');
  });

  it('busy keeps label and icon box, adds aria-busy and motion-safe spin', () => {
    const idle = html(base);
    const busy = html(base, false, true);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).toContain('Làm mới');
    expect(busy).toContain('motion-safe:animate-spin');
    expect(busy).not.toMatch(/(?<!motion-safe:)animate-spin/);
    expect(idle).not.toContain('animate-spin');
    expect(idle).toContain('aria-busy="false"');
  });

  it('renders the note and missing text when set', () => {
    const out = html({ ...base, note: 'Giá có thể trễ vài phút', missingText: '2 mã chưa có giá' });
    expect(out).toContain('Giá có thể trễ vài phút');
    expect(out).toContain('2 mã chưa có giá');
  });
});

describe('PriceRefreshBar', () => {
  it('renders the server-state label', () => {
    const out = renderToStaticMarkup(<PriceRefreshBar view={base} action={async () => ({ status: 'ok', nextInMs: 0, sessionOpen: true })} />);
    expect(out).toContain('Cập nhật lúc 10:15:42');
  });
});

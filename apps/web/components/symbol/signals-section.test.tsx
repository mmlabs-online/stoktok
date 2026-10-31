import { RULE_VERSION } from '@stoktok/core';
import type { SignalsSectionVM, StoredSignal } from '@stoktok/core';
import { DEFAULT_SIGNAL_RULES, presentMediumSignals } from '@stoktok/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER_TEXT } from '../disclaimer-note';
import { SignalsSection } from './signals-section';

const html = (vm: SignalsSectionVM) => renderToStaticMarkup(<SignalsSection vm={vm} />);
const ctx = {
  expectedDate: '2026-10-26',
  holidays: [],
  publishLagDays: 45,
  rules: DEFAULT_SIGNAL_RULES,
  priceGaps: [],
  financialsGaps: [],
};
const row = (ruleId: string, over: Partial<StoredSignal> = {}): StoredSignal => ({
  symbol: 'FPT',
  ruleId,
  signalDate: '2026-10-26',
  status: 'ok',
  label: 'bullish',
  value: 32_000,
  reasonCodes: [],
  inputs: { refs: [{ ref: 'prices_daily:FPT:2026-10-26', source: 'tcbs', fetchedAt: '2026-10-26T11:30:00.000Z' }] },
  ruleVersion: RULE_VERSION,
  computedAt: '2026-10-26T12:00:00.000Z',
  ...over,
});
const present = (rows: StoredSignal[], ruleIds = rows.map((r) => r.ruleId)) => presentMediumSignals({ ruleIds, rows, ctx });
const withoutDisclaimer = (s: string) => s.replace(DISCLAIMER_TEXT, '');

describe('SignalsSection', () => {
  it('ok row renders rule name, direction text, value, and an inputs <details> with "Nguồn:" and "Cập nhật"', () => {
    const out = html(present([row('price_vs_ma_50')]));
    expect(out).toContain('Giá so với MA50');
    expect(out).toContain('Tích cực');
    expect(out).toContain('Giá trên MA50 3,20%');
    expect(out).toContain('<details');
    expect(out).toContain('Nguồn: tcbs');
    expect(out).toContain('Cập nhật: 18:30 26/10/2026');
    expect(out).toContain('1 tín hiệu, 0 tạm ẩn');
  });
  it('hidden state shows "Tín hiệu gần nhất" and no direction/value text', () => {
    const out = html(present([row('price_vs_ma_50', { signalDate: '2026-10-23' })]));
    expect(out).toContain('Tín hiệu tạm ẩn do dữ liệu chưa cập nhật');
    expect(out).toContain('Tín hiệu gần nhất: 23/10/2026');
    expect(out).toContain('Tín hiệu chưa được tính lại cho phiên 26/10/2026');
    expect(out).not.toContain('Tích cực');
    expect(out).not.toContain('Giá trên MA50');
  });
  it('suppressed row lists each Vietnamese reason as <li>, never the raw code', () => {
    const out = html(
      present([
        row('price_vs_ma_50', { status: 'suppressed', label: null, value: null, reasonCodes: ['price_stale', 'price_jump_beyond_limit'] }),
        row('pe_vs_sector'),
      ]),
    );
    expect(out).toContain('<li class="flex items-start gap-2">');
    expect(out).toContain('Giá chưa cập nhật phiên gần nhất');
    expect(out).toContain('Có phiên biến động vượt biên độ sàn');
    expect(out).not.toContain('price_stale');
    expect(out).not.toContain('price_jump_beyond_limit');
  });
  it('empty state shows "Chưa có tín hiệu cho mã này"', () => {
    expect(html({ kind: 'empty' })).toContain('Chưa có tín hiệu cho mã này');
  });
  it('DISCLAIMER_TEXT present in empty, hidden and list states', () => {
    const states = [
      { kind: 'empty' } as SignalsSectionVM,
      present([row('price_vs_ma_50', { signalDate: '2026-10-23' })]),
      present([row('price_vs_ma_50')]),
    ];
    expect(states.map((s) => s.kind)).toEqual(['empty', 'hidden', 'list']);
    for (const vm of states) expect(html(vm)).toContain(DISCLAIMER_TEXT);
  });
  it('no action words in the rendered section (disclaimer excluded); no <table> inside the section', () => {
    const vms = [
      { kind: 'empty' } as SignalsSectionVM,
      present([row('price_vs_ma_50', { signalDate: '2026-10-23' })]),
      present(
        [
          row('price_vs_ma_50'),
          row('price_vs_ma_200', { label: 'bearish', value: -50_000 }),
          row('pe_vs_sector', { status: 'suppressed', label: null, value: null, reasonCodes: ['eps_basis_unverified', 'sector_missing'] }),
        ],
        ['pe_vs_sector', 'earnings_growth_trend', 'price_vs_ma_50', 'price_vs_ma_200'],
      ),
    ];
    for (const vm of vms) {
      const text = withoutDisclaimer(html(vm)).replace(/<[^>]+>/g, ' ').toLowerCase();
      const tokens = text.split(/[\s,.;:()/—–-]+/u);
      for (const banned of ['mua', 'bán', 'nên', 'buy', 'sell']) expect(tokens).not.toContain(banned);
      for (const phrase of ['khuyến nghị', 'cơ hội', 'chốt lời', 'cắt lỗ', 'nắm giữ']) expect(text).not.toContain(phrase);
      expect(html(vm)).not.toContain('<table');
    }
  });
});

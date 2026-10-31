import { describe, expect, it } from 'vitest';
import { DIRECTION_LABELS, REASON_LABELS, RULE_LABELS, VISIBILITY_LABELS, reasonLabel, ruleName } from './labels-vi';
import { REASON_ORDER, isReasonCode, parseMaRuleId } from './types';

describe('labels', () => {
  it('every REASON_ORDER code has a non-empty Vietnamese label without "_"', () => {
    for (const code of REASON_ORDER) {
      const text = reasonLabel(code);
      expect(text, code).not.toBe('');
      expect(text, code).not.toContain('_');
      expect(Object.keys(REASON_LABELS)).toContain(code);
    }
    expect(Object.keys(REASON_LABELS)).toHaveLength(REASON_ORDER.length);
  });
  it('reasonLabel: unknown code -> "Lý do khác (<code>)"; isReasonCode is false for it', () => {
    expect(reasonLabel('brand_new_code')).toBe('Lý do khác (brand_new_code)');
    expect(reasonLabel('constructor')).toBe('Lý do khác (constructor)');
    expect(isReasonCode('brand_new_code')).toBe(false);
    expect(isReasonCode('price_stale')).toBe(true);
  });
  it('every VisibilityCode and SignalLabel has a label', () => {
    for (const code of ['signal_outdated', 'price_gap_open', 'financials_gap_open', 'rule_version_outdated', 'snapshot_invalid'] as const) {
      expect(VISIBILITY_LABELS[code]).not.toBe('');
    }
    for (const label of ['bullish', 'bearish', 'neutral'] as const) expect(DIRECTION_LABELS[label]).not.toBe('');
  });
  it('ruleName: pe/pb/growth fixed labels; price_vs_ma_20 -> "Giá so với MA20"; unknown id -> the raw id', () => {
    expect(ruleName('pe_vs_sector')).toBe('P/E so với trung vị ngành');
    expect(ruleName('pb_vs_sector')).toBe('P/B so với trung vị ngành');
    expect(ruleName('earnings_growth_trend')).toBe('Xu hướng lợi nhuận so cùng kỳ');
    expect(ruleName('price_vs_ma_20')).toBe('Giá so với MA20');
    expect(ruleName('mystery')).toBe('mystery');
    expect(ruleName('constructor')).toBe('constructor');
  });
  it("parseMaRuleId: 'price_vs_ma_50' -> 50; 'price_vs_ma_x', 'price_vs_ma_', 'pe_vs_sector' and out-of-bounds -> null", () => {
    expect(parseMaRuleId('price_vs_ma_50')).toBe(50);
    for (const id of ['price_vs_ma_x', 'price_vs_ma_', 'pe_vs_sector', 'price_vs_ma_4', 'price_vs_ma_251', 'price_vs_ma_1000']) {
      expect(parseMaRuleId(id), id).toBeNull();
    }
  });
  it('no label contains an action word', () => {
    // No \b: JS word boundaries fail next to Vietnamese diacritics, so scan tokens instead.
    const bannedTokens = ['mua', 'bán', 'nên', 'buy', 'sell'];
    const bannedPhrases = ['khuyến nghị', 'cơ hội', 'vùng mua', 'chốt lời', 'cắt lỗ', 'nắm giữ'];
    const all = [
      ...Object.values(DIRECTION_LABELS),
      ...Object.values(REASON_LABELS),
      ...Object.values(VISIBILITY_LABELS),
      ...Object.values(RULE_LABELS),
      ruleName('price_vs_ma_50'),
    ];
    for (const label of all) {
      const lower = label.toLowerCase();
      const tokens = lower.split(/[\s,.;:()/—–-]+/u);
      for (const t of bannedTokens) expect(tokens, `${label} / ${t}`).not.toContain(t);
      for (const p of bannedPhrases) expect(lower, `${label} / ${p}`).not.toContain(p);
    }
  });
  it('the banned-word scan would catch a bad label', () => {
    const tokens = 'EPS không dương nên không tính P/E'.toLowerCase().split(/[\s,.;:()/—–-]+/u);
    expect(tokens).toContain('nên');
  });
});

import { describe, expect, it } from 'vitest';
import { vnDayBoundsUtc } from '../calendar';
import { DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS } from '../market/config';
import { DEFAULT_SIGNAL_RULES } from './config';
import { FETCHED, LATEST_PERIOD, SIGNAL_DATE } from './fixtures';
import { presentMediumSignals } from './present';
import type { SignalRowVM, SignalsSectionVM } from './present';
import { RULE_IDS, RULE_VERSION, maRuleId } from './types';
import type { GapRef, SnapshotRef, StoredSignal } from './types';
import type { VisibilityContext } from './visibility';

const ctx = (over: Partial<VisibilityContext> = {}): VisibilityContext => ({
  expectedDate: SIGNAL_DATE,
  holidays: [],
  publishLagDays: DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
  rules: DEFAULT_SIGNAL_RULES,
  priceGaps: [],
  financialsGaps: [],
  ...over,
});
const priceRef = (): SnapshotRef => ({ ref: `prices_daily:FPT:${SIGNAL_DATE}`, source: 'tcbs', fetchedAt: '2026-10-26T11:30:00.000Z' });
const finRef = (): SnapshotRef => ({ ref: `financials:FPT:${LATEST_PERIOD}`, source: 'vnd', fetchedAt: FETCHED });
const sig = (ruleId: string, inputs: unknown, over: Partial<StoredSignal> = {}): StoredSignal => ({
  symbol: 'FPT',
  ruleId,
  signalDate: SIGNAL_DATE,
  status: 'ok',
  label: 'bullish',
  value: 0,
  reasonCodes: [],
  inputs,
  ruleVersion: RULE_VERSION,
  computedAt: FETCHED,
  ...over,
});
const maWindow = {
  fromDate: '2026-08-17',
  toDate: SIGNAL_DATE,
  count: 50,
  sources: ['tcbs', 'vnd'],
  minFetchedAt: '2026-10-25T10:00:00.000Z',
  maxFetchedAt: '2026-10-26T11:30:00.000Z',
};
const ma = (value: number | null, over: Partial<StoredSignal> = {}, days = 50) =>
  sig(maRuleId(days), { refs: [priceRef()], window: maWindow }, { value, ...over });
const peRow = (value: number | null, over: Partial<StoredSignal> = {}) =>
  sig(RULE_IDS.peVsSector, { refs: [priceRef(), finRef(), { ref: 'symbols:FPT:sector', source: 'vnd', fetchedAt: FETCHED }], sector: 'Công nghệ', peerCount: 6, epsBasis: 'ttm' }, { value, ...over });
const growthRow = (value: number | null, over: Partial<StoredSignal> = {}) => sig(RULE_IDS.earningsGrowth, { refs: [finRef()] }, { value, ...over });

const list = (vm: SignalsSectionVM) => {
  if (vm.kind !== 'list') throw new Error(`expected list, got ${vm.kind}`);
  return vm.rows;
};
const only = (rows: StoredSignal[], c = ctx()) => list(presentMediumSignals({ ruleIds: rows.map((r) => r.ruleId), rows, ctx: c }))[0] as SignalRowVM;
const okRow = (r: SignalRowVM) => {
  if (r.state !== 'ok') throw new Error(`expected ok, got ${r.state}`);
  return r;
};
const gap = (id: number, from: string, to: string): GapRef => ({ id, symbol: 'FPT', fromTs: vnDayBoundsUtc(from).fromTs, toTs: vnDayBoundsUtc(to).toTs });

describe('presentMediumSignals ok rows', () => {
  it('direction, value text and one input per cited ref with source + fetched_at', () => {
    const r = okRow(only([peRow(-124_000)]));
    expect(r).toMatchObject({ ruleName: 'P/E so với trung vị ngành', signalDateText: '26/10/2026', directionText: 'Tích cực', directionGlyph: '▲' });
    expect(r.inputs).toEqual([
      { kindLabel: 'Giá đóng cửa', refText: 'phiên 26/10/2026', sourceText: 'Nguồn: tcbs', fetchedAtText: 'Cập nhật: 18:30 26/10/2026' },
      { kindLabel: 'Báo cáo tài chính', refText: 'Quý 2/2026', sourceText: 'Nguồn: vnd', fetchedAtText: 'Cập nhật: 17:00 25/10/2026' },
      { kindLabel: 'Ngành', refText: 'Công nghệ', sourceText: 'Nguồn: vnd', fetchedAtText: 'Cập nhật: 17:00 25/10/2026' },
    ]);
  });
  it('P/E value -124000 -> "thấp hơn"; positive -> "cao hơn"; 0 -> "bằng"', () => {
    expect(okRow(only([peRow(-124_000)])).valueText).toBe('P/E thấp hơn trung vị ngành 12,40% (6 mã cùng ngành)');
    expect(okRow(only([peRow(250_000)])).valueText).toBe('P/E cao hơn trung vị ngành 25,00% (6 mã cùng ngành)');
    expect(okRow(only([peRow(0)])).valueText).toBe('P/E bằng trung vị ngành 0,00% (6 mã cùng ngành)');
    const pb = sig(RULE_IDS.pbVsSector, { refs: [priceRef(), finRef()] }, { value: -10_000 });
    expect(okRow(only([pb])).valueText).toBe('P/B thấp hơn trung vị ngành 1,00%');
  });
  it('MA value +32000 on price_vs_ma_50 -> "Giá trên MA50 3,20%"; negative -> "dưới"; 0 -> "bằng"', () => {
    expect(okRow(only([ma(32_000)])).valueText).toBe('Giá trên MA50 3,20%');
    expect(okRow(only([ma(-32_000)])).valueText).toBe('Giá dưới MA50 3,20%');
    expect(okRow(only([ma(0)])).valueText).toBe('Giá bằng MA50 0,00%');
  });
  it('growth value 3 -> tăng 3 quý; -2 -> giảm 2; 0 -> flat; the sign comes from value, not the label', () => {
    expect(okRow(only([growthRow(3)])).valueText).toBe('Lợi nhuận tăng 3 quý liên tiếp (so cùng kỳ)');
    expect(okRow(only([growthRow(-2, { label: 'bullish' })])).valueText).toBe('Lợi nhuận giảm 2 quý liên tiếp (so cùng kỳ)');
    expect(okRow(only([growthRow(0, { label: 'neutral' })])).valueText).toBe('Lợi nhuận quý gần nhất đi ngang so cùng kỳ');
    expect(okRow(only([growthRow(1, { label: 'neutral' })])).directionText).toBe('Trung tính');
  });
  it('MA row adds a window summary line (count, from-to, sources, fetched range)', () => {
    const inputs = okRow(only([ma(1000)])).inputs;
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toEqual({
      kindLabel: 'Cửa sổ giá 50 phiên',
      refText: 'từ 17/08/2026 đến 26/10/2026',
      sourceText: 'Nguồn: tcbs, vnd',
      fetchedAtText: 'Cập nhật: 17:00 25/10/2026 – 18:30 26/10/2026',
    });
  });
  it('MA row with a null window.fromDate has no window line', () => {
    const row = sig(maRuleId(50), { refs: [priceRef()], window: { ...maWindow, fromDate: null, toDate: null, count: 0 } }, { value: 1 });
    expect(okRow(only([row])).inputs).toHaveLength(1);
  });
  it('gap ref -> "Từ … đến …" with no source line; corporate_actions ref -> "#id", source "Nhập tay (sổ giao dịch)"', () => {
    const g = gap(4, '2026-09-01', '2026-09-03');
    const row = sig(
      maRuleId(50),
      { refs: [priceRef(), { ref: 'data_gaps:4', fromTs: g.fromTs, toTs: g.toTs }, { ref: 'corporate_actions:abc' }] },
      { value: 1 },
    );
    const inputs = okRow(only([row])).inputs;
    expect(inputs[1]).toEqual({ kindLabel: 'Khoảng thiếu dữ liệu', refText: 'Từ 01/09/2026 đến 03/09/2026', sourceText: null, fetchedAtText: null });
    expect(inputs[2]).toEqual({ kindLabel: 'Sự kiện quyền', refText: '#abc', sourceText: 'Nguồn: Nhập tay (sổ giao dịch)', fetchedAtText: null });
  });
});

describe('presentMediumSignals other states', () => {
  it('suppressed row: no direction, no value, reasons in REASON_ORDER with kind data/rule, inputs kept', () => {
    const row = ma(null, { status: 'suppressed', label: null, reasonCodes: ['price_jump_beyond_limit', 'brand_new', 'price_stale'] });
    const r = only([row]);
    expect(r).toMatchObject({ state: 'suppressed', signalDateText: '26/10/2026' });
    if (r.state !== 'suppressed') return;
    expect(r.reasons).toEqual([
      { text: 'Giá chưa cập nhật phiên gần nhất', kind: 'data' },
      { text: 'Có phiên biến động vượt biên độ sàn — giá có thể chưa được điều chỉnh', kind: 'rule' },
      { text: 'Lý do khác (brand_new)', kind: 'rule' },
    ]);
    expect(r.inputs.length).toBeGreaterThan(0);
    expect('directionText' in r || 'valueText' in r).toBe(false);
  });
  it('hidden row: ruleName, lastSignalDateText, cause texts, and no direction/value/inputs keys', () => {
    const row = ma(1000, { signalDate: '2026-10-23' });
    const vm = presentMediumSignals({ ruleIds: [row.ruleId, 'pe_vs_sector'], rows: [row, peRow(1)], ctx: ctx() });
    const r = list(vm).find((x) => x.ruleId === row.ruleId) as SignalRowVM;
    expect(r).toEqual({
      state: 'hidden',
      ruleId: row.ruleId,
      ruleName: 'Giá so với MA50',
      lastSignalDateText: '23/10/2026',
      causes: ['Tín hiệu chưa được tính lại cho phiên 26/10/2026'],
    });
  });
  it('gap cause text carries the VN date range', () => {
    const vm = presentMediumSignals({ ruleIds: [maRuleId(50)], rows: [ma(1000)], ctx: ctx({ priceGaps: [gap(1, '2026-09-01', '2026-09-03')] }) });
    expect(vm).toMatchObject({ kind: 'hidden', causes: ['Đang có khoảng mất dữ liệu giá trong khoảng tính: từ 01/09/2026 đến 03/09/2026'] });
  });
  it("all rows hidden -> section kind 'hidden' with lastSignalDate and deduplicated cause texts", () => {
    const rows = [ma(1, { signalDate: '2026-10-23' }), peRow(1, { signalDate: '2026-10-22' })];
    const vm = presentMediumSignals({ ruleIds: [rows[1]!.ruleId, rows[0]!.ruleId], rows, ctx: ctx() });
    expect(vm).toEqual({ kind: 'hidden', lastSignalDateText: '23/10/2026', causes: ['Tín hiệu chưa được tính lại cho phiên 26/10/2026'] });
  });
  it("no rows -> kind 'empty'; an enabled rule without a row among others -> 'no_signal' row", () => {
    expect(presentMediumSignals({ ruleIds: ['pe_vs_sector'], rows: [], ctx: ctx() })).toEqual({ kind: 'empty' });
    const rows = list(presentMediumSignals({ ruleIds: ['pe_vs_sector', maRuleId(50)], rows: [ma(1)], ctx: ctx() }));
    expect(rows[1]).toEqual({ state: 'no_signal', ruleId: 'pe_vs_sector', ruleName: 'P/E so với trung vị ngành', text: 'Chưa có tín hiệu' });
  });
  it('rows of rules outside ruleIds are ignored', () => {
    expect(presentMediumSignals({ ruleIds: ['pe_vs_sector'], rows: [ma(1)], ctx: ctx() })).toEqual({ kind: 'empty' });
  });
  it('order: ok, then suppressed, then hidden, then no_signal; ruleIds order inside each group', () => {
    const rows = [
      peRow(1, { signalDate: '2026-10-23' }),
      sig(RULE_IDS.pbVsSector, { refs: [priceRef(), finRef()] }, { status: 'suppressed', label: null, value: null, reasonCodes: ['sector_missing'] }),
      ma(1, {}, 50),
      ma(1, {}, 200),
    ];
    const ruleIds = ['pe_vs_sector', 'pb_vs_sector', 'earnings_growth_trend', 'price_vs_ma_50', 'price_vs_ma_200'];
    const vm = presentMediumSignals({ ruleIds, rows, ctx: ctx() });
    expect(list(vm).map((r) => [r.state, r.ruleId])).toEqual([
      ['ok', 'price_vs_ma_50'],
      ['ok', 'price_vs_ma_200'],
      ['suppressed', 'pb_vs_sector'],
      ['hidden', 'pe_vs_sector'],
      ['no_signal', 'earnings_growth_trend'],
    ]);
  });
  it('summary "2 tín hiệu, 2 tạm ẩn" counts ok vs suppressed + hidden, and lastSignalDateText is the newest', () => {
    const rows = [
      ma(1, {}, 50),
      ma(1, {}, 200),
      peRow(1, { signalDate: '2026-10-23' }),
      sig(RULE_IDS.pbVsSector, { refs: [] }, { status: 'suppressed', label: null, value: null, reasonCodes: ['sector_missing'] }),
    ];
    const vm = presentMediumSignals({ ruleIds: ['pe_vs_sector', 'pb_vs_sector', 'price_vs_ma_50', 'price_vs_ma_200'], rows, ctx: ctx() });
    expect(vm).toMatchObject({ kind: 'list', summaryText: '2 tín hiệu, 2 tạm ẩn', lastSignalDateText: '26/10/2026' });
  });
  it('a malformed snapshot is shown as hidden with the unreadable-data text', () => {
    const row = sig(maRuleId(50), { refs: 'x' }, { value: 1 });
    const vm = presentMediumSignals({ ruleIds: [row.ruleId], rows: [row], ctx: ctx() });
    expect(vm).toEqual({ kind: 'hidden', lastSignalDateText: '26/10/2026', causes: ['Dữ liệu tín hiệu không đọc được'] });
  });
});

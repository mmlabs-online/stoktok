import { describe, expect, it } from 'vitest';
import { expectedPriceDate } from '../portfolio/freshness';
import { DEFAULT_PRICE_CUTOFF_MINUTES_VN } from '../portfolio/config';
import { DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS } from '../market/config';
import { quarterBounds } from '../market/quarters';
import { vnDayBoundsUtc } from '../calendar';
import { DEFAULT_SIGNAL_RULES } from './config';
import { FETCHED, LATEST_PERIOD, SIGNAL_DATE } from './fixtures';
import { RULE_IDS, RULE_VERSION, maRuleId } from './types';
import type { GapRef, SnapshotRef, StoredSignal } from './types';
import { expectedRuleIds, parseSignalSnapshot, signalVisibility } from './visibility';
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
const priceRef = (date = SIGNAL_DATE): SnapshotRef => ({ ref: `prices_daily:FPT:${date}`, source: 'tcbs', fetchedAt: FETCHED });
const finRef = (period: string): SnapshotRef => ({ ref: `financials:FPT:${period}`, source: 'tcbs', fetchedAt: FETCHED });
const sig = (ruleId: string, inputs: unknown, over: Partial<StoredSignal> = {}): StoredSignal => ({
  symbol: 'FPT',
  ruleId,
  signalDate: SIGNAL_DATE,
  status: 'ok',
  label: 'neutral',
  value: 0,
  reasonCodes: [],
  inputs,
  ruleVersion: RULE_VERSION,
  computedAt: FETCHED,
  ...over,
});
const ma = (days = 50, window: Record<string, unknown> | null = { fromDate: '2026-08-17', toDate: SIGNAL_DATE, count: days }, over: Partial<StoredSignal> = {}) =>
  sig(maRuleId(days), { refs: [priceRef()], ...(window ? { window } : {}) }, over);
const pe = (inputs: Record<string, unknown> = {}, over: Partial<StoredSignal> = {}) =>
  sig(RULE_IDS.peVsSector, { refs: [priceRef(), finRef(LATEST_PERIOD)], ...inputs }, over);
const pb = (over: Partial<StoredSignal> = {}, refs: SnapshotRef[] = [priceRef(), finRef(LATEST_PERIOD)]) => sig(RULE_IDS.pbVsSector, { refs }, over);
const growth = (inputs: Record<string, unknown> = {}, refs: SnapshotRef[] = [finRef(LATEST_PERIOD)]) =>
  sig(RULE_IDS.earningsGrowth, { refs, ...inputs });

const gap = (id: number, from: string, to: string, symbol: string | null = 'FPT'): GapRef => ({
  id,
  symbol,
  fromTs: vnDayBoundsUtc(from).fromTs,
  toTs: vnDayBoundsUtc(to).toTs,
});
const qGap = (id: number, period: string, symbol: string | null = 'FPT'): GapRef => ({ id, symbol, ...quarterBounds(period) });
const codes = (r: ReturnType<typeof signalVisibility>) => (r.state === 'hidden' ? r.causes.map((c) => c.code) : r.state);

describe('expectedRuleIds', () => {
  it('defaults -> pe, pb, growth, price_vs_ma_50, price_vs_ma_200 in that order', () => {
    expect(expectedRuleIds(DEFAULT_SIGNAL_RULES)).toEqual([
      'pe_vs_sector',
      'pb_vs_sector',
      'earnings_growth_trend',
      'price_vs_ma_50',
      'price_vs_ma_200',
    ]);
  });
  it('disabled valuation/growth/MA left out; MA 20/100 settings -> price_vs_ma_20/100', () => {
    const r = DEFAULT_SIGNAL_RULES;
    expect(
      expectedRuleIds({
        ...r,
        peVsSector: { ...r.peVsSector, enabled: false },
        pbVsSector: { ...r.pbVsSector, enabled: false },
        earningsGrowth: { ...r.earningsGrowth, enabled: false },
        priceVsMa: { ...r.priceVsMa, shortDays: 20, longDays: 100 },
      }),
    ).toEqual(['price_vs_ma_20', 'price_vs_ma_100']);
    expect(expectedRuleIds({ ...r, priceVsMa: { ...r.priceVsMa, enabled: false } })).toEqual([
      'pe_vs_sector',
      'pb_vs_sector',
      'earnings_growth_trend',
    ]);
  });
});

describe('signalVisibility staleness', () => {
  it('signal date equal to the expected date -> not outdated; one day before -> signal_outdated; after -> not outdated', () => {
    expect(signalVisibility(ma(), ctx()).state).toBe('ok');
    const old = signalVisibility(ma(50, undefined, { signalDate: '2026-10-23' }), ctx());
    expect(old).toEqual({ state: 'hidden', causes: [{ code: 'signal_outdated', expectedDate: SIGNAL_DATE }] });
    expect(signalVisibility(ma(50, undefined, { signalDate: '2026-10-27' }), ctx()).state).toBe('ok');
  });
  it('Monday before the cutoff expects the previous Friday (visible), after the cutoff Monday (hidden)', () => {
    const friday = ma(50, undefined, { signalDate: '2026-10-23' });
    const before = expectedPriceDate(new Date('2026-10-26T01:00:00Z'), [], DEFAULT_PRICE_CUTOFF_MINUTES_VN); // 08:00 VN
    const after = expectedPriceDate(new Date('2026-10-26T13:00:00Z'), [], DEFAULT_PRICE_CUTOFF_MINUTES_VN); // 20:00 VN
    expect([before, after]).toEqual(['2026-10-23', '2026-10-26']);
    expect(signalVisibility(friday, ctx({ expectedDate: before })).state).toBe('ok');
    expect(codes(signalVisibility(friday, ctx({ expectedDate: after })))).toEqual(['signal_outdated']);
  });
  it('holiday: expected date skips the holiday', () => {
    const expected = expectedPriceDate(new Date('2026-10-26T13:00:00Z'), ['2026-10-26'], DEFAULT_PRICE_CUTOFF_MINUTES_VN);
    expect(expected).toBe('2026-10-23');
    expect(signalVisibility(ma(50, undefined, { signalDate: '2026-10-23' }), ctx({ expectedDate: expected, holidays: ['2026-10-26'] })).state).toBe('ok');
  });
});

describe('signalVisibility price gaps', () => {
  it('MA row: open symbol price gap inside the window -> price_gap_open with gap ids and VN dates', () => {
    const r = signalVisibility(ma(), ctx({ priceGaps: [gap(7, '2026-09-01', '2026-09-03')] }));
    expect(r).toEqual({
      state: 'hidden',
      causes: [{ code: 'price_gap_open', gapIds: [7], fromDate: '2026-09-01', toDate: '2026-09-03' }],
    });
  });
  it('MA row: market-wide gap hides; a gap on another symbol is ignored', () => {
    expect(codes(signalVisibility(ma(), ctx({ priceGaps: [gap(1, '2026-09-01', '2026-09-01', null)] })))).toEqual(['price_gap_open']);
    expect(signalVisibility(ma(), ctx({ priceGaps: [gap(1, '2026-09-01', '2026-09-01', 'VNM')] })).state).toBe('ok');
  });
  it("MA row: gap touching only the window's first day hides; gap ending the day before fromDate stays visible", () => {
    expect(codes(signalVisibility(ma(), ctx({ priceGaps: [gap(1, '2026-08-14', '2026-08-17')] })))).toEqual(['price_gap_open']);
    expect(signalVisibility(ma(), ctx({ priceGaps: [gap(1, '2026-08-10', '2026-08-16')] })).state).toBe('ok');
  });
  it('MA row with window.fromDate null -> window from subtractTradingDays(signalDate, N-1)', () => {
    const noWindow = ma(5, null);
    // 5 trading days ending Monday 2026-10-26 start on Tuesday 2026-10-20
    expect(codes(signalVisibility(noWindow, ctx({ priceGaps: [gap(1, '2026-10-20', '2026-10-20')] })))).toEqual(['price_gap_open']);
    expect(signalVisibility(noWindow, ctx({ priceGaps: [gap(1, '2026-10-19', '2026-10-19')] })).state).toBe('ok');
    const nullFrom = ma(5, { fromDate: null, toDate: null, count: 0 });
    expect(codes(signalVisibility(nullFrom, ctx({ priceGaps: [gap(1, '2026-10-20', '2026-10-20')] })))).toEqual(['price_gap_open']);
  });
  it('P/E row: price gap on signalDate only -> hidden; the day before -> visible', () => {
    expect(codes(signalVisibility(pe(), ctx({ priceGaps: [gap(1, SIGNAL_DATE, SIGNAL_DATE)] })))).toEqual(['price_gap_open']);
    expect(signalVisibility(pe(), ctx({ priceGaps: [gap(1, '2026-10-23', '2026-10-25')] })).state).toBe('ok');
  });
});

describe('signalVisibility financials gaps', () => {
  it("P/E epsBasis 'ttm' -> 1-quarter window; 'quarterly'/'unverified'/missing -> 4 quarters ending at L", () => {
    const earlier = [qGap(1, '2025Q4')]; // L = 2026Q2, 4 quarters = 2025Q3..2026Q2, 1 quarter = 2026Q2
    expect(signalVisibility(pe({ epsBasis: 'ttm' }), ctx({ financialsGaps: earlier })).state).toBe('ok');
    for (const basis of ['quarterly', 'unverified', undefined]) {
      expect(codes(signalVisibility(pe({ epsBasis: basis }), ctx({ financialsGaps: earlier })))).toEqual(['financials_gap_open']);
    }
    expect(codes(signalVisibility(pe({ epsBasis: 'ttm' }), ctx({ financialsGaps: [qGap(2, LATEST_PERIOD)] })))).toEqual(['financials_gap_open']);
  });
  it('P/B: financials gap on L hides; gap on L-1 with no cited L-1 ref stays visible', () => {
    expect(codes(signalVisibility(pb(), ctx({ financialsGaps: [qGap(1, LATEST_PERIOD)] })))).toEqual(['financials_gap_open']);
    expect(signalVisibility(pb(), ctx({ financialsGaps: [qGap(1, '2026Q1')] })).state).toBe('ok');
  });
  it('growth with snapshot params.comparisons = 8 -> 12-quarter window; missing -> the current rules value (8 quarters)', () => {
    const g = qGap(1, '2023Q4'); // 12 quarters ending 2026Q2 start at 2023Q3
    expect(codes(signalVisibility(growth({ params: { comparisons: 8 } }), ctx({ financialsGaps: [g] })))).toEqual(['financials_gap_open']);
    expect(signalVisibility(growth(), ctx({ financialsGaps: [g] })).state).toBe('ok');
    expect(signalVisibility(growth({ params: { comparisons: 99 } }), ctx({ financialsGaps: [g] })).state).toBe('ok');
  });
  it('financials refs absent -> window derived from L only', () => {
    const noRefs = sig(RULE_IDS.pbVsSector, { refs: [priceRef()] });
    expect(codes(signalVisibility(noRefs, ctx({ financialsGaps: [qGap(1, LATEST_PERIOD)] })))).toEqual(['financials_gap_open']);
    expect(signalVisibility(noRefs, ctx({ financialsGaps: [qGap(1, '2026Q1')] })).state).toBe('ok');
  });
  it('a cited period older than L-(req-1) widens the window to that period', () => {
    const widened = pb({}, [priceRef(), finRef('2026Q1')]);
    expect(codes(signalVisibility(widened, ctx({ financialsGaps: [qGap(1, '2026Q1')] })))).toEqual(['financials_gap_open']);
  });
});

describe('signalVisibility other causes and states', () => {
  it('rule_version differs from RULE_VERSION -> rule_version_outdated', () => {
    expect(signalVisibility(ma(50, undefined, { ruleVersion: RULE_VERSION + 1 }), ctx())).toEqual({
      state: 'hidden',
      causes: [{ code: 'rule_version_outdated' }],
    });
  });
  it('malformed snapshot -> snapshot_invalid, never throws', () => {
    const bad: unknown[] = [
      null,
      'text',
      [],
      {},
      { refs: 'x' },
      { refs: [{}] },
      { refs: [{ ref: 5 }] },
      { refs: [{ ref: 'prices_daily:FPT:2026-10-26', source: 'tcbs', fetchedAt: 'not a date' }] },
      { refs: [{ ref: 'mystery:1' }] },
      { refs: [{ ref: 'data_gaps:1' }] },
    ];
    for (const inputs of bad) expect(codes(signalVisibility(ma(50, null, { inputs }), ctx({ priceGaps: [gap(1, '2026-10-01', '2026-10-02')] })))).toEqual(['snapshot_invalid']);
    expect(codes(signalVisibility(ma(50, undefined, { signalDate: 'garbage' }), ctx()))).toContain('snapshot_invalid');
  });
  it('prices_daily/financials/symbols ref without source or fetchedAt -> snapshot_invalid', () => {
    for (const ref of ['prices_daily:FPT:2026-10-26', 'financials:FPT:2026Q2', 'symbols:FPT:sector']) {
      expect(parseSignalSnapshot({ inputs: { refs: [{ ref, fetchedAt: FETCHED }] } }).ok).toBe(false);
      expect(parseSignalSnapshot({ inputs: { refs: [{ ref, source: 'tcbs' }] } }).ok).toBe(false);
      expect(parseSignalSnapshot({ inputs: { refs: [{ ref, source: '', fetchedAt: FETCHED }] } }).ok).toBe(false);
    }
  });
  it('gap and corporate action refs need no source', () => {
    const snap = parseSignalSnapshot({
      inputs: { refs: [{ ref: 'data_gaps:3', fromTs: FETCHED, toTs: FETCHED }, { ref: 'corporate_actions:abc' }] },
    });
    expect(snap.ok).toBe(true);
  });
  it('stale outranks suppressed: a suppressed row with signal_outdated is hidden', () => {
    const row = ma(50, undefined, { signalDate: '2026-10-23', status: 'suppressed', label: null, value: null, reasonCodes: ['price_stale'] });
    expect(codes(signalVisibility(row, ctx()))).toEqual(['signal_outdated']);
  });
  it('fresh suppressed row -> suppressed with its reasons; fresh ok row -> ok', () => {
    const row = ma(50, undefined, { status: 'suppressed', label: null, value: null, reasonCodes: ['price_stale', 'x'] });
    expect(signalVisibility(row, ctx())).toEqual({ state: 'suppressed', reasons: ['price_stale', 'x'] });
    expect(signalVisibility(ma(), ctx())).toEqual({ state: 'ok' });
  });
  it('several causes are all reported in fixed order', () => {
    const row = pe({}, { signalDate: '2026-10-23', ruleVersion: 9 });
    const r = signalVisibility(
      row,
      ctx({ priceGaps: [gap(1, '2026-10-23', '2026-10-23')], financialsGaps: [qGap(2, LATEST_PERIOD)] }),
    );
    expect(codes(r)).toEqual(['signal_outdated', 'price_gap_open', 'financials_gap_open', 'rule_version_outdated']);
  });
});

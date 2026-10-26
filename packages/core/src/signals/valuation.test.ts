import { describe, expect, test } from 'vitest';
import { DEFAULT_SIGNAL_RULES } from './config';
import type { SignalRules } from './config';
import { LATEST_PERIOD, SIGNAL_DATE, closes, ctx, quarters, symbolData } from './fixtures';
import { pbVsSector, peVsSector } from './valuation';
import type { SymbolData } from './types';

/** Peers P1..Pn each with P/E 10x (close 10,000 / eps 1000 per quarter -> ttm 4000 => 2.5x); use explicit numbers. */
function universe(subject: SymbolData, peers: number, peerOver: Parameters<typeof symbolData>[1] = {}): Record<string, SymbolData> {
  const u: Record<string, SymbolData> = { SUBJ: subject };
  for (let i = 1; i <= peers; i++) u[`P${i}`] = symbolData(`P${i}`, { close: 20_000, ...peerOver });
  return u;
}
// Peer P/E = 20,000 / (4 x 1000) = 5x = 5,000,000 ppm. Peer P/B = 20,000 / 10,000 = 2x.
const rules = (over: Partial<SignalRules['peVsSector']> = {}): SignalRules => ({
  ...DEFAULT_SIGNAL_RULES,
  peVsSector: { ...DEFAULT_SIGNAL_RULES.peVsSector, ...over },
  pbVsSector: { ...DEFAULT_SIGNAL_RULES.pbVsSector, ...over },
});

describe('peVsSector', () => {
  test('epsBasis unverified -> suppressed eps_basis_unverified (+ peers_insufficient), dataFresh true', () => {
    const u = universe(symbolData('SUBJ'), 5);
    const r = peVsSector('SUBJ', u, ctx({ epsBasisBySource: {} }));
    expect(r).toMatchObject({ status: 'suppressed', value: null, label: null, dataFresh: true });
    expect(r.reasons).toEqual(['eps_basis_unverified', 'peers_insufficient']);
  });
  test('(basis quarterly) premium <= -discount bullish; >= premium bearish; between neutral; boundaries inclusive', () => {
    // peer median 5,000,000 ppm; discount/premium 20% => 4,000,000 / 6,000,000.
    const at = (close: number) => peVsSector('SUBJ', universe(symbolData('SUBJ', { close }), 5), ctx());
    expect(at(16_000)).toMatchObject({ status: 'ok', label: 'bullish', value: -200_000 });
    expect(at(24_000)).toMatchObject({ status: 'ok', label: 'bearish', value: 200_000 });
    expect(at(20_000)).toMatchObject({ label: 'neutral', value: 0 });
    expect(at(16_040)).toMatchObject({ label: 'neutral' });
    expect(at(24_040)).toMatchObject({ label: 'bearish' });
    expect(at(23_960)).toMatchObject({ label: 'neutral' });
    expect(at(16_000).inputs).toMatchObject({ classification: 'cheap', peerCount: 5, medianPpm: 5_000_000, epsBasis: 'quarterly' });
  });
  test('TTM EPS 0 or negative -> eps_non_positive; negative TTM with one positive quarter too', () => {
    const zero = symbolData('SUBJ', { eps: 0 });
    expect(peVsSector('SUBJ', universe(zero, 5), ctx()).reasons).toEqual(['eps_non_positive']);
    const mixed: SymbolData = { ...symbolData('SUBJ'), financials: quarters('SUBJ', LATEST_PERIOD, 4, (i) => ({ eps: i === 0 ? 500 : -400 })) };
    const r = peVsSector('SUBJ', universe(mixed, 5), ctx());
    expect(r.reasons).toEqual(['eps_non_positive']);
    expect(r.dataFresh).toBe(true);
  });
  test('BVPS <= 0 -> bvps_non_positive', () => {
    const r = pbVsSector('SUBJ', universe(symbolData('SUBJ', { bvps: -5 }), 5), ctx());
    expect(r.reasons).toEqual(['bvps_non_positive']);
  });
  test('exactly minPeers valid peers -> ok; minPeers-1 -> peers_insufficient with peerCount and excluded list', () => {
    expect(peVsSector('SUBJ', universe(symbolData('SUBJ'), 5), ctx()).status).toBe('ok');
    const u = universe(symbolData('SUBJ'), 4);
    u.BAD = symbolData('BAD', { eps: -1 });
    const r = peVsSector('SUBJ', u, ctx());
    expect(r.reasons).toEqual(['peers_insufficient']);
    expect(r.inputs).toMatchObject({ peerCount: 4, excluded: [{ symbol: 'BAD', reasons: ['eps_non_positive'] }] });
    expect(peVsSector('SUBJ', universe(symbolData('SUBJ'), 3), ctx({ rules: rules({ minPeers: 3 }) })).status).toBe('ok');
  });
  test('stale peer, loss-making peer, peer without basis excluded with reasons; subject not in its own median', () => {
    const u = universe(symbolData('SUBJ', { close: 1_000_000 }), 5);
    u.STALE = { ...symbolData('STALE'), closes: closes('STALE', '2026-10-23', 3) };
    u.LOSS = symbolData('LOSS', { eps: -10 });
    u.NOBASIS = { ...symbolData('NOBASIS'), financials: quarters('NOBASIS', LATEST_PERIOD, 4).map((f) => ({ ...f, source: 'unknown' })) };
    const r = peVsSector('SUBJ', u, ctx());
    const excluded = (r.inputs.excluded as { symbol: string; reasons: string[] }[]).map((e) => [e.symbol, e.reasons]);
    expect(excluded).toEqual([
      ['LOSS', ['eps_non_positive']],
      ['NOBASIS', ['eps_basis_unverified']],
      ['STALE', ['price_stale']],
    ]);
    expect(r.inputs.medianPpm).toBe(5_000_000);
    expect(r.label).toBe('bearish');
  });
  test('all peers loss-making -> peers_insufficient', () => {
    expect(peVsSector('SUBJ', universe(symbolData('SUBJ'), 6, { eps: -1 }), ctx()).reasons).toEqual(['peers_insufficient']);
  });
  test('sector null -> sector_missing; different sector label -> not a peer', () => {
    const r = peVsSector('SUBJ', universe(symbolData('SUBJ', { sector: null }), 5), ctx());
    expect(r.reasons).toEqual(['sector_missing']);
    expect(r.dataFresh).toBe(false);
    const u = universe(symbolData('SUBJ'), 5);
    u.P5 = symbolData('P5', { sector: 'Steel' });
    expect(peVsSector('SUBJ', u, ctx()).reasons).toEqual(['peers_insufficient']);
  });
  test('stale price and stale financials both reported in REASON_ORDER', () => {
    const stale: SymbolData = { ...symbolData('SUBJ'), closes: closes('SUBJ', '2026-10-23', 3), financials: quarters('SUBJ', '2026Q1', 4) };
    const r = peVsSector('SUBJ', universe(stale, 5), ctx());
    expect(r.reasons).toEqual(['price_stale', 'financials_stale']);
    expect(r.dataFresh).toBe(false);
  });
  test('missing price window date is not needed for valuation; no financials -> financials_missing', () => {
    const none: SymbolData = { ...symbolData('SUBJ'), financials: [] };
    expect(peVsSector('SUBJ', universe(none, 5), ctx()).reasons).toEqual(['financials_missing']);
  });
});

describe('pbVsSector', () => {
  test('uses latest quarter bvps and does not depend on EPS basis', () => {
    const subj = symbolData('SUBJ', { close: 30_000 });
    const r = pbVsSector('SUBJ', universe(subj, 5), ctx({ epsBasisBySource: {} }));
    // subject P/B 3x, peers 2x -> +50%.
    expect(r).toMatchObject({ status: 'ok', label: 'bearish', value: 500_000, ruleId: 'pb_vs_sector' });
    expect(r.inputs).not.toHaveProperty('epsBasis');
  });
  test('works with a single stored quarter', () => {
    const subj: SymbolData = { ...symbolData('SUBJ', { close: 20_000 }), financials: quarters('SUBJ', LATEST_PERIOD, 1) };
    expect(pbVsSector('SUBJ', universe(subj, 5), ctx()).status).toBe('ok');
  });
  test('snapshot has refs with source and fetchedAt', () => {
    const r = pbVsSector('SUBJ', universe(symbolData('SUBJ'), 5), ctx());
    const refs = r.inputs.refs as { ref: string; source: string; fetchedAt: string }[];
    expect(refs.map((x) => x.ref)).toEqual([`prices_daily:SUBJ:${SIGNAL_DATE}`, `financials:SUBJ:${LATEST_PERIOD}`, 'symbols:SUBJ:sector']);
    for (const x of refs) expect(x.source && x.fetchedAt).toBeTruthy();
  });
});

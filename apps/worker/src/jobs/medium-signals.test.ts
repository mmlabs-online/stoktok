import { DEFAULT_MARKET_RULES, DEFAULT_SIGNAL_RULES, addQuarters, parseSignalRules, settingsInputToRow, signalRulesToFormValues, subtractTradingDays, validateSettingsInput } from '@stoktok/core';
import type { CorporateAction, Exchange, Result, SectorInfo, SignalRules, StoredClose } from '@stoktok/core';
import type { FinancialRecord, OpenGapRecord, SignalInsert } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { runMediumSignals } from './medium-signals';
import type { SignalsStore } from './medium-signals';

const FRIDAY = '2026-10-23';
const NOW = new Date('2026-10-26T05:00:00Z'); // Monday 12:00 VN, before the cutoff: expected date is Friday
const SYMBOLS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];
const EPS_BASIS = { 'tcbs-public': 'quarterly' as const };

function closesFor(symbol: string, end: string, n: number): StoredClose[] {
  const out: StoredClose[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ symbol, tradeDate: subtractTradingDays(end, i, []), close: 15_000, volume: 100, source: 'tcbs-public', fetchedAt: '2026-10-23T11:30:00.000Z' });
  }
  return out; // newest first
}

function financialsFor(symbol: string): FinancialRecord[] {
  const out: FinancialRecord[] = [];
  for (let i = 7; i >= 0; i--) {
    out.push({ symbol, period: addQuarters('2026Q2', -i), eps: 1000, bvps: 10_000, revenue: 1_000_000_000, netIncome: 100_000_000, source: 'tcbs-public', fetchedAt: '2026-10-22T10:00:00.000Z' });
  }
  return out;
}

function memoryStore(opts: { watchlist?: string[]; held?: Result<string[]>; rules?: SignalRules; closeDays?: number; closesEnd?: string; gaps?: OpenGapRecord[]; actions?: CorporateAction[]; exchanges?: Record<string, Exchange | null>; actionsError?: Error } = {}) {
  const symbols = opts.watchlist ?? SYMBOLS;
  const table = new Map<string, SignalInsert>();
  const calls = { upsert: 0, gapQueries: [] as string[], marketGapQueries: [] as string[] };
  const store: SignalsStore = {
    getHolidays: async () => [],
    getSignalRules: async () => opts.rules ?? DEFAULT_SIGNAL_RULES,
    listWatchlistSymbols: async () => [...symbols],
    listHeldSymbols: async () => opts.held ?? { ok: true, value: [] },
    getRecentCloses: async (syms, n) =>
      Object.fromEntries(syms.map((s) => [s, closesFor(s, opts.closesEnd ?? FRIDAY, Math.min(opts.closeDays ?? 3, n))])),
    listFinancials: async (syms) => syms.flatMap(financialsFor),
    listSymbolSectors: async (syms): Promise<Record<string, SectorInfo>> =>
      Object.fromEntries(syms.map((s) => [s, { sector: 'Banks', source: 'tcbs-public', fetchedAt: '2026-10-22T10:00:00.000Z' }])),
    listOpenGaps: async (type) => {
      calls.gapQueries.push(type);
      return (opts.gaps ?? []).filter((g) => g.symbol !== null);
    },
    listOpenMarketGaps: async (type) => {
      calls.marketGapQueries.push(type);
      return (opts.gaps ?? []).filter((g) => g.symbol === null);
    },
    getMarketRules: async () => DEFAULT_MARKET_RULES,
    getSymbolExchanges: async () => opts.exchanges ?? {},
    listCorporateActions: async () => {
      if (opts.actionsError) throw opts.actionsError;
      return opts.actions ?? [];
    },
    upsertSignals: async (rows) => {
      calls.upsert += 1;
      for (const r of rows) table.set(`${r.symbol}|${r.rule_id}|${r.horizon}|${r.signal_date}`, r);
      return rows.length;
    },
  };
  return { store, table, calls };
}

const run = (store: SignalsStore, over: { now?: Date; dryRun?: boolean } = {}) =>
  runMediumSignals({ store, now: over.now ?? NOW, log: () => undefined, dryRun: over.dryRun ?? false, epsBasisBySource: EPS_BASIS });

describe('runMediumSignals', () => {
  test('universe = watchlist + held, normalized and deduped; ledger error -> ok false', async () => {
    const a = memoryStore({ watchlist: ['aaa', 'BBB', 'bad symbol'], held: { ok: true, value: ['BBB', 'ccc'] } });
    const s = await run(a.store);
    expect(s.symbols).toEqual(['AAA', 'BBB', 'CCC']);
    expect(s.ok).toBe(true);
    const b = memoryStore({ watchlist: ['AAA'], held: { ok: false, error: { code: 'LEDGER_INVALID' } } as never });
    const t = await run(b.store);
    expect(t.ok).toBe(false);
    expect(t.ledgerError).toBe('LEDGER_INVALID');
    expect(t.symbols).toEqual(['AAA']);
  });

  test('uses rules from store (minPeers changed -> result changes)', async () => {
    const pe = (m: ReturnType<typeof memoryStore>, s: string) => m.table.get(`${s}|pb_vs_sector|medium|${FRIDAY}`);
    const a = memoryStore();
    await run(a.store);
    expect(pe(a, 'AAA')?.status).toBe('ok');
    const rules = { ...DEFAULT_SIGNAL_RULES, pbVsSector: { ...DEFAULT_SIGNAL_RULES.pbVsSector, minPeers: 6 } };
    const b = memoryStore({ rules });
    await run(b.store);
    expect(pe(b, 'AAA')).toMatchObject({ status: 'suppressed', reason_codes: ['peers_insufficient'] });
  });

  test('rules saved through the settings form drive the job', async () => {
    const raw = {
      feeRate: '', sellTaxRate: '0,1', priceLimitHOSE: '7', priceLimitHNX: '10', priceLimitUPCOM: '15',
      settlementDays: '2', lotSize: '100', concentrationThreshold: '', cashDividendTreatment: 'reduceCost', holidays: '',
      ...signalRulesToFormValues(DEFAULT_SIGNAL_RULES),
      peMinPeers: '8', maShortDays: '20', maLongDays: '100', maNeutralBand: '5', growthThreshold: '15',
    };
    const v = validateSettingsInput(raw);
    if (!v.ok) throw new Error('expected valid form');
    const rules = parseSignalRules(settingsInputToRow(v.value, null).rule_configs);
    const m = memoryStore({ rules });
    await run(m.store);
    expect(m.table.has(`AAA|price_vs_ma_20|medium|${FRIDAY}`)).toBe(true);
    expect(m.table.has(`AAA|price_vs_ma_100|medium|${FRIDAY}`)).toBe(true);
    expect(m.table.has(`AAA|price_vs_ma_50|medium|${FRIDAY}`)).toBe(false);
    expect(m.table.has(`AAA|price_vs_ma_200|medium|${FRIDAY}`)).toBe(false);
    expect(m.table.get(`AAA|earnings_growth_trend|medium|${FRIDAY}`)?.inputs_snapshot).toMatchObject({ params: rules.earningsGrowth });
  });

  test('writes suppressed rows with reason_codes, status, data_fresh; ok rows with label/value; computed_at = now', async () => {
    const m = memoryStore();
    const s = await run(m.store);
    const rows = [...m.table.values()];
    expect(rows).toHaveLength(30);
    expect(s).toMatchObject({ results: 30, rowsUpserted: 30, signalDate: FRIDAY, expectedDate: FRIDAY, dryRun: false });
    const ma = m.table.get(`AAA|price_vs_ma_200|medium|${FRIDAY}`);
    expect(ma).toMatchObject({ status: 'suppressed', label: null, value: null, data_fresh: false, reason_codes: ['insufficient_history'], rule_version: 1, horizon: 'medium' });
    const growth = m.table.get(`AAA|earnings_growth_trend|medium|${FRIDAY}`);
    expect(growth).toMatchObject({ status: 'ok', label: 'neutral', value: 0, data_fresh: true, reason_codes: [] });
    expect(growth?.inputs_snapshot).toMatchObject({ params: DEFAULT_SIGNAL_RULES.earningsGrowth });
    expect(rows.every((r) => r.computed_at === NOW.toISOString())).toBe(true);
    expect(s.okCount + s.suppressedCount).toBe(30);
    expect(s.suppressedByReason.insufficient_history).toBe(12);
  });

  test('two runs give identical rows (except computed_at); weekend re-run uses Friday signal_date', async () => {
    const m = memoryStore();
    await run(m.store);
    const first = new Map(m.table);
    const sunday = new Date('2026-10-25T09:00:00Z');
    const s = await run(m.store, { now: sunday });
    expect(s.signalDate).toBe(FRIDAY);
    expect(m.table.size).toBe(first.size);
    for (const [k, v] of first) expect({ ...m.table.get(k), computed_at: '' }).toEqual({ ...v, computed_at: '' });
  });

  test('EOD missing today -> signal_date today, price rules price_stale', async () => {
    const m = memoryStore({ closeDays: 60 });
    const evening = new Date('2026-10-26T12:00:00Z'); // Monday 19:00 VN: Monday close expected, only Friday stored
    const s = await run(m.store, { now: evening });
    expect(s.signalDate).toBe('2026-10-26');
    expect(m.table.get('AAA|price_vs_ma_50|medium|2026-10-26')).toMatchObject({ status: 'suppressed', data_fresh: false });
    expect(m.table.get('AAA|price_vs_ma_50|medium|2026-10-26')?.reason_codes).toContain('price_stale');
  });

  test('reads prices_daily and financials gaps for symbols and market-wide; a market-wide gap suppresses', async () => {
    const gap: OpenGapRecord = { id: 4, symbol: null, fromTs: '2026-10-21T00:00:00.000Z', toTs: '2026-10-21T05:00:00.000Z' };
    const m = memoryStore({ closeDays: 60, gaps: [gap] });
    await run(m.store);
    expect(m.calls.gapQueries.sort()).toEqual(['financials', 'prices_daily']);
    expect(m.calls.marketGapQueries.sort()).toEqual(['financials', 'prices_daily']);
    expect(m.table.get(`AAA|price_vs_ma_50|medium|${FRIDAY}`)?.reason_codes).toContain('price_gap_recorded');
  });

  test('dry-run writes nothing; summary counts suppressedByReason', async () => {
    const m = memoryStore();
    const s = await run(m.store, { dryRun: true });
    expect(m.calls.upsert).toBe(0);
    expect(s).toMatchObject({ dryRun: true, rowsUpserted: 0, results: 30 });
    expect(s.suppressedByReason).toEqual({ insufficient_history: 12 });
  });

  describe('raw-price guard', () => {
    const stock: CorporateAction = { type: 'stock_dividend', id: 'sd1', symbol: 'AAA', exDate: subtractTradingDays(FRIDAY, 5, []), ratio: { held: 100, received: 20 } };
    test('stock dividend within the MA50 window -> row suppressed with reason, data_fresh true', async () => {
      const m = memoryStore({ watchlist: ['AAA'], closeDays: 60, actions: [stock] });
      const s = await run(m.store);
      const row = m.table.get(`AAA|price_vs_ma_50|medium|${FRIDAY}`);
      expect(row).toMatchObject({ status: 'suppressed', reason_codes: ['corporate_action_in_window'], data_fresh: true });
      expect(s.suppressedByReason.corporate_action_in_window).toBe(1);
    });
    test('listCorporateActions rejects -> run rejects, nothing upserted', async () => {
      const m = memoryStore({ watchlist: ['AAA'], actionsError: new Error('db down') });
      await expect(run(m.store)).rejects.toThrow('db down');
      expect(m.calls.upsert).toBe(0);
    });
    test('symbol absent from getSymbolExchanges -> guard.exchangeUnknown true', async () => {
      const m = memoryStore({ watchlist: ['AAA'], closeDays: 60 });
      await run(m.store);
      const row = m.table.get(`AAA|price_vs_ma_50|medium|${FRIDAY}`);
      expect((row?.inputs_snapshot as { guard: { exchangeUnknown: boolean } }).guard.exchangeUnknown).toBe(true);
    });
  });
});

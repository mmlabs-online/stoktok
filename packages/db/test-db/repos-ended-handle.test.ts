import { describe, expect, test } from 'vitest';
import * as repos from '../src/index';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { freshDb } from './harness';

// Table-driven over every function exported by the package index, except the ai-keys functions (they are covered in
// ai-keys.test.ts, which keeps the decrypt allow-list narrow). Inputs are non-empty so no early return skips the query.
const ID = '00000000-0000-4000-8000-000000000000';
const W = { fromTs: '2026-11-01T00:00:00+00:00', toTs: '2026-12-01T00:00:00+00:00' };
const tx = { tradeDate: '2026-01-05', symbol: 'FPT', side: 'buy' as const, quantity: 100, price: 10000 };
const ca = { type: 'cash_dividend' as const, symbol: 'FPT', exDate: '2026-04-01', amountPerShare: 1000 };
const ticket = { gameId: 'mega645' as const, drawId: '1', lines: [[1, 2, 3, 4, 5, 6]], costVnd: 10000, channel: 'manual' as const, purchasedAt: '2026-11-05T01:00:00+00:00', rawText: null };
const draw = { gameId: 'mega645' as const, drawId: '1', drawDate: '2026-11-05', numbers: [1, 2, 3, 4, 5, 6], source: 's', fetchedAt: '2026-11-05T14:00:00+00:00' };
const ts = '2026-11-10T00:00:00+00:00';
const settingsInput = {
  feeRatePpm: 1500, sellTaxRatePpm: 1000, settlementDays: 2, lotSize: 10, priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
  concentrationThresholdPpm: null, cashDividendTreatment: 'reduceCost' as const, signalRules: {} as never, holidays: [],
};

type Call = (db: repos.Db) => Promise<unknown>;
const CALLS: Record<string, Call> = {
  loadLedger: (db) => repos.loadLedger(db, '2026-11-01'),
  listHeldSymbols: (db) => repos.listHeldSymbols(db, '2026-11-01'),
  createTransaction: (db) => repos.createTransaction(db, tx, { source: 'manual' }),
  deleteTransaction: (db) => repos.deleteTransaction(db, ID),
  getTransaction: (db) => repos.getTransaction(db, ID),
  listTransactions: (db) => repos.listTransactions(db),
  listTransactionsPage: (db) => repos.listTransactionsPage(db, { limit: 1, offset: 0 }),
  updateTransaction: (db) => repos.updateTransaction(db, ID, tx),
  createCorporateAction: (db) => repos.createCorporateAction(db, ca),
  deleteCorporateAction: (db) => repos.deleteCorporateAction(db, ID),
  listCorporateActions: (db) => repos.listCorporateActions(db),
  updateCorporateAction: (db) => repos.updateCorporateAction(db, ID, ca),
  getAppSettings: (db) => repos.getAppSettings(db),
  getConcentrationThreshold: (db) => repos.getConcentrationThreshold(db),
  getEntrySettings: (db) => repos.getEntrySettings(db),
  getMarketRules: (db) => repos.getMarketRules(db),
  getSettings: (db) => repos.getSettings(db),
  getSignalRules: (db) => repos.getSignalRules(db),
  saveAppSettings: (db) => repos.saveAppSettings(db, settingsInput),
  saveSettings: (db) => repos.saveSettings(db, { feeRatePpm: 1500, sellTaxRatePpm: 1000, dividendWithholdingRatePpm: 50000, settlementDays: 2, holidays: [], cashDividendTreatment: 'reduceCost', costMethod: 'WAC' }),
  getFirstPriceDates: (db) => repos.getFirstPriceDates(db, ['FPT']),
  getLatestCloses: (db) => repos.getLatestCloses(db, ['FPT']),
  getRecentCloses: (db) => repos.getRecentCloses(db, ['FPT']),
  listCloseHistory: (db) => repos.listCloseHistory(db, 'FPT', '2026-01-01', '2026-12-31'),
  listPriceDates: (db) => repos.listPriceDates(db, 'FPT', '2026-01-01', '2026-12-31'),
  upsertPricesDaily: (db) => repos.upsertPricesDaily(db, [{ symbol: 'FPT', trade_date: '2026-11-02', open: 1, high: 2, low: 1, close: 2, volume: 1, foreign_net: null, source: 's', fetched_at: ts }]),
  getLatestIntraday: (db) => repos.getLatestIntraday(db, ['FPT']),
  upsertPricesIntraday: (db) => repos.upsertPricesIntraday(db, [{ symbol: 'FPT', ts, price: 1, volume: 1, source: 's', fetched_at: ts }]),
  listFinancials: (db) => repos.listFinancials(db, ['FPT'], '2025Q1'),
  upsertFinancials: (db) => repos.upsertFinancials(db, [{ symbol: 'FPT', period: '2026Q1', eps: 1, bvps: 1, revenue: 1, net_income: 1, source: 's', fetched_at: ts }]),
  listFinancialLines: (db) => repos.listFinancialLines(db, ['FPT'], 'quarter', '2025Q1'),
  upsertFinancialLines: (db) => repos.upsertFinancialLines(db, [{ symbol: 'FPT', period_kind: 'quarter', period: '2026Q1', statement: 'income', line: 'revenue', value: 1, source: 's', fetched_at: ts }]),
  extendGaps: (db) => repos.extendGaps(db, [1], ts),
  insertGaps: (db) => repos.insertGaps(db, [{ symbol: null, data_type: 'x', from_ts: ts, to_ts: ts, source: 's', fetched_at: ts }]),
  listAllOpenGaps: (db) => repos.listAllOpenGaps(db, 'x'),
  listOpenGaps: (db) => repos.listOpenGaps(db, 'x', ['FPT']),
  listOpenMarketGaps: (db) => repos.listOpenMarketGaps(db, 'x'),
  resolveGaps: (db) => repos.resolveGaps(db, [1], ts),
  insertNews: (db) => repos.insertNews(db, [{ url: 'https://x.test/1', title: 't', excerpt: '', source: 's', credibility: 'established_outlet', published_at: ts, fetched_at: ts, symbols: [] }]),
  listLatestSignals: (db) => repos.listLatestSignals(db, 'FPT', ['r']),
  upsertSignals: (db) => repos.upsertSignals(db, [{ symbol: 'FPT', rule_id: 'r', horizon: 'medium', signal_date: '2026-11-09', status: 'suppressed', label: null, value: null, data_fresh: false, reason_codes: ['x'], inputs_snapshot: {}, rule_version: 1, computed_at: ts }]),
  createAsset: (db) => repos.createAsset(db, { type: 'cash', name: 'n', value: 1, asOf: '2026-11-01' }),
  deleteAsset: (db) => repos.deleteAsset(db, ID),
  getAsset: (db) => repos.getAsset(db, ID),
  listAssets: (db) => repos.listAssets(db),
  updateAsset: (db) => repos.updateAsset(db, ID, { type: 'cash', name: 'n', value: 1, asOf: '2026-11-01' }),
  addToWatchlist: (db) => repos.addToWatchlist(db, 'FPT'),
  listWatchlist: (db) => repos.listWatchlist(db),
  removeFromWatchlist: (db) => repos.removeFromWatchlist(db, 'FPT'),
  getSymbolExchanges: (db) => repos.getSymbolExchanges(db, ['FPT']),
  listSymbolSectors: (db) => repos.listSymbolSectors(db, ['FPT']),
  setSymbolExchange: (db) => repos.setSymbolExchange(db, 'FPT', 'HOSE'),
  setSymbolSector: (db) => repos.setSymbolSector(db, 'FPT', { sector: 's', source: 's', fetchedAt: ts }),
  createLotteryTicket: (db) => repos.createLotteryTicket(db, ticket),
  getLotteryDraw: (db) => repos.getLotteryDraw(db, 'mega645', '1'),
  getLotteryTicket: (db) => repos.getLotteryTicket(db, ID),
  listLotteryTickets: (db) => repos.listLotteryTickets(db),
  listPendingLotteryTickets: (db) => repos.listPendingLotteryTickets(db, 'mega645', '1'),
  recordLotteryTicketResult: (db) => repos.recordLotteryTicketResult(db, ID, { status: 'lost', prizeTier: null, grossVnd: 0, checkedAt: ts }),
  updateLotteryTicket: (db) => repos.updateLotteryTicket(db, ID, ticket),
  upsertLotteryDraws: (db) => repos.upsertLotteryDraws(db, [draw]),
  aiUsageLedger: (db) => repos.aiUsageLedger(db).monthSpend(W),
  getAiMonthSpend: (db) => repos.getAiMonthSpend(db, W),
  reserveAiUsage: (db) => repos.reserveAiUsage(db, { provider: 'anthropic', model: 'm', task: 'summary', reserveMicroUsd: 1, capMicroUsd: 2, window: W }),
  settleAiUsage: (db) => repos.settleAiUsage(db, 1, { status: 'ok', inputTokens: 0, outputTokens: 0, costMicroUsd: 0 }, new Date()),
  listAiSummariesForDate: (db) => repos.listAiSummariesForDate(db, '2026-11-10'),
  upsertAiSummary: (db) => repos.upsertAiSummary(db, { scope: 'portfolio', symbol: '', summary_date: '2026-11-10', generator: 'template', provider: null, model: null, usage_id: null, body_version: 1, body: { sections: [] } as never, input_ids: [], created_at: ts }),
};
const AI_KEYS = /AiKey/;

describe('every exported repo function on an ended handle', () => {
  test('the table covers every index export (functions only)', () => {
    const exported = Object.entries(repos).filter(([, v]) => typeof v === 'function').map(([k]) => k);
    const expected = exported.filter((n) => !AI_KEYS.test(n) && !['DataError', 'drawIdFromNo', 'drawNoFromId'].includes(n)).sort();
    expect(Object.keys(CALLS).sort()).toEqual(expected);
  });

  test('every exported repo function rejects with DataError on an ended handle', async () => {
    const dead = await freshDb();
    await kyselyOf(dead.pgDb).selectFrom('settings').select('id').execute(); // initialise the pool: end() on a never-used handle is a no-op
    await dead.pgDb.end();
    for (const [name, call] of Object.entries(CALLS)) {
      const e = await call(dead.pgDb).then(() => undefined, (x: unknown) => x);
      expect(e, name).toBeInstanceOf(DataError);
      expect((e as DataError).code, name).toBe('DB_ERROR');
    }
    await dead.drop();
  });
});

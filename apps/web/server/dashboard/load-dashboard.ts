import {
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  buildLedger,
  buildPortfolio,
  expectedPriceDate,
  resolveConcentrationThreshold,
  vnDateOf,
} from '@stoktok/core';
import type { LedgerError, Portfolio } from '@stoktok/core';
import {
  getConcentrationThreshold,
  getEntrySettings,
  getLatestCloses,
  listAssets,
  listCorporateActions,
  listTransactions,
} from '../db';
import type { Asset, Db } from '../db';

export type DashboardResult =
  | { kind: 'ledgerError'; error: LedgerError }
  | {
      kind: 'ok';
      portfolio: Portfolio;
      hasTransactions: boolean;
      feeRateConfigured: boolean;
      expectedPriceDate: string;
      assets: Asset[];
    };

/**
 * Reads stored data and delegates every calculation to core (R1).
 * R6 is suspended: when it is restored, call requireUser() at the top of this entry point.
 * Uses getEntrySettings, not getSettings/loadLedger, so an unset fee rate never throws.
 */
export async function loadDashboard(db: Db, now: Date): Promise<DashboardResult> {
  const [txs, cas, entry, assets, thresholdPpm] = await Promise.all([
    listTransactions(db),
    listCorporateActions(db),
    getEntrySettings(db),
    listAssets(db),
    getConcentrationThreshold(db),
  ]);
  const ledger = buildLedger(txs, cas, entry.settings, vnDateOf(now));
  if (!ledger.ok) return { kind: 'ledgerError', error: ledger.error };

  const open = ledger.value.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);
  const quotes = await getLatestCloses(db, open);
  const expected = expectedPriceDate(now, entry.settings.holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);
  const portfolio = buildPortfolio({
    holdings: ledger.value.holdings,
    quotes,
    assets,
    expectedPriceDate: expected,
    concentrationThresholdPpm: resolveConcentrationThreshold(thresholdPpm),
  });
  return {
    kind: 'ok',
    portfolio,
    hasTransactions: txs.length > 0,
    feeRateConfigured: entry.feeRateConfigured,
    expectedPriceDate: expected,
    assets,
  };
}

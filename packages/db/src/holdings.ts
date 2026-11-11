import { buildLedger } from '@stoktok/core';
import type { Result } from '@stoktok/core';
import type { PgDb } from './pg/client';
import { listCorporateActions } from './repos/corporate-actions';
import { getEntrySettings } from './repos/settings';
import { listTransactions } from './repos/transactions';

/**
 * Symbols with quantity > 0 as of `asOf` ('YYYY-MM-DD'); the ledger is core buildLedger (R1).
 * Uses getEntrySettings, not getSettings, so an unset fee rate never throws.
 */
export async function listHeldSymbols(db: PgDb, asOf: string): Promise<Result<string[]>> {
  const [txs, cas, entry] = await Promise.all([listTransactions(db), listCorporateActions(db), getEntrySettings(db)]);
  const ledger = buildLedger(txs, cas, entry.settings, asOf);
  if (!ledger.ok) return ledger;
  return { ok: true, value: ledger.value.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol) };
}

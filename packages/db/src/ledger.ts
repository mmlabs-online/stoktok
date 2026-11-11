import { buildLedger } from '@stoktok/core';
import type { Ledger, Result } from '@stoktok/core';
import type { PgDb } from './pg/client';
import { listCorporateActions } from './repos/corporate-actions';
import { getSettings } from './repos/settings';
import { listTransactions } from './repos/transactions';

/** All calculation is in core buildLedger (R1); the caller supplies asOf ('YYYY-MM-DD'). */
export async function loadLedger(db: PgDb, asOf: string): Promise<Result<Ledger>> {
  const [txs, cas, settings] = await Promise.all([listTransactions(db), listCorporateActions(db), getSettings(db)]);
  return buildLedger(txs, cas, settings, asOf);
}

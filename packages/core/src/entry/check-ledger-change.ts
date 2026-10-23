import { buildLedger } from '../ledger/build-ledger';
import type { CorporateAction, LedgerSettings, Transaction } from '../ledger/types';
import type { EntryError } from './messages-vi';
import type { TransactionInput } from './validate-transaction';

export type LedgerChange =
  | { kind: 'add'; input: TransactionInput }
  | { kind: 'edit'; id: string; input: TransactionInput }
  | { kind: 'delete'; id: string };

export type LedgerChangeResult = { ok: true } | { ok: false; error: EntryError };

const NEW_ID = '__new__';

function latestDate(today: string, txs: readonly Transaction[], actions: readonly CorporateAction[]): string {
  let latest = today;
  for (const t of txs) if (t.tradeDate > latest) latest = t.tradeDate;
  for (const a of actions) if (a.exDate > latest) latest = a.exDate;
  return latest;
}

/**
 * Replays the whole ledger with the change applied and rejects it when a sell would exceed the
 * sellable quantity (T+2, lots and stock dividends all come from buildLedger). If the current
 * ledger is already oversold, a change is allowed unless it creates an earlier problem.
 */
export function checkLedgerChange(args: {
  transactions: readonly Transaction[];
  actions: readonly CorporateAction[];
  settings: LedgerSettings;
  today: string;
  change: LedgerChange;
}): LedgerChangeResult {
  const { transactions, actions, settings, today, change } = args;

  let candidate: Transaction[];
  let changedId: string | null;
  if (change.kind === 'add') {
    const seq = transactions.reduce((m, t) => Math.max(m, t.seq), 0) + 1;
    candidate = [...transactions, { ...change.input, id: NEW_ID, seq }];
    changedId = NEW_ID;
  } else {
    const existing = transactions.find((t) => t.id === change.id);
    if (!existing) return { ok: false, error: { code: 'NOT_FOUND' } };
    changedId = change.kind === 'edit' ? change.id : null;
    candidate =
      change.kind === 'edit'
        ? transactions.map((t) => (t.id === change.id ? { ...change.input, id: t.id, seq: t.seq } : t))
        : transactions.filter((t) => t.id !== change.id);
  }

  const res = buildLedger(candidate, actions, settings, latestDate(today, candidate, actions));
  if (res.ok) return { ok: true };
  if (res.error.code !== 'OVERSELL') return { ok: false, error: { code: 'LEDGER_INVALID' } };

  const err = res.error;
  const current = buildLedger(transactions, actions, settings, latestDate(today, transactions, actions));
  if (!current.ok && current.error.code === 'OVERSELL') {
    const before = current.error;
    if (err.transactionId === before.transactionId || err.date > before.date) return { ok: true };
  }
  return {
    ok: false,
    error: {
      code: err.transactionId === changedId ? 'OVERSELL_SELF' : 'OVERSELL_OTHER',
      params: { symbol: err.symbol, date: err.date, requested: err.requested, sellable: err.sellable },
    },
  };
}

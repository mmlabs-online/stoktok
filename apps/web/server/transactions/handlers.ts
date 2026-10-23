import {
  DEFAULT_TRADING_RULES,
  checkLedgerChange,
  entryMessage,
  validateCorporateActionInput,
  validateTransactionInput,
} from '@stoktok/core';
import type {
  CorporateActionFormRaw,
  EntryError,
  EntryErrorCode,
  LedgerChange,
  LedgerSettings,
  TransactionFormRaw,
} from '@stoktok/core';
import {
  DataError,
  createCorporateAction,
  createTransaction,
  deleteTransaction,
  getEntrySettings,
  listCorporateActions,
  listTransactions,
  updateTransaction,
} from '../db';
import type { Db } from '../db';

/**
 * FormData -> raw strings -> core validation -> repo. Every path re-validates on the server.
 * Validate-then-write is not atomic; accepted for a single user (STK-008 plan A9).
 */

export interface FormMessage {
  code: EntryErrorCode;
  message: string;
}
export type FieldErrors = Record<string, FormMessage>;

export type FormState<V> =
  | { ok: true }
  | { ok: false; fieldErrors: FieldErrors; formError?: FormMessage; values: V };

const message = (e: EntryError): FormMessage => ({ code: e.code, message: entryMessage(e.code, e.params) });

function fieldErrors(errors: Partial<Record<string, EntryError>>): FieldErrors {
  const out: FieldErrors = {};
  for (const [field, e] of Object.entries(errors)) if (e) out[field] = message(e);
  return out;
}

function failForm<V>(values: V, code: EntryErrorCode): FormState<V> {
  return { ok: false, fieldErrors: {}, formError: message({ code }), values };
}

/** Maps repo errors to a form error; anything that is not a DataError is a bug and is rethrown. */
function fromThrown<V>(e: unknown, values: V, conflict: EntryErrorCode = 'SAVE_FAILED'): FormState<V> {
  if (!(e instanceof DataError)) throw e;
  if (e.code === 'NOT_FOUND') return failForm(values, 'NOT_FOUND');
  if (e.code === 'CONFLICT') return failForm(values, conflict);
  return failForm(values, 'SAVE_FAILED');
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '');

export function readTransactionForm(fd: FormData): TransactionFormRaw {
  return {
    tradeDate: str(fd, 'tradeDate'),
    symbol: str(fd, 'symbol'),
    side: str(fd, 'side'),
    quantity: str(fd, 'quantity'),
    price: str(fd, 'price'),
    fee: str(fd, 'fee'),
    tax: str(fd, 'tax'),
    oddLot: fd.get('oddLot') === 'on',
    confirmLowPrice: fd.get('confirmLowPrice') === 'on',
  };
}

export function readCorporateActionForm(fd: FormData): CorporateActionFormRaw {
  return {
    type: str(fd, 'type'),
    symbol: str(fd, 'symbol'),
    exDate: str(fd, 'exDate'),
    amountPerShare: str(fd, 'amountPerShare'),
    payDate: str(fd, 'payDate'),
    held: str(fd, 'held'),
    received: str(fd, 'received'),
    listingDate: str(fd, 'listingDate'),
  };
}

export type TransactionFormState = FormState<TransactionFormRaw>;
export type CorporateActionFormState = FormState<CorporateActionFormRaw>;

async function checkChange(db: Db, today: string, change: LedgerChange, settings: LedgerSettings) {
  const [transactions, actions] = await Promise.all([listTransactions(db), listCorporateActions(db)]);
  return checkLedgerChange({ transactions, actions, settings, today, change });
}

async function submitTransaction(
  db: Db,
  formData: FormData,
  today: string,
  target: { id?: string },
): Promise<TransactionFormState> {
  const values = readTransactionForm(formData);
  try {
    const { settings, feeRateConfigured } = await getEntrySettings(db);
    const v = validateTransactionInput(values, { rules: DEFAULT_TRADING_RULES, today, feeRateConfigured });
    if (!v.ok) return { ok: false, fieldErrors: fieldErrors(v.errors), values };
    const change: LedgerChange =
      target.id === undefined ? { kind: 'add', input: v.value } : { kind: 'edit', id: target.id, input: v.value };
    const check = await checkChange(db, today, change, settings);
    if (!check.ok) {
      if (check.error.code === 'OVERSELL_SELF') {
        return { ok: false, fieldErrors: { quantity: message(check.error) }, values };
      }
      return { ok: false, fieldErrors: {}, formError: message(check.error), values };
    }
    if (target.id === undefined) await createTransaction(db, v.value, { source: 'manual' });
    else await updateTransaction(db, target.id, v.value);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, values);
  }
}

export const handleCreateTransaction = (db: Db, formData: FormData, today: string) =>
  submitTransaction(db, formData, today, {});

export const handleUpdateTransaction = (db: Db, id: string, formData: FormData, today: string) =>
  submitTransaction(db, formData, today, { id });

export async function handleDeleteTransaction(db: Db, id: string, today: string): Promise<FormState<Record<string, never>>> {
  try {
    const { settings } = await getEntrySettings(db);
    const check = await checkChange(db, today, { kind: 'delete', id }, settings);
    if (!check.ok) return { ok: false, fieldErrors: {}, formError: message(check.error), values: {} };
    await deleteTransaction(db, id);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, {});
  }
}

export async function handleCreateCorporateAction(db: Db, formData: FormData): Promise<CorporateActionFormState> {
  const values = readCorporateActionForm(formData);
  const v = validateCorporateActionInput(values);
  if (!v.ok) return { ok: false, fieldErrors: fieldErrors(v.errors), values };
  try {
    await createCorporateAction(db, v.value);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, values, 'CA_DUPLICATE');
  }
}

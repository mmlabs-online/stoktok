import { DEFAULT_MARKET_RULES, DEFAULT_MARKET_SETTINGS } from '@stoktok/core';
import type { CorporateAction, Transaction } from '@stoktok/core';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  listTransactions: vi.fn(),
  listCorporateActions: vi.fn(),
  getEntrySettings: vi.fn(),
  getMarketRules: vi.fn(),
  createCorporateAction: vi.fn(),
}));

import {
  DataError,
  createCorporateAction,
  createTransaction,
  deleteTransaction,
  getEntrySettings,
  getMarketRules,
  listCorporateActions,
  listTransactions,
  updateTransaction,
} from '../db';
import type { Db } from '../db';
import {
  handleCreateCorporateAction,
  handleCreateTransaction,
  handleDeleteTransaction,
  handleUpdateTransaction,
} from './handlers';

const db = {} as Db;
const today = '2026-10-23';
const settings = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 1500 };

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const txForm = (o: Record<string, string> = {}) =>
  fd({ tradeDate: '2026-10-20', symbol: 'FPT', side: 'buy', quantity: '100', price: '125.400', fee: '', tax: '', ...o });

const buy: Transaction = { id: '00000000-0000-4000-8000-0000000000b1', seq: 1, tradeDate: '2026-10-12', symbol: 'FPT', side: 'buy', quantity: 300, price: 100000 };
const sell: Transaction = { id: '00000000-0000-4000-8000-0000000000a1', seq: 2, tradeDate: '2026-10-16', symbol: 'FPT', side: 'sell', quantity: 200, price: 100000 };

function setLedger(txs: Transaction[], actions: CorporateAction[] = []) {
  vi.mocked(listTransactions).mockResolvedValue(txs);
  vi.mocked(listCorporateActions).mockResolvedValue(actions);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getEntrySettings).mockResolvedValue({ settings, feeRateConfigured: true });
  vi.mocked(getMarketRules).mockResolvedValue(DEFAULT_MARKET_RULES);
  setLedger([]);
});

describe('handleCreateTransaction', () => {
  it('stores 125.400 as integer 125400 with source manual', async () => {
    expect(await handleCreateTransaction(db, txForm(), today)).toEqual({ ok: true });
    expect(createTransaction).toHaveBeenCalledWith(
      db,
      { tradeDate: '2026-10-20', symbol: 'FPT', side: 'buy', quantity: 100, price: 125400 },
      { source: 'manual' },
    );
  });

  it('returns Vietnamese field errors, echoes values and does not write', async () => {
    const r = await handleCreateTransaction(db, txForm({ price: '0', quantity: '150' }), today);
    expect(r).toMatchObject({ ok: false, values: { price: '0', quantity: '150' } });
    if (r.ok) return;
    expect(r.fieldErrors.price?.code).toBe('PRICE_NOT_POSITIVE');
    expect(r.fieldErrors.quantity?.code).toBe('QTY_NOT_LOT');
    expect(r.fieldErrors.price?.message).toContain('Giá phải lớn hơn 0');
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('rejects an oversell on the quantity field', async () => {
    setLedger([buy]);
    const r = await handleCreateTransaction(db, txForm({ side: 'sell', tradeDate: '2026-10-14', quantity: '400', fee: '1', tax: '1' }), today);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.fieldErrors.quantity?.code).toBe('OVERSELL_SELF');
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('requires a fee when the fee rate is not configured', async () => {
    vi.mocked(getEntrySettings).mockResolvedValue({ settings: { ...settings, feeRatePpm: 0 }, feeRateConfigured: false });
    const r = await handleCreateTransaction(db, txForm(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.fee?.code).toBe('FEE_REQUIRED_NO_RATE');
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('maps a database error to SAVE_FAILED without leaking details', async () => {
    vi.mocked(createTransaction).mockRejectedValue(new DataError('DB_ERROR', 'transactions', 'create', 'database error', '08006'));
    const r = await handleCreateTransaction(db, txForm(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError).toEqual({ code: 'SAVE_FAILED', message: 'Không lưu được, vui lòng thử lại.' });
    expect(JSON.stringify(r)).not.toContain('08006');
  });
});

describe('lot size comes from stored rules', () => {
  it('accepts qty 50 when the stored lot size is 10', async () => {
    vi.mocked(getMarketRules).mockResolvedValue({ ...DEFAULT_MARKET_RULES, lotSize: 10 });
    expect(await handleCreateTransaction(db, txForm({ quantity: '50' }), today)).toEqual({ ok: true });
    expect(getMarketRules).toHaveBeenCalledWith(db);
    expect(createTransaction).toHaveBeenCalled();
  });

  it('rejects qty 50 when the stored lot size is 100', async () => {
    const r = await handleCreateTransaction(db, txForm({ quantity: '50' }), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.quantity?.message).toContain('bội số của 100');
    expect(createTransaction).not.toHaveBeenCalled();
  });
});

describe('handleUpdateTransaction', () => {
  it('calls updateTransaction with the id and integer VND', async () => {
    setLedger([buy, sell]);
    const r = await handleUpdateTransaction(
      db, '00000000-0000-4000-8000-0000000000a1', txForm({ side: 'sell', tradeDate: '2026-10-16', quantity: '300', price: '100000', fee: '0', tax: '0' }), today,
    );
    expect(r).toEqual({ ok: true });
    expect(updateTransaction).toHaveBeenCalledWith(db, '00000000-0000-4000-8000-0000000000a1', expect.objectContaining({ quantity: 300, price: 100000 }));
  });

  it('refuses an edit that breaks a later sell', async () => {
    setLedger([buy, sell]);
    const r = await handleUpdateTransaction(db, '00000000-0000-4000-8000-0000000000b1', txForm({ tradeDate: '2026-10-12', quantity: '100', price: '100000' }), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('OVERSELL_OTHER');
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown id and does not write', async () => {
    setLedger([buy]);
    const r = await handleUpdateTransaction(db, '00000000-0000-4000-8000-0000000000ff', txForm(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('NOT_FOUND');
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a non-UUID id without touching the db', async () => {
    const r = await handleUpdateTransaction(db, "1' or true", txForm(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('NOT_FOUND');
    expect(listTransactions).not.toHaveBeenCalled();
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('invalid input does not write', async () => {
    const r = await handleUpdateTransaction(db, '00000000-0000-4000-8000-0000000000b1', txForm({ price: '0' }), today);
    expect(r.ok).toBe(false);
    expect(updateTransaction).not.toHaveBeenCalled();
  });
});

describe('handleDeleteTransaction', () => {
  it('deletes a valid target', async () => {
    setLedger([buy, sell]);
    expect(await handleDeleteTransaction(db, '00000000-0000-4000-8000-0000000000a1', today)).toEqual({ ok: true });
    expect(deleteTransaction).toHaveBeenCalledWith(db, '00000000-0000-4000-8000-0000000000a1');
  });

  it('refuses a delete that breaks a later sell', async () => {
    setLedger([buy, sell]);
    const r = await handleDeleteTransaction(db, '00000000-0000-4000-8000-0000000000b1', today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('OVERSELL_OTHER');
    expect(deleteTransaction).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a non-UUID id without touching the db', async () => {
    const r = await handleDeleteTransaction(db, 'zzz', today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('NOT_FOUND');
    expect(listTransactions).not.toHaveBeenCalled();
    expect(deleteTransaction).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown id', async () => {
    const r = await handleDeleteTransaction(db, '00000000-0000-4000-8000-0000000000ff', today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('NOT_FOUND');
    expect(deleteTransaction).not.toHaveBeenCalled();
  });
});

describe('handleCreateCorporateAction', () => {
  const caForm = (o: Record<string, string> = {}) =>
    fd({ type: 'cash_dividend', symbol: 'FPT', exDate: '2026-10-20', amountPerShare: '1.000', ...o });

  it('creates a valid cash dividend with integer amount', async () => {
    expect(await handleCreateCorporateAction(db, caForm())).toEqual({ ok: true });
    expect(createCorporateAction).toHaveBeenCalledWith(db, {
      type: 'cash_dividend',
      symbol: 'FPT',
      exDate: '2026-10-20',
      amountPerShare: 1000,
    });
  });

  it('creates a valid stock dividend', async () => {
    await handleCreateCorporateAction(db, caForm({ type: 'stock_dividend', held: '100', received: '20' }));
    expect(createCorporateAction).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: 'stock_dividend', ratio: { held: 100, received: 20 } }),
    );
  });

  it('invalid input does not write', async () => {
    const r = await handleCreateCorporateAction(db, caForm({ amountPerShare: '0' }));
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.amountPerShare?.code).toBe('AMOUNT_NOT_POSITIVE');
    expect(createCorporateAction).not.toHaveBeenCalled();
  });

  it('rejects rights_issue', async () => {
    const r = await handleCreateCorporateAction(db, caForm({ type: 'rights_issue' }));
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.type?.code).toBe('CA_TYPE_UNSUPPORTED');
    expect(createCorporateAction).not.toHaveBeenCalled();
  });

  it('maps a unique violation to CA_DUPLICATE', async () => {
    vi.mocked(createCorporateAction).mockRejectedValue(new DataError('CONFLICT', 'corporate_actions', 'create', 'conflict', '23505'));
    const r = await handleCreateCorporateAction(db, caForm());
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('CA_DUPLICATE');
  });
});

// Reject-without-auth tests are waived: R6 is suspended (CLAUDE.md, 2026-10-23).

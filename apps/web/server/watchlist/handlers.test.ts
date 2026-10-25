import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
  setSymbolExchange: vi.fn(),
}));

import { DataError, addToWatchlist, removeFromWatchlist, setSymbolExchange } from '../db';
import type { Db } from '../db';
import { handleAddWatch, handleRemoveWatch, handleSetExchange } from './handlers';

const db = {} as Db;
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => vi.resetAllMocks());

describe('handleAddWatch', () => {
  it('sets the exchange then inserts the normalized symbol', async () => {
    const order: string[] = [];
    vi.mocked(setSymbolExchange).mockImplementation(async () => void order.push('exchange'));
    vi.mocked(addToWatchlist).mockImplementation(async () => {
      order.push('watch');
      return { symbol: 'VNM', group: 'watching', addedAt: '' };
    });
    expect(await handleAddWatch(db, fd({ symbol: ' vnm ', exchange: 'hose' }))).toEqual({ ok: true });
    expect(setSymbolExchange).toHaveBeenCalledWith(db, 'VNM', 'HOSE');
    expect(addToWatchlist).toHaveBeenCalledWith(db, 'VNM');
    expect(order).toEqual(['exchange', 'watch']);
  });
  it('blank exchange does not call setSymbolExchange', async () => {
    await handleAddWatch(db, fd({ symbol: 'VNM', exchange: '' }));
    expect(setSymbolExchange).not.toHaveBeenCalled();
    expect(addToWatchlist).toHaveBeenCalledWith(db, 'VNM');
  });
  it('invalid symbol and bad exchange give field errors and no repo call', async () => {
    const a = await handleAddWatch(db, fd({ symbol: 'V!', exchange: '' }));
    if (a.ok) throw new Error('expected failure');
    expect(a.fieldErrors.symbol?.code).toBe('SYMBOL_INVALID');
    const b = await handleAddWatch(db, fd({ symbol: 'VNM', exchange: 'HSX' }));
    if (b.ok) throw new Error('expected failure');
    expect(b.fieldErrors.exchange?.code).toBe('EXCHANGE_INVALID');
    expect(b.values).toEqual({ symbol: 'VNM', exchange: 'HSX' });
    expect(setSymbolExchange).not.toHaveBeenCalled();
    expect(addToWatchlist).not.toHaveBeenCalled();
  });
  it('duplicate (CONFLICT) -> WATCHLIST_DUPLICATE with values kept', async () => {
    vi.mocked(addToWatchlist).mockRejectedValue(new DataError('CONFLICT', 'watchlist', 'add', 'conflict'));
    const r = await handleAddWatch(db, fd({ symbol: 'VNM', exchange: '' }));
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('WATCHLIST_DUPLICATE');
    expect(r.values).toEqual({ symbol: 'VNM', exchange: '' });
  });
  it('other DataError -> SAVE_FAILED; non-DataError is rethrown', async () => {
    vi.mocked(addToWatchlist).mockRejectedValueOnce(new DataError('DB_ERROR', 'watchlist', 'add', 'x'));
    const r = await handleAddWatch(db, fd({ symbol: 'VNM', exchange: '' }));
    expect(!r.ok && r.formError?.code).toBe('SAVE_FAILED');
    vi.mocked(addToWatchlist).mockRejectedValueOnce(new Error('bug'));
    await expect(handleAddWatch(db, fd({ symbol: 'VNM', exchange: '' }))).rejects.toThrow('bug');
  });
});

describe('handleRemoveWatch', () => {
  it('removes the normalized symbol', async () => {
    expect(await handleRemoveWatch(db, 'vnm')).toEqual({ ok: true });
    expect(removeFromWatchlist).toHaveBeenCalledWith(db, 'VNM');
  });
  it('NOT_FOUND is success', async () => {
    vi.mocked(removeFromWatchlist).mockRejectedValue(new DataError('NOT_FOUND', 'watchlist', 'remove', 'not found'));
    expect(await handleRemoveWatch(db, 'VNM')).toEqual({ ok: true });
  });
  it('invalid symbol -> SYMBOL_INVALID, no repo call', async () => {
    const r = await handleRemoveWatch(db, '!!');
    expect(!r.ok && r.formError?.code).toBe('SYMBOL_INVALID');
    expect(removeFromWatchlist).not.toHaveBeenCalled();
  });
  it('non-DataError is rethrown', async () => {
    vi.mocked(removeFromWatchlist).mockRejectedValue(new Error('bug'));
    await expect(handleRemoveWatch(db, 'VNM')).rejects.toThrow('bug');
  });
});

describe('handleSetExchange', () => {
  it('HNX is stored; blank clears explicitly', async () => {
    expect(await handleSetExchange(db, 'vnm', fd({ exchange: 'HNX' }))).toEqual({ ok: true });
    expect(setSymbolExchange).toHaveBeenLastCalledWith(db, 'VNM', 'HNX');
    await handleSetExchange(db, 'VNM', fd({ exchange: '' }));
    expect(setSymbolExchange).toHaveBeenLastCalledWith(db, 'VNM', null);
  });
  it('invalid exchange -> field error, no write', async () => {
    const r = await handleSetExchange(db, 'VNM', fd({ exchange: 'HSX' }));
    expect(!r.ok && r.fieldErrors.exchange?.code).toBe('EXCHANGE_INVALID');
    expect(setSymbolExchange).not.toHaveBeenCalled();
  });
  it('invalid symbol -> SYMBOL_INVALID', async () => {
    const r = await handleSetExchange(db, '!!', fd({ exchange: 'HNX' }));
    expect(!r.ok && r.formError?.code).toBe('SYMBOL_INVALID');
  });
  it('DataError -> SAVE_FAILED', async () => {
    vi.mocked(setSymbolExchange).mockRejectedValue(new DataError('DB_ERROR', 'symbols', 'x', 'x'));
    const r = await handleSetExchange(db, 'VNM', fd({ exchange: 'HNX' }));
    expect(!r.ok && r.formError?.code).toBe('SAVE_FAILED');
  });
});

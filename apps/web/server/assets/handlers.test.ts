import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

import { DataError, createAsset, deleteAsset, updateAsset } from '../db';
import type { Db } from '../db';
import { handleCreateAsset, handleDeleteAsset, handleUpdateAsset } from './handlers';

const db = {} as Db;
const today = '2026-10-23';
const id = '00000000-0000-4000-8000-0000000000a1';

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const form = (o: Record<string, string> = {}) =>
  fd({ type: 'cash', name: '  TCBS  ', value: '125.400', asOf: '2026-10-20', ...o });

beforeEach(() => vi.resetAllMocks());

describe('handleCreateAsset', () => {
  it('writes a normalised asset with integer VND', async () => {
    expect(await handleCreateAsset(db, form(), today)).toEqual({ ok: true });
    expect(createAsset).toHaveBeenCalledWith(db, { type: 'cash', name: 'TCBS', value: 125400, asOf: '2026-10-20' });
  });

  it('invalid input gives Vietnamese field errors, echoes values and does not write', async () => {
    const r = await handleCreateAsset(db, form({ name: ' ', value: 'abc', asOf: '2026-10-24' }), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.name?.code).toBe('REQUIRED');
    expect(r.fieldErrors.value?.code).toBe('NOT_INTEGER');
    expect(r.fieldErrors.asOf?.message).toContain('tương lai');
    expect(r.values).toMatchObject({ name: ' ', value: 'abc' });
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('maps a database error to SAVE_FAILED', async () => {
    vi.mocked(createAsset).mockRejectedValue(new DataError('DB_ERROR', 'assets', 'create', 'database error'));
    const r = await handleCreateAsset(db, form(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('SAVE_FAILED');
  });
});

describe('handleUpdateAsset', () => {
  it('calls updateAsset with the id', async () => {
    expect(await handleUpdateAsset(db, id, form({ type: 'other' }), today)).toEqual({ ok: true });
    expect(updateAsset).toHaveBeenCalledWith(db, id, { type: 'other', name: 'TCBS', value: 125400, asOf: '2026-10-20' });
  });

  it('invalid input does not write', async () => {
    const r = await handleUpdateAsset(db, id, form({ value: '-1' }), today);
    expect(r.ok).toBe(false);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('non-UUID id gives ASSET_NOT_FOUND without a repo call', async () => {
    const r = await handleUpdateAsset(db, 'nope', form(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('ASSET_NOT_FOUND');
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('repo NOT_FOUND gives ASSET_NOT_FOUND', async () => {
    vi.mocked(updateAsset).mockRejectedValue(new DataError('NOT_FOUND', 'assets', 'update', 'not found'));
    const r = await handleUpdateAsset(db, id, form(), today);
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('ASSET_NOT_FOUND');
  });
});

describe('handleDeleteAsset', () => {
  it('deletes by UUID', async () => {
    expect(await handleDeleteAsset(db, id)).toEqual({ ok: true });
    expect(deleteAsset).toHaveBeenCalledWith(db, id);
  });

  it('non-UUID gives ASSET_NOT_FOUND without a repo call', async () => {
    const r = await handleDeleteAsset(db, 'nope');
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('ASSET_NOT_FOUND');
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it('NOT_FOUND maps to ASSET_NOT_FOUND, other DataError to SAVE_FAILED, non-DataError is rethrown', async () => {
    vi.mocked(deleteAsset).mockRejectedValueOnce(new DataError('NOT_FOUND', 'assets', 'delete', 'not found'));
    expect(await handleDeleteAsset(db, id)).toMatchObject({ formError: { code: 'ASSET_NOT_FOUND' } });
    vi.mocked(deleteAsset).mockRejectedValueOnce(new DataError('DB_ERROR', 'assets', 'delete', 'database error'));
    expect(await handleDeleteAsset(db, id)).toMatchObject({ formError: { code: 'SAVE_FAILED' } });
    vi.mocked(deleteAsset).mockRejectedValueOnce(new Error('boom'));
    await expect(handleDeleteAsset(db, id)).rejects.toThrow('boom');
  });
});

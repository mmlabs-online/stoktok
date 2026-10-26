import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  saveAppSettings: vi.fn(),
}));

import { DataError, saveAppSettings } from '../db';
import type { Db } from '../db';
import { handleSaveSettings } from './handlers';

const db = {} as Db;

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const form = (o: Record<string, string> = {}) =>
  fd({
    feeRate: '0,15',
    sellTaxRate: '0,1',
    priceLimitHOSE: '7',
    priceLimitHNX: '10',
    priceLimitUPCOM: '15',
    settlementDays: '2',
    lotSize: '100',
    concentrationThreshold: '25',
    cashDividendTreatment: 'income',
    ...o,
  });

beforeEach(() => vi.resetAllMocks());

describe('handleSaveSettings', () => {
  it('saves a ppm SettingsInput', async () => {
    expect(await handleSaveSettings(db, form())).toEqual({ ok: true });
    expect(saveAppSettings).toHaveBeenCalledWith(db, {
      feeRatePpm: 1500,
      sellTaxRatePpm: 1000,
      settlementDays: 2,
      lotSize: 100,
      priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
      concentrationThresholdPpm: 250000,
      cashDividendTreatment: 'income',
    });
  });

  it('invalid input returns Vietnamese fieldErrors and echoes raw values', async () => {
    const r = await handleSaveSettings(db, form({ feeRate: '-1', lotSize: 'abc' }));
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.feeRate?.code).toBe('OUT_OF_RANGE');
    expect(r.fieldErrors.feeRate?.message).toContain('Giá trị phải từ');
    expect(r.fieldErrors.lotSize?.code).toBe('WHOLE_NUMBER_INVALID');
    expect(r.values).toMatchObject({ feeRate: '-1', lotSize: 'abc' });
    expect(saveAppSettings).not.toHaveBeenCalled();
  });

  it('maps a DataError to SAVE_FAILED', async () => {
    vi.mocked(saveAppSettings).mockRejectedValue(new DataError('DB_ERROR', 'settings', 'save', 'database error'));
    const r = await handleSaveSettings(db, form());
    if (r.ok) throw new Error('expected failure');
    expect(r.formError?.code).toBe('SAVE_FAILED');
  });

  it('rethrows anything that is not a DataError', async () => {
    vi.mocked(saveAppSettings).mockRejectedValue(new Error('bug'));
    await expect(handleSaveSettings(db, form())).rejects.toThrow('bug');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  saveAppSettings: vi.fn(),
}));

import { DEFAULT_SIGNAL_RULES, signalRulesToFormValues } from '@stoktok/core';
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
    holidays: '',
    ...signalRulesToFormValues(DEFAULT_SIGNAL_RULES),
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
      signalRules: DEFAULT_SIGNAL_RULES,
      holidays: [],
    });
  });

  it('saves holidays in the same single save as the other fields', async () => {
    await handleSaveSettings(db, form({ holidays: '2026-10-20' }));
    expect(saveAppSettings).toHaveBeenCalledTimes(1);
    expect(saveAppSettings).toHaveBeenCalledWith(db, expect.objectContaining({ holidays: ['2026-10-20'], lotSize: 100, feeRatePpm: 1500 }));
  });

  it('seeded dates in the submitted list are not saved', async () => {
    await handleSaveSettings(db, form({ holidays: '2026-11-24,2026-10-20' }));
    expect(vi.mocked(saveAppSettings).mock.calls[0]?.[1].holidays).toEqual(['2026-10-20']);
  });

  it('invalid holiday list returns a Vietnamese error, echoes values and does not save', async () => {
    const r = await handleSaveSettings(db, form({ holidays: '2026-10-24' }));
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.holidays?.message).toContain('Thứ Bảy');
    expect(r.values.holidays).toBe('2026-10-24');
    expect(saveAppSettings).not.toHaveBeenCalled();
  });

  it('unchecked toggle saves enabled:false', async () => {
    const f = form();
    f.delete('peEnabled');
    await handleSaveSettings(db, f);
    const saved = vi.mocked(saveAppSettings).mock.calls[0]?.[1];
    expect(saved?.signalRules.peVsSector.enabled).toBe(false);
    expect(saved?.signalRules.pbVsSector.enabled).toBe(true);
  });

  it('invalid signal field returns Vietnamese error and does not save', async () => {
    const r = await handleSaveSettings(db, form({ maShortDays: '50', maLongDays: '50' }));
    if (r.ok) throw new Error('expected failure');
    expect(r.fieldErrors.maLongDays?.message).toBe('MA dài phải lớn hơn MA ngắn.');
    expect(r.values).toMatchObject({ maShortDays: '50', maLongDays: '50' });
    expect(saveAppSettings).not.toHaveBeenCalled();
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

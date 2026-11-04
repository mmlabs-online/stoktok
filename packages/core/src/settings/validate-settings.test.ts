import { describe, expect, it } from 'vitest';
import { appSettingsFromRow } from '../db/mappers';
import { entryMessage } from '../entry/messages-vi';
import { DEFAULT_SIGNAL_RULES } from '../signals/config';
import { signalRulesToFormValues } from './signal-rules-form';
import {
  SETTINGS_BOUNDS,
  concentrationDefaultText,
  settingsToFormValues,
  validateSettingsInput,
} from './validate-settings';
import type { SettingsFormRaw } from './validate-settings';

const valid: SettingsFormRaw = {
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
};
const run = (o: Partial<SettingsFormRaw>) => validateSettingsInput({ ...valid, ...o });
const errorOf = (o: Partial<SettingsFormRaw>, field: keyof SettingsFormRaw) => {
  const r = run(o);
  return r.ok ? undefined : r.errors[field];
};

describe('validateSettingsInput', () => {
  it('valid input returns ppm integers', () => {
    expect(run({})).toEqual({
      ok: true,
      value: {
        feeRatePpm: 1500,
        sellTaxRatePpm: 1000,
        settlementDays: 2,
        lotSize: 100,
        priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
        concentrationThresholdPpm: 250000,
        cashDividendTreatment: 'income',
        signalRules: DEFAULT_SIGNAL_RULES,
        holidays: [],
      },
    });
  });

  it('holidays: weekend gives errors.holidays; seeded dates are stripped', () => {
    const r = run({ holidays: '2026-10-24' });
    expect(r.ok).toBe(false);
    expect(errorOf({ holidays: '2026-10-24' }, 'holidays')?.code).toBe('HOLIDAY_WEEKEND');
    expect(run({ holidays: '2026-11-24,2026-10-20' })).toMatchObject({ ok: true, value: { holidays: ['2026-10-20'] } });
  });

  it('reports market and signal errors together', () => {
    const r = run({ maLongDays: '50', maShortDays: '50' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.maLongDays?.code).toBe('MA_LONG_NOT_ABOVE_SHORT');
    const both = run({ feeRate: '-1', peMinPeers: '1' });
    if (both.ok) throw new Error('expected failure');
    expect(Object.keys(both.errors).sort()).toEqual(['feeRate', 'peMinPeers']);
  });

  const edges: [keyof SettingsFormRaw, string, string, string][] = [
    ['feeRate', '0', '5', '5,0001'],
    ['sellTaxRate', '0', '5', '5,0001'],
    ['priceLimitHOSE', '1', '30', '30,0001'],
    ['priceLimitHNX', '1', '30', '31'],
    ['priceLimitUPCOM', '1', '30', '31'],
    ['settlementDays', '0', '5', '6'],
    ['lotSize', '1', '10000', '10001'],
    ['concentrationThreshold', '1', '100', '101'],
  ];
  it.each(edges)('range edges for %s', (field, min, max, over) => {
    expect(run({ [field]: min }).ok).toBe(true);
    expect(run({ [field]: max }).ok).toBe(true);
    expect(errorOf({ [field]: over }, field)?.code).toBe('OUT_OF_RANGE');
    expect(errorOf({ [field]: '-1' }, field)?.code).toBe('OUT_OF_RANGE');
  });

  it('rejects zero lot size, zero concentration, and below-min price limits', () => {
    expect(errorOf({ lotSize: '0' }, 'lotSize')?.code).toBe('OUT_OF_RANGE');
    expect(errorOf({ concentrationThreshold: '0' }, 'concentrationThreshold')?.code).toBe('OUT_OF_RANGE');
    expect(errorOf({ priceLimitHOSE: '0,5' }, 'priceLimitHOSE')?.code).toBe('OUT_OF_RANGE');
  });

  it('blank fee and concentration become null; other blanks are REQUIRED', () => {
    expect(run({ feeRate: '', concentrationThreshold: '' })).toMatchObject({
      ok: true,
      value: { feeRatePpm: null, concentrationThresholdPpm: null },
    });
    for (const f of ['sellTaxRate', 'priceLimitHOSE', 'priceLimitHNX', 'priceLimitUPCOM', 'settlementDays', 'lotSize'] as const) {
      expect(errorOf({ [f]: '' }, f)?.code).toBe('REQUIRED');
    }
  });

  it('reports all errors together', () => {
    const r = run({ feeRate: 'x', sellTaxRate: '9', lotSize: '0', cashDividendTreatment: '' });
    if (r.ok) throw new Error('expected failure');
    expect(Object.keys(r.errors).sort()).toEqual(['cashDividendTreatment', 'feeRate', 'lotSize', 'sellTaxRate']);
  });

  it('maps parse failures to specific codes', () => {
    expect(errorOf({ cashDividendTreatment: 'abc' }, 'cashDividendTreatment')?.code).toBe('TREATMENT_INVALID');
    expect(errorOf({ lotSize: 'abc' }, 'lotSize')?.code).toBe('WHOLE_NUMBER_INVALID');
    expect(errorOf({ feeRate: '0,123456' }, 'feeRate')?.code).toBe('PERCENT_TOO_PRECISE');
    expect(errorOf({ feeRate: 'abc' }, 'feeRate')?.code).toBe('PERCENT_INVALID');
  });

  it('OUT_OF_RANGE params come from SETTINGS_BOUNDS', () => {
    expect(SETTINGS_BOUNDS.feeRatePpm.max).toBe(50_000);
    const e = errorOf({ feeRate: '6' }, 'feeRate');
    expect(e).toEqual({ code: 'OUT_OF_RANGE', params: { min: '0%', max: '5%' } });
    expect(entryMessage(e!.code, e!.params)).toContain('5%');
  });
});

describe('settingsToFormValues', () => {
  it('no row gives the CLAUDE.md defaults as form values', () => {
    expect(settingsToFormValues(appSettingsFromRow(null))).toEqual({
      feeRate: '',
      sellTaxRate: '0,1',
      priceLimitHOSE: '7',
      priceLimitHNX: '10',
      priceLimitUPCOM: '15',
      settlementDays: '2',
      lotSize: '100',
      concentrationThreshold: '',
      cashDividendTreatment: 'reduceCost',
      holidays: '',
      peEnabled: 'on',
      peMinPeers: '5',
      peDiscount: '20',
      pePremium: '20',
      pbEnabled: 'on',
      pbMinPeers: '5',
      pbDiscount: '20',
      pbPremium: '20',
      growthEnabled: 'on',
      growthComparisons: '4',
      growthMinConsecutive: '2',
      growthThreshold: '10',
      growthMinBase: '1',
      maEnabled: 'on',
      maShortDays: '50',
      maLongDays: '200',
      maNeutralBand: '2',
      financialsMaxFetchAgeDays: '7',
    });
  });

  it('stored holidays show user dates only', () => {
    expect(settingsToFormValues({ ...appSettingsFromRow(null), holidays: ['2026-11-24', '2026-10-20'] }).holidays).toBe('2026-10-20');
  });

  it('stored settings round-trip through validateSettingsInput', () => {
    const form = settingsToFormValues({
      ...appSettingsFromRow(null),
      feeRatePpm: 1500,
      concentrationThresholdPpm: 250000,
      marketRules: { lotSize: 10, priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 } },
    });
    expect(validateSettingsInput(form)).toMatchObject({
      ok: true,
      value: { feeRatePpm: 1500, concentrationThresholdPpm: 250000, lotSize: 10 },
    });
  });

  it('concentrationDefaultText is the 20% default', () => {
    expect(concentrationDefaultText()).toBe('20');
  });
});

import { RowMappingError } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getConcentrationThreshold, getEntrySettings, getSettings, saveSettings } from './settings';

const row = {
  id: 1,
  fee_rate_ppm: 1500,
  sell_tax_rate_ppm: 1000,
  dividend_withholding_rate_ppm: 50000,
  settlement_days: 2,
  holidays: ['2026-01-01'],
  cash_dividend_treatment: 'reduceCost',
  cost_method: 'WAC',
};

describe('settings repo', () => {
  test('get maps the singleton row (eq id 1)', async () => {
    const f = createFake();
    f.respond({ data: row });
    const s = await getSettings(f.db);
    expect(f.methods('eq')[0]?.args).toEqual(['id', 1]);
    expect(s).toMatchObject({ feeRatePpm: 1500, settlementDays: 2, holidays: ['2026-01-01'] });
  });

  test('get with no row throws NOT_CONFIGURED', async () => {
    const f = createFake();
    f.respond({ data: null });
    await expect(getSettings(f.db)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  test('get with NULL fee_rate_ppm throws NOT_CONFIGURED with RowMappingError cause', async () => {
    const f = createFake();
    f.respond({ data: { ...row, fee_rate_ppm: null } });
    await expect(getSettings(f.db)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
      cause: expect.any(RowMappingError),
    });
  });

  test('save upserts on id with payload keys excluding rule_configs and concentration_threshold_ppm', async () => {
    const f = createFake();
    f.respond({ data: row });
    await saveSettings(f.db, {
      feeRatePpm: 1500,
      sellTaxRatePpm: 1000,
      settlementDays: 2,
      holidays: [],
      dividendWithholdingRatePpm: 50000,
      cashDividendTreatment: 'reduceCost',
      costMethod: 'WAC',
    });
    const call = f.methods('upsert')[0];
    expect(call?.args[1]).toEqual({ onConflict: 'id' });
    const keys = Object.keys(call?.args[0] as object);
    expect(keys).not.toContain('rule_configs');
    expect(keys).not.toContain('concentration_threshold_ppm');
    expect(keys).toContain('fee_rate_ppm');
  });

  test('getEntrySettings with a fee rate is configured', async () => {
    const f = createFake();
    f.respond({ data: row });
    expect(await getEntrySettings(f.db)).toMatchObject({ feeRateConfigured: true, settings: { feeRatePpm: 1500 } });
  });

  test('getEntrySettings with NULL fee keeps stored settings and uses fee rate 0', async () => {
    const f = createFake();
    f.respond({ data: { ...row, fee_rate_ppm: null, settlement_days: 3, holidays: ['2026-09-02'] } });
    expect(await getEntrySettings(f.db)).toMatchObject({
      feeRateConfigured: false,
      settings: { feeRatePpm: 0, settlementDays: 3, holidays: ['2026-09-02'] },
    });
  });

  test('getEntrySettings with no row returns defaults and not configured', async () => {
    const f = createFake();
    f.respond({ data: null });
    expect(await getEntrySettings(f.db)).toMatchObject({
      feeRateConfigured: false,
      settings: { feeRatePpm: 0, settlementDays: 2 },
    });
  });
});

describe('getConcentrationThreshold', () => {
  test('returns the value and selects only its column', async () => {
    const f = createFake();
    f.respond({ data: { concentration_threshold_ppm: 300000 } });
    expect(await getConcentrationThreshold(f.db)).toBe(300000);
    expect(f.methods('select')[0]?.args).toEqual(['concentration_threshold_ppm']);
    expect(f.methods('eq')[0]?.args).toEqual(['id', 1]);
  });
  test('NULL -> null; no row -> null', async () => {
    const f = createFake();
    f.respond({ data: { concentration_threshold_ppm: null } });
    expect(await getConcentrationThreshold(f.db)).toBeNull();
    f.respond({ data: null });
    expect(await getConcentrationThreshold(f.db)).toBeNull();
  });
  test('DB error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(getConcentrationThreshold(f.db)).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});

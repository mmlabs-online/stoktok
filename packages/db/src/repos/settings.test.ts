import { RowMappingError } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getSettings, saveSettings } from './settings';

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
});

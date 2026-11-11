import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_MARKET_SETTINGS, DEFAULT_SIGNAL_RULES } from '@stoktok/core';
import type { SettingsInput } from '@stoktok/core';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { jsonb } from '../src/pg/upsert';
import {
  getAppSettings,
  getConcentrationThreshold,
  getEntrySettings,
  getMarketRules,
  getSettings,
  getSignalRules,
  saveAppSettings,
  saveSettings,
} from '../src/repos/settings';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await kyselyOf(t.pgDb).deleteFrom('settings').execute();
});

const base = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 1500 as number | null, holidays: [] as string[] };
const formInput = (o: Partial<SettingsInput> = {}): SettingsInput => ({
  feeRatePpm: 1500,
  sellTaxRatePpm: 1000,
  settlementDays: 2,
  lotSize: 10,
  priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
  concentrationThresholdPpm: 300000,
  cashDividendTreatment: 'income',
  signalRules: DEFAULT_SIGNAL_RULES,
  holidays: [],
  ...o,
});
const rawRow = () => kyselyOf(t.pgDb).selectFrom('settings').selectAll().executeTakeFirstOrThrow();

describe('settings repo', () => {
  test('saveSettings leaves rule_configs and concentration_threshold_ppm untouched', async () => {
    await kyselyOf(t.pgDb).insertInto('settings').values({
      id: 1, fee_rate_ppm: 1, sell_tax_rate_ppm: 1000, dividend_withholding_rate_ppm: 50000, settlement_days: 2,
      cash_dividend_treatment: 'reduceCost', cost_method: 'WAC', concentration_threshold_ppm: 250000,
      rule_configs: jsonb({ keep: { me: true } }),
    }).execute();
    await saveSettings(t.pgDb, { ...base, feeRatePpm: 2000 });
    const r = await rawRow();
    expect(r.fee_rate_ppm).toBe(2000);
    expect(r.concentration_threshold_ppm).toBe(250000);
    expect(r.rule_configs).toEqual({ keep: { me: true } });
  });

  test('saveAppSettings round-trips holidays (empty and non-empty date[], no timezone drift) and rule_configs (jsonb), keeps withholding and cost_method', async () => {
    await saveSettings(t.pgDb, { ...base, dividendWithholdingRatePpm: 123456 });
    const input = (holidays: string[]): SettingsInput => formInput({ holidays });
    const withDates = await saveAppSettings(t.pgDb, input(['2099-01-01', '2099-12-31']));
    expect(withDates.holidays).toEqual(expect.arrayContaining(['2099-01-01', '2099-12-31']));
    const r = await rawRow();
    expect(r.holidays).toEqual(['2099-01-01', '2099-12-31']);
    expect(r.dividend_withholding_rate_ppm).toBe(123456);
    expect(r.cost_method).toBe('WAC');
    expect(r.rule_configs).toMatchObject({ signals: expect.anything() });
    expect((await getMarketRules(t.pgDb)).lotSize).toBe(10);
    await saveAppSettings(t.pgDb, input([]));
    expect((await rawRow()).holidays).toEqual([]);
    const read = await getAppSettings(t.pgDb);
    expect(read.source).toBe('stored');
    expect(read.settings.cashDividendTreatment).toBe('income');
    expect(read.settings.concentrationThresholdPpm).toBe(300000);
  });

  test('fee_rate_ppm null: getSettings → NOT_CONFIGURED, getEntrySettings → feeRateConfigured false', async () => {
    await saveSettings(t.pgDb, { ...base, feeRatePpm: null }).catch(() => undefined); // writes, then reports NOT_CONFIGURED
    const e = await getSettings(t.pgDb).then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(DataError);
    expect(e).toMatchObject({ code: 'NOT_CONFIGURED' });
    const entry = await getEntrySettings(t.pgDb);
    expect(entry.feeRateConfigured).toBe(false);
    expect(entry.settings.feeRatePpm).toBe(0);
  });

  test('no row: getSettings NOT_CONFIGURED; getEntrySettings, getAppSettings, getMarketRules, getSignalRules, getConcentrationThreshold give defaults/null', async () => {
    await expect(getSettings(t.pgDb)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect((await getEntrySettings(t.pgDb)).feeRateConfigured).toBe(false);
    expect(await getAppSettings(t.pgDb)).toMatchObject({ source: 'default' });
    expect(await getMarketRules(t.pgDb)).toBeTruthy();
    expect(await getSignalRules(t.pgDb)).toBeTruthy();
    expect(await getConcentrationThreshold(t.pgDb)).toBeNull();
  });

  test('configured row: getSettings returns it and getConcentrationThreshold reads the value', async () => {
    await saveSettings(t.pgDb, base);
    expect(await getSettings(t.pgDb)).toMatchObject({ feeRatePpm: 1500, settlementDays: base.settlementDays });
    expect(await getConcentrationThreshold(t.pgDb)).toBeNull();
    await saveAppSettings(t.pgDb, formInput({ concentrationThresholdPpm: 400000 }));
    expect(await getConcentrationThreshold(t.pgDb)).toBe(400000);
  });

  test('id is forced to 1; updated_at does not change on save (documents parity)', async () => {
    await saveSettings(t.pgDb, base);
    const before = await rawRow();
    await saveSettings(t.pgDb, { ...base, feeRatePpm: 1800 });
    const after = await rawRow();
    expect(after.id).toBe(1);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.fee_rate_ppm).toBe(1800);
  });
});

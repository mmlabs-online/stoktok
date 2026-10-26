import { RowMappingError } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { DataError } from '../errors';
import {
  getAppSettings,
  getConcentrationThreshold,
  getEntrySettings,
  getMarketRules,
  getSettings,
  getSignalRules,
  saveAppSettings,
  saveSettings,
} from './settings';

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

const fullRow = { ...row, concentration_threshold_ppm: 250000, rule_configs: { signals: { a: 1 }, market: { lotSize: 10 } } };
const input = {
  feeRatePpm: null,
  sellTaxRatePpm: 1000,
  settlementDays: 2,
  lotSize: 10,
  priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
  concentrationThresholdPpm: 250000,
  cashDividendTreatment: 'reduceCost' as const,
};

describe('getAppSettings', () => {
  test('no row gives defaults with source default', async () => {
    const f = createFake();
    f.respond({ data: null });
    const r = await getAppSettings(f.db);
    expect(r.source).toBe('default');
    expect(r.settings.feeRatePpm).toBeNull();
  });
  test('stored row with null fee does not throw', async () => {
    const f = createFake();
    f.respond({ data: { ...fullRow, fee_rate_ppm: null } });
    const r = await getAppSettings(f.db);
    expect(r.source).toBe('stored');
    expect(r.settings).toMatchObject({ feeRatePpm: null, concentrationThresholdPpm: 250000 });
  });
  test('database error throws DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '08006' } });
    await expect(getAppSettings(f.db)).rejects.toBeInstanceOf(DataError);
  });
});

describe('getMarketRules', () => {
  test('selects rule_configs only for id 1', async () => {
    const f = createFake();
    f.respond({ data: { rule_configs: { market: { lotSize: 10 } } } });
    const r = await getMarketRules(f.db);
    expect(f.methods('select')[0]?.args).toEqual(['rule_configs']);
    expect(f.methods('eq')[0]?.args).toEqual(['id', 1]);
    expect(r.lotSize).toBe(10);
    expect(r.priceLimitPpm.HOSE).toBe(70000);
  });
  test('no row gives defaults', async () => {
    const f = createFake();
    f.respond({ data: null });
    expect(await getMarketRules(f.db)).toMatchObject({ lotSize: 100 });
  });
  test('database error throws DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '08006' } });
    await expect(getMarketRules(f.db)).rejects.toBeInstanceOf(DataError);
  });
});

describe('getSignalRules', () => {
  test('no row gives defaults', async () => {
    const f = createFake();
    f.respond({ data: null });
    expect(await getSignalRules(f.db)).toMatchObject({ peVsSector: { minPeers: 5 } });
  });
  test('stored signals namespace is parsed; market namespace ignored', async () => {
    const f = createFake();
    f.respond({ data: { rule_configs: { market: { lotSize: 10 }, signals: { medium: { peVsSector: { minPeers: 7 } } } } } });
    const r = await getSignalRules(f.db);
    expect(f.methods('select')[0]?.args).toEqual(['rule_configs']);
    expect(f.methods('eq')[0]?.args).toEqual(['id', 1]);
    expect(r.peVsSector.minPeers).toBe(7);
    expect(r.pbVsSector.minPeers).toBe(5);
  });
  test('database error throws DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '08006' } });
    await expect(getSignalRules(f.db)).rejects.toBeInstanceOf(DataError);
  });
});

describe('saveAppSettings', () => {
  test('reads first, then upserts the merged payload', async () => {
    const f = createFake();
    f.respond({ data: fullRow });
    f.respond({ data: fullRow });
    await saveAppSettings(f.db, input);
    expect(f.calls.map((c) => c.method).slice(0, 5)).toEqual(['select', 'eq', 'maybeSingle', 'upsert', 'select']);
    const call = f.methods('upsert')[0];
    expect(call?.args[1]).toEqual({ onConflict: 'id' });
    expect(call?.args[0]).toMatchObject({
      concentration_threshold_ppm: 250000,
      fee_rate_ppm: null,
      holidays: ['2026-01-01'],
      dividend_withholding_rate_ppm: 50000,
      rule_configs: { signals: { a: 1 }, market: { lotSize: 10 } },
    });
  });
  test('save then read round trip gives the saved lot size', async () => {
    const f = createFake();
    f.respond({ data: null });
    f.respond({ data: fullRow });
    await saveAppSettings(f.db, { ...input, lotSize: 10 });
    const saved = (f.methods('upsert')[0]?.args[0] as { rule_configs: unknown }).rule_configs;
    const g = createFake();
    g.respond({ data: { rule_configs: saved } });
    expect((await getMarketRules(g.db)).lotSize).toBe(10);
  });
});

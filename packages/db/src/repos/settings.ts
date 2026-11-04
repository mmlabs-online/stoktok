import {
  DEFAULT_MARKET_SETTINGS,
  RowMappingError,
  appSettingsFromRow,
  effectiveHolidays,
  parseMarketRules,
  parseSignalRules,
  settingsFromRow,
  settingsInputToRow,
  settingsToRow,
  toSafeInt,
} from '@stoktok/core';
import type {
  AppSettings,
  LedgerSettings,
  MarketRules,
  SettingsFullRow,
  SettingsInput,
  SettingsRow,
  SignalRules,
} from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap, unwrapFound } from '../errors';

const COLS =
  'id,fee_rate_ppm,sell_tax_rate_ppm,dividend_withholding_rate_ppm,settlement_days,holidays,cash_dividend_treatment,cost_method';

function toSettings(row: SettingsRow, ctx: { table: string; op: string }): LedgerSettings {
  try {
    return mapRow(settingsFromRow, row, ctx);
  } catch (e) {
    const cause = e instanceof DataError ? e.cause : undefined;
    if (cause instanceof RowMappingError && cause.field === 'fee_rate_ppm') {
      throw new DataError('NOT_CONFIGURED', ctx.table, ctx.op, 'fee rate is not set', undefined, { cause });
    }
    throw e;
  }
}

/** The seeded exchange calendar plus the stored dates (STK-046). Only read paths use it; saves stay raw. */
function withEffectiveHolidays(s: LedgerSettings): LedgerSettings {
  return { ...s, holidays: effectiveHolidays(s.holidays) };
}

export async function getSettings(db: Db): Promise<LedgerSettings> {
  const ctx = { table: 'settings', op: 'get' };
  let row: SettingsRow;
  try {
    row = unwrapFound<SettingsRow>(await db.from('settings').select(COLS).eq('id', 1).maybeSingle(), ctx);
  } catch (e) {
    if (e instanceof DataError && e.code === 'NOT_FOUND') {
      throw new DataError('NOT_CONFIGURED', ctx.table, ctx.op, 'settings row missing', undefined, { cause: e });
    }
    throw e;
  }
  return withEffectiveHolidays(toSettings(row, ctx));
}

/**
 * Settings for entry validation. Never throws NOT_CONFIGURED: while the fee rate is unset the
 * ledger replay still works (fees do not affect quantities), and the caller asks for manual fees.
 */
export async function getEntrySettings(db: Db): Promise<{ settings: LedgerSettings; feeRateConfigured: boolean }> {
  const ctx = { table: 'settings', op: 'get' };
  let row: SettingsRow;
  try {
    row = unwrapFound<SettingsRow>(await db.from('settings').select(COLS).eq('id', 1).maybeSingle(), ctx);
  } catch (e) {
    if (e instanceof DataError && e.code === 'NOT_FOUND') {
      return { settings: withEffectiveHolidays({ ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0 }), feeRateConfigured: false };
    }
    throw e;
  }
  if (row.fee_rate_ppm === null) {
    return { settings: withEffectiveHolidays(mapRow(settingsFromRow, { ...row, fee_rate_ppm: 0 }, ctx)), feeRateConfigured: false };
  }
  return { settings: withEffectiveHolidays(mapRow(settingsFromRow, row, ctx)), feeRateConfigured: true };
}

export async function saveSettings(
  db: Db,
  s: Omit<LedgerSettings, 'feeRatePpm'> & { feeRatePpm: number | null },
): Promise<LedgerSettings> {
  const ctx = { table: 'settings', op: 'save' };
  const row = unwrap<SettingsRow>(await db.from('settings').upsert(settingsToRow(s), { onConflict: 'id' }).select(COLS).single(), ctx);
  return toSettings(row, ctx);
}

/**
 * Separate from getSettings so the ledger settings path and saveSettings stay unchanged.
 * Returns null when the row is missing or the threshold is unset (the caller applies the default, R5).
 */
export async function getConcentrationThreshold(db: Db): Promise<number | null> {
  const ctx = { table: 'settings', op: 'get' };
  const res = await db.from('settings').select('concentration_threshold_ppm').eq('id', 1).maybeSingle();
  if (!res.error && res.data === null) return null;
  const row = unwrap<{ concentration_threshold_ppm: number | null }>(res, ctx);
  return row.concentration_threshold_ppm === null ? null : toSafeInt(row.concentration_threshold_ppm, 'concentration_threshold_ppm', ctx.table);
}

const FULL_COLS = `${COLS},concentration_threshold_ppm,rule_configs`;

/** Settings for the settings screen. Never throws NOT_CONFIGURED: no row gives the core defaults. */
export async function getAppSettings(db: Db): Promise<{ settings: AppSettings; source: 'default' | 'stored' }> {
  const ctx = { table: 'settings', op: 'get' };
  const res = await db.from('settings').select(FULL_COLS).eq('id', 1).maybeSingle();
  if (!res.error && res.data === null) return { settings: appSettingsFromRow(null), source: 'default' };
  const row = unwrap<SettingsFullRow>(res, ctx);
  return { settings: mapRow(appSettingsFromRow, row, ctx), source: 'stored' };
}

/** Market rules (lot size, price limits) from settings.rule_configs; no row gives the core defaults (R5). */
export async function getMarketRules(db: Db): Promise<MarketRules> {
  const ctx = { table: 'settings', op: 'get' };
  const res = await db.from('settings').select('rule_configs').eq('id', 1).maybeSingle();
  if (!res.error && res.data === null) return parseMarketRules(null);
  const row = unwrap<{ rule_configs: unknown }>(res, ctx);
  return parseMarketRules(row.rule_configs);
}

/** Medium-term signal rules from settings.rule_configs.signals; no row gives the core defaults (R5). */
export async function getSignalRules(db: Db): Promise<SignalRules> {
  const ctx = { table: 'settings', op: 'get' };
  const res = await db.from('settings').select('rule_configs').eq('id', 1).maybeSingle();
  if (!res.error && res.data === null) return parseSignalRules(null);
  const row = unwrap<{ rule_configs: unknown }>(res, ctx);
  return parseSignalRules(row.rule_configs);
}

/**
 * Saves the settings form. Read-modify-write so withholding, holidays and other rule_configs keys
 * are kept; not atomic, acceptable for a single user.
 */
export async function saveAppSettings(db: Db, input: SettingsInput): Promise<AppSettings> {
  const ctx = { table: 'settings', op: 'save' };
  const current = await db.from('settings').select(FULL_COLS).eq('id', 1).maybeSingle();
  const existing = !current.error && current.data === null ? null : unwrap<SettingsFullRow>(current, ctx);
  const row = unwrap<SettingsFullRow>(
    await db.from('settings').upsert(settingsInputToRow(input, existing), { onConflict: 'id' }).select(FULL_COLS).single(),
    ctx,
  );
  return mapRow(appSettingsFromRow, row, ctx);
}

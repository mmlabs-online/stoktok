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
import { DataError, mapRow, type Ctx } from '../errors';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { jsonb, upsertInto } from '../pg/upsert';

const COLS = [
  'id',
  'fee_rate_ppm',
  'sell_tax_rate_ppm',
  'dividend_withholding_rate_ppm',
  'settlement_days',
  'holidays',
  'cash_dividend_treatment',
  'cost_method',
] as const;
const FULL_COLS = [...COLS, 'concentration_threshold_ppm', 'rule_configs'] as const;

function toSettings(row: SettingsRow, ctx: Ctx): LedgerSettings {
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

const readRow = (db: PgDb, ctx: Ctx) =>
  q(db, ctx, (k) => k.selectFrom('settings').select(COLS).where('id', '=', 1).executeTakeFirst());

const readFullRow = (db: PgDb, ctx: Ctx) =>
  q(db, ctx, (k) => k.selectFrom('settings').select(FULL_COLS).where('id', '=', 1).executeTakeFirst());

export async function getSettings(db: PgDb): Promise<LedgerSettings> {
  const ctx = { table: 'settings', op: 'get' };
  const row = await readRow(db, ctx);
  if (row === undefined) throw new DataError('NOT_CONFIGURED', ctx.table, ctx.op, 'settings row missing');
  return withEffectiveHolidays(toSettings(row as SettingsRow, ctx));
}

/**
 * Settings for entry validation. Never throws NOT_CONFIGURED: while the fee rate is unset the
 * ledger replay still works (fees do not affect quantities), and the caller asks for manual fees.
 */
export async function getEntrySettings(db: PgDb): Promise<{ settings: LedgerSettings; feeRateConfigured: boolean }> {
  const ctx = { table: 'settings', op: 'get' };
  const row = (await readRow(db, ctx)) as SettingsRow | undefined;
  if (row === undefined) {
    return { settings: withEffectiveHolidays({ ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0 }), feeRateConfigured: false };
  }
  if (row.fee_rate_ppm === null) {
    return { settings: withEffectiveHolidays(mapRow(settingsFromRow, { ...row, fee_rate_ppm: 0 }, ctx)), feeRateConfigured: false };
  }
  return { settings: withEffectiveHolidays(mapRow(settingsFromRow, row, ctx)), feeRateConfigured: true };
}

export async function saveSettings(
  db: PgDb,
  s: Omit<LedgerSettings, 'feeRatePpm'> & { feeRatePpm: number | null },
): Promise<LedgerSettings> {
  const ctx = { table: 'settings', op: 'save' };
  const values = settingsToRow(s);
  const row = await q(db, ctx, (k) => upsertInto(k, 'settings', [values], ['id']).returning(COLS).executeTakeFirstOrThrow());
  return toSettings(row as SettingsRow, ctx);
}

/**
 * Separate from getSettings so the ledger settings path and saveSettings stay unchanged.
 * Returns null when the row is missing or the threshold is unset (the caller applies the default, R5).
 */
export async function getConcentrationThreshold(db: PgDb): Promise<number | null> {
  const ctx = { table: 'settings', op: 'get' };
  const row = await q(db, ctx, (k) => k.selectFrom('settings').select('concentration_threshold_ppm').where('id', '=', 1).executeTakeFirst());
  if (row === undefined || row.concentration_threshold_ppm === null) return null;
  return toSafeInt(row.concentration_threshold_ppm, 'concentration_threshold_ppm', ctx.table);
}

/** Settings for the settings screen. Never throws NOT_CONFIGURED: no row gives the core defaults. */
export async function getAppSettings(db: PgDb): Promise<{ settings: AppSettings; source: 'default' | 'stored' }> {
  const ctx = { table: 'settings', op: 'get' };
  const row = await readFullRow(db, ctx);
  if (row === undefined) return { settings: appSettingsFromRow(null), source: 'default' };
  return { settings: mapRow(appSettingsFromRow, row as SettingsFullRow, ctx), source: 'stored' };
}

/** Market rules (lot size, price limits) from settings.rule_configs; no row gives the core defaults (R5). */
export async function getMarketRules(db: PgDb): Promise<MarketRules> {
  const ctx = { table: 'settings', op: 'get' };
  const row = await q(db, ctx, (k) => k.selectFrom('settings').select('rule_configs').where('id', '=', 1).executeTakeFirst());
  return parseMarketRules(row === undefined ? null : row.rule_configs);
}

/** Medium-term signal rules from settings.rule_configs.signals; no row gives the core defaults (R5). */
export async function getSignalRules(db: PgDb): Promise<SignalRules> {
  const ctx = { table: 'settings', op: 'get' };
  const row = await q(db, ctx, (k) => k.selectFrom('settings').select('rule_configs').where('id', '=', 1).executeTakeFirst());
  return parseSignalRules(row === undefined ? null : row.rule_configs);
}

/**
 * Saves the settings form. Read-modify-write so withholding, cost method and other rule_configs keys
 * are kept (holidays come from the input); not atomic, acceptable for a single user.
 */
export async function saveAppSettings(db: PgDb, input: SettingsInput): Promise<AppSettings> {
  const ctx = { table: 'settings', op: 'save' };
  const existing = ((await readFullRow(db, ctx)) as SettingsFullRow | undefined) ?? null;
  const values = settingsInputToRow(input, existing);
  const saved = await q(db, ctx, (k) =>
    upsertInto(k, 'settings', [{ ...values, rule_configs: jsonb(values.rule_configs) }], ['id']).returning(FULL_COLS).executeTakeFirstOrThrow(),
  );
  return mapRow(appSettingsFromRow, saved as SettingsFullRow, ctx);
}

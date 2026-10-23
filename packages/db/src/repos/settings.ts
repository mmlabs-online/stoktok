import { DEFAULT_MARKET_SETTINGS, RowMappingError, settingsFromRow, settingsToRow, toSafeInt } from '@stoktok/core';
import type { LedgerSettings, SettingsRow } from '@stoktok/core';
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
  return toSettings(row, ctx);
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
      return { settings: { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0 }, feeRateConfigured: false };
    }
    throw e;
  }
  if (row.fee_rate_ppm === null) {
    return { settings: mapRow(settingsFromRow, { ...row, fee_rate_ppm: 0 }, ctx), feeRateConfigured: false };
  }
  return { settings: mapRow(settingsFromRow, row, ctx), feeRateConfigured: true };
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

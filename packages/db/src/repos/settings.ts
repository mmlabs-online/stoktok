import { RowMappingError, settingsFromRow, settingsToRow } from '@stoktok/core';
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

export async function saveSettings(
  db: Db,
  s: Omit<LedgerSettings, 'feeRatePpm'> & { feeRatePpm: number | null },
): Promise<LedgerSettings> {
  const ctx = { table: 'settings', op: 'save' };
  const row = unwrap<SettingsRow>(await db.from('settings').upsert(settingsToRow(s), { onConflict: 'id' }).select(COLS).single(), ctx);
  return toSettings(row, ctx);
}

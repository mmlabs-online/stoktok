import { randomUUID } from 'node:crypto';
import { corporateActionFromRow, corporateActionToRow, toSafeInt } from '@stoktok/core';
import type { CorporateAction, CorporateActionRow } from '@stoktok/core';
import { DataError, found, mapRow } from '../errors';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';

/** corporateActionToRow types the amount as Int8 (it only ever holds a number); the table takes number | string. */
function writable(row: CorporateActionRow) {
  return { ...row, amount_per_share: row.amount_per_share === null ? null : toSafeInt(row.amount_per_share, 'amount_per_share', 'corporate_actions') };
}

const COLS = ['id', 'symbol', 'type', 'ex_date', 'record_date', 'pay_date', 'listing_date', 'amount_per_share', 'ratio_num', 'ratio_den'] as const;

export async function listCorporateActions(db: PgDb, opts: { symbol?: string; symbols?: readonly string[] } = {}): Promise<CorporateAction[]> {
  if (opts.symbols?.length === 0) return [];
  const ctx = { table: 'corporate_actions', op: 'list' };
  const rows = await q(db, ctx, (k) => {
    let b = k.selectFrom('corporate_actions').select(COLS);
    if (opts.symbol !== undefined) b = b.where('symbol', '=', opts.symbol);
    if (opts.symbols !== undefined) b = b.where('symbol', 'in', [...opts.symbols]);
    return b.orderBy('ex_date', 'asc').orderBy('symbol', 'asc').orderBy('id', 'asc').execute();
  });
  return rows.map((r) => mapRow(corporateActionFromRow, r as CorporateActionRow, ctx));
}

export async function createCorporateAction(
  db: PgDb,
  action: DistributiveOmit<CorporateAction, 'id'>,
  meta: { recordDate?: string } = {},
): Promise<CorporateAction> {
  const ctx = { table: 'corporate_actions', op: 'create' };
  const values = writable(corporateActionToRow({ ...action, id: randomUUID() } as CorporateAction, meta));
  const row = await q(db, ctx, (k) => k.insertInto('corporate_actions').values(values).returning(COLS).executeTakeFirstOrThrow());
  return mapRow(corporateActionFromRow, row as CorporateActionRow, ctx);
}

/** Full replace: omitting `meta.recordDate` clears record_date. */
export async function updateCorporateAction(
  db: PgDb,
  id: string,
  action: DistributiveOmit<CorporateAction, 'id'>,
  meta: { recordDate?: string } = {},
): Promise<CorporateAction> {
  const ctx = { table: 'corporate_actions', op: 'update' };
  const { id: _id, ...fields } = writable(corporateActionToRow({ ...action, id } as CorporateAction, meta));
  void _id;
  const row = await q(db, ctx, (k) => k.updateTable('corporate_actions').set(fields).where('id', '=', id).returning(COLS).executeTakeFirst());
  return mapRow(corporateActionFromRow, found(row, ctx) as CorporateActionRow, ctx);
}

export async function deleteCorporateAction(db: PgDb, id: string): Promise<void> {
  const ctx = { table: 'corporate_actions', op: 'delete' };
  const rows = await q(db, ctx, (k) => k.deleteFrom('corporate_actions').where('id', '=', id).returning('id').execute());
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

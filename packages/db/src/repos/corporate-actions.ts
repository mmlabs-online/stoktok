import { randomUUID } from 'node:crypto';
import { corporateActionFromRow, corporateActionToRow } from '@stoktok/core';
import type { CorporateAction, CorporateActionRow } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, fetchAll, mapRow, unwrap, unwrapFound } from '../errors';

const COLS = 'id,symbol,type,ex_date,record_date,pay_date,listing_date,amount_per_share,ratio_num,ratio_den';

export async function listCorporateActions(db: Db, opts: { symbol?: string } = {}): Promise<CorporateAction[]> {
  const ctx = { table: 'corporate_actions', op: 'list' };
  const rows = await fetchAll<CorporateActionRow>((from, to) => {
    let q = db.from('corporate_actions').select(COLS);
    if (opts.symbol !== undefined) q = q.eq('symbol', opts.symbol);
    return q
      .order('ex_date', { ascending: true })
      .order('symbol', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
  }, ctx);
  return rows.map((r) => mapRow(corporateActionFromRow, r, ctx));
}

export async function createCorporateAction(
  db: Db,
  action: DistributiveOmit<CorporateAction, 'id'>,
  meta: { recordDate?: string } = {},
): Promise<CorporateAction> {
  const ctx = { table: 'corporate_actions', op: 'create' };
  const row = unwrap<CorporateActionRow>(
    await db
      .from('corporate_actions')
      .insert(corporateActionToRow({ ...action, id: randomUUID() } as CorporateAction, meta))
      .select(COLS)
      .single(),
    ctx,
  );
  return mapRow(corporateActionFromRow, row, ctx);
}

/** Full replace: omitting `meta.recordDate` clears record_date. */
export async function updateCorporateAction(
  db: Db,
  id: string,
  action: DistributiveOmit<CorporateAction, 'id'>,
  meta: { recordDate?: string } = {},
): Promise<CorporateAction> {
  const ctx = { table: 'corporate_actions', op: 'update' };
  const { id: _id, ...fields } = corporateActionToRow({ ...action, id } as CorporateAction, meta);
  void _id;
  const row = unwrapFound<CorporateActionRow>(
    await db.from('corporate_actions').update(fields).eq('id', id).select(COLS).maybeSingle(),
    ctx,
  );
  return mapRow(corporateActionFromRow, row, ctx);
}

export async function deleteCorporateAction(db: Db, id: string): Promise<void> {
  const ctx = { table: 'corporate_actions', op: 'delete' };
  const rows = unwrap<unknown[]>(await db.from('corporate_actions').delete().eq('id', id).select('id'), ctx);
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

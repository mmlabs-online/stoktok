import type { Db } from '../client';
import { DataError, mapRow, unwrap, unwrapFound } from '../errors';
import { assetFromRow, assetToRow } from '../mappers';
import type { Asset } from '../mappers';
import type { AssetRow } from '../rows';

const COLS = 'id,type,name,value,as_of';

export async function listAssets(db: Db): Promise<Asset[]> {
  const ctx = { table: 'assets', op: 'list' };
  const rows = unwrap<AssetRow[]>(
    await db.from('assets').select(COLS).order('as_of', { ascending: false }).order('id', { ascending: true }),
    ctx,
  );
  return rows.map((r) => mapRow(assetFromRow, r, ctx));
}

export async function getAsset(db: Db, id: string): Promise<Asset> {
  const ctx = { table: 'assets', op: 'get' };
  const row = unwrapFound<AssetRow>(await db.from('assets').select(COLS).eq('id', id).maybeSingle(), ctx);
  return mapRow(assetFromRow, row, ctx);
}

export async function createAsset(db: Db, asset: Omit<Asset, 'id'>): Promise<Asset> {
  const ctx = { table: 'assets', op: 'create' };
  const row = unwrap<AssetRow>(await db.from('assets').insert(assetToRow(asset)).select(COLS).single(), ctx);
  return mapRow(assetFromRow, row, ctx);
}

export async function updateAsset(db: Db, id: string, asset: Omit<Asset, 'id'>): Promise<Asset> {
  const ctx = { table: 'assets', op: 'update' };
  const row = unwrapFound<AssetRow>(
    await db.from('assets').update(assetToRow(asset)).eq('id', id).select(COLS).maybeSingle(),
    ctx,
  );
  return mapRow(assetFromRow, row, ctx);
}

export async function deleteAsset(db: Db, id: string): Promise<void> {
  const ctx = { table: 'assets', op: 'delete' };
  const rows = unwrap<unknown[]>(await db.from('assets').delete().eq('id', id).select('id'), ctx);
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}

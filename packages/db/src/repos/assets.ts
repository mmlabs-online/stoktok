import { toSafeInt } from '@stoktok/core';
import { DataError, found, mapRow } from '../errors';
import { assetFromRow, assetToRow } from '../mappers';
import type { Asset } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import type { AssetRow } from '../rows';

/** assetToRow types value as Int8 (it only ever holds a number); the table takes number | string. */
function writable(asset: Omit<Asset, 'id'>) {
  const { value, ...rest } = assetToRow(asset);
  return { ...rest, value: toSafeInt(value, 'value', 'assets') };
}

const COLS = ['id', 'type', 'name', 'value', 'as_of'] as const;

export async function listAssets(db: PgDb): Promise<Asset[]> {
  const ctx = { table: 'assets', op: 'list' };
  const rows = await q(db, ctx, (k) => k.selectFrom('assets').select(COLS).orderBy('as_of', 'desc').orderBy('id', 'asc').execute());
  return rows.map((r) => mapRow(assetFromRow, r as AssetRow, ctx));
}

export async function getAsset(db: PgDb, id: string): Promise<Asset> {
  const ctx = { table: 'assets', op: 'get' };
  const row = await q(db, ctx, (k) => k.selectFrom('assets').select(COLS).where('id', '=', id).executeTakeFirst());
  return mapRow(assetFromRow, found(row, ctx) as AssetRow, ctx);
}

export async function createAsset(db: PgDb, asset: Omit<Asset, 'id'>): Promise<Asset> {
  const ctx = { table: 'assets', op: 'create' };
  const values = writable(asset);
  const row = await q(db, ctx, (k) => k.insertInto('assets').values(values).returning(COLS).executeTakeFirstOrThrow());
  return mapRow(assetFromRow, row as AssetRow, ctx);
}

export async function updateAsset(db: PgDb, id: string, asset: Omit<Asset, 'id'>): Promise<Asset> {
  const ctx = { table: 'assets', op: 'update' };
  const values = writable(asset);
  const row = await q(db, ctx, (k) => k.updateTable('assets').set(values).where('id', '=', id).returning(COLS).executeTakeFirst());
  return mapRow(assetFromRow, found(row, ctx) as AssetRow, ctx);
}

export async function deleteAsset(db: PgDb, id: string): Promise<void> {
  const ctx = { table: 'assets', op: 'delete' };
  const rows = await q(db, ctx, (k) => k.deleteFrom('assets').where('id', '=', id).returning('id').execute());
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}

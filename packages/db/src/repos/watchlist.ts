import { DataError, mapRow } from '../errors';
import { watchlistFromRow } from '../mappers';
import type { WatchlistEntry } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import type { WatchlistRow } from '../rows';

const COLS = ['symbol', 'group_name', 'added_at'] as const;

export async function listWatchlist(db: PgDb): Promise<WatchlistEntry[]> {
  const ctx = { table: 'watchlist', op: 'list' };
  const rows = await q(db, ctx, (k) => k.selectFrom('watchlist').select(COLS).orderBy('symbol', 'asc').execute());
  return rows.map((r) => mapRow(watchlistFromRow, r as WatchlistRow, ctx));
}

/** group_name comes from the DB default. A duplicate symbol is CONFLICT. */
export async function addToWatchlist(db: PgDb, symbol: string): Promise<WatchlistEntry> {
  const ctx = { table: 'watchlist', op: 'add' };
  const row = await q(db, ctx, (k) => k.insertInto('watchlist').values({ symbol }).returning(COLS).executeTakeFirstOrThrow());
  return mapRow(watchlistFromRow, row as WatchlistRow, ctx);
}

export async function removeFromWatchlist(db: PgDb, symbol: string): Promise<void> {
  const ctx = { table: 'watchlist', op: 'remove' };
  const rows = await q(db, ctx, (k) => k.deleteFrom('watchlist').where('symbol', '=', symbol).returning('symbol').execute());
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}

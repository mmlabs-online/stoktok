import type { Db } from '../client';
import { DataError, mapRow, unwrap } from '../errors';
import { watchlistFromRow } from '../mappers';
import type { WatchlistEntry } from '../mappers';
import type { WatchlistRow } from '../rows';

const COLS = 'symbol,group_name,added_at';

export async function listWatchlist(db: Db): Promise<WatchlistEntry[]> {
  const ctx = { table: 'watchlist', op: 'list' };
  const rows = unwrap<WatchlistRow[]>(await db.from('watchlist').select(COLS).order('symbol', { ascending: true }), ctx);
  return rows.map((r) => mapRow(watchlistFromRow, r, ctx));
}

/** group_name comes from the DB default. A duplicate symbol is CONFLICT. */
export async function addToWatchlist(db: Db, symbol: string): Promise<WatchlistEntry> {
  const ctx = { table: 'watchlist', op: 'add' };
  const row = unwrap<WatchlistRow>(await db.from('watchlist').insert({ symbol }).select(COLS).single(), ctx);
  return mapRow(watchlistFromRow, row, ctx);
}

export async function removeFromWatchlist(db: Db, symbol: string): Promise<void> {
  const ctx = { table: 'watchlist', op: 'remove' };
  const rows = unwrap<unknown[]>(await db.from('watchlist').delete().eq('symbol', symbol).select('symbol'), ctx);
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}

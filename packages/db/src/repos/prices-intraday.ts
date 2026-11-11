import type { IntradayQuote } from '@stoktok/core';
import { mapRow } from '../errors';
import { intradayQuoteFromRow } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { PG_FANOUT_CONCURRENCY } from '../pg/config';
import { mapLimit } from '../pg/fanout';
import { pickRows, upsertChunked } from '../pg/upsert';
import type { PriceIntradayInsert, PriceIntradayRow } from '../rows';

const COLS = ['symbol', 'ts', 'price', 'volume', 'source', 'fetched_at'] as const;

/** Newest stored intraday quote per symbol; symbols without a row are omitted. One query per symbol. */
export async function getLatestIntraday(db: PgDb, symbols: readonly string[]): Promise<Record<string, IntradayQuote>> {
  const ctx = { table: 'prices_intraday', op: 'latest' };
  const rows = await mapLimit(symbols, PG_FANOUT_CONCURRENCY, (symbol) =>
    q(db, ctx, (k) => k.selectFrom('prices_intraday').select(COLS).where('symbol', '=', symbol).orderBy('ts', 'desc').limit(1).executeTakeFirst()),
  );
  const out: Record<string, IntradayQuote> = {};
  for (const row of rows) {
    if (row) out[row.symbol] = mapRow(intradayQuoteFromRow, row as PriceIntradayRow, ctx);
  }
  return out;
}

/**
 * Idempotent last-write-wins upsert on (symbol, ts); a later duplicate in the input wins. Chunks run in one
 * transaction. Returns the number of unique rows written.
 */
export async function upsertPricesIntraday(
  db: PgDb,
  rows: readonly PriceIntradayInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'prices_intraday', op: 'upsert' };
  const byKey = new Map<string, PriceIntradayInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.ts}`, row);
  const unique = [...byKey.values()];
  await upsertChunked(db, ctx, 'prices_intraday', pickRows(unique, COLS), ['symbol', 'ts'], chunkSize);
  return unique.length;
}

import type { PriceQuote, StoredClose } from '@stoktok/core';
import { mapRow } from '../errors';
import { priceQuoteFromRow, storedCloseFromRow, tradeDateFromRow } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { PG_FANOUT_CONCURRENCY } from '../pg/config';
import { mapLimit } from '../pg/fanout';
import { pickRows, upsertChunked } from '../pg/upsert';
import type { PriceCloseRow, PriceDailyInsert, PriceDailyRow, TradeDateRow } from '../rows';

const COLS = ['symbol', 'trade_date', 'close', 'source', 'fetched_at'] as const;
const CLOSE_COLS = [...COLS, 'volume'] as const;
const INSERT_COLS = ['symbol', 'trade_date', 'open', 'high', 'low', 'close', 'volume', 'foreign_net', 'source', 'fetched_at'] as const;

/** Latest stored close per symbol; symbols without a row are omitted. One query per symbol. */
export async function getLatestCloses(db: PgDb, symbols: readonly string[]): Promise<Record<string, PriceQuote>> {
  const ctx = { table: 'prices_daily', op: 'latest' };
  const rows = await mapLimit(symbols, PG_FANOUT_CONCURRENCY, (symbol) =>
    q(db, ctx, (k) => k.selectFrom('prices_daily').select(COLS).where('symbol', '=', symbol).orderBy('trade_date', 'desc').limit(1).executeTakeFirst()),
  );
  const out: Record<string, PriceQuote> = {};
  for (const row of rows) {
    if (row) out[row.symbol] = mapRow(priceQuoteFromRow, row as PriceDailyRow, ctx);
  }
  return out;
}

/** Stored trade dates of one symbol in [from, to], ascending. */
export async function listPriceDates(db: PgDb, symbol: string, from: string, to: string): Promise<string[]> {
  const ctx = { table: 'prices_daily', op: 'list_dates' };
  const rows = await q(db, ctx, (k) =>
    k
      .selectFrom('prices_daily')
      .select('trade_date')
      .where('symbol', '=', symbol)
      .where('trade_date', '>=', from)
      .where('trade_date', '<=', to)
      .orderBy('trade_date', 'asc')
      .execute(),
  );
  return rows.map((r) => mapRow(tradeDateFromRow, r as TradeDateRow, ctx));
}

/** Stored closes (with volume) of one symbol in [from, to], **ascending** (unlike `getRecentCloses`). */
export async function listCloseHistory(db: PgDb, symbol: string, from: string, to: string): Promise<StoredClose[]> {
  const ctx = { table: 'prices_daily', op: 'list_history' };
  const rows = await q(db, ctx, (k) =>
    k
      .selectFrom('prices_daily')
      .select(CLOSE_COLS)
      .where('symbol', '=', symbol)
      .where('trade_date', '>=', from)
      .where('trade_date', '<=', to)
      .orderBy('trade_date', 'asc')
      .execute(),
  );
  return rows.map((r) => mapRow(storedCloseFromRow, r as PriceCloseRow, ctx));
}

/** Earliest stored trade date per symbol; symbols without a row are omitted. One query per symbol. */
export async function getFirstPriceDates(db: PgDb, symbols: readonly string[]): Promise<Record<string, string>> {
  const ctx = { table: 'prices_daily', op: 'first_date' };
  const rows = await mapLimit(symbols, PG_FANOUT_CONCURRENCY, async (symbol) => ({
    symbol,
    row: await q(db, ctx, (k) => k.selectFrom('prices_daily').select('trade_date').where('symbol', '=', symbol).orderBy('trade_date', 'asc').limit(1).executeTakeFirst()),
  }));
  const out: Record<string, string> = {};
  for (const { symbol, row } of rows) {
    if (row) out[symbol] = mapRow(tradeDateFromRow, row as TradeDateRow, ctx);
  }
  return out;
}

/** Last `n` stored closes per symbol, newest first, with volume. One query per symbol; no row gives []. */
export async function getRecentCloses(db: PgDb, symbols: readonly string[], n = 2): Promise<Record<string, StoredClose[]>> {
  const ctx = { table: 'prices_daily', op: 'recent' };
  const perSymbol = await mapLimit(symbols, PG_FANOUT_CONCURRENCY, async (symbol) => ({
    symbol,
    rows: await q(db, ctx, (k) => k.selectFrom('prices_daily').select(CLOSE_COLS).where('symbol', '=', symbol).orderBy('trade_date', 'desc').limit(n).execute()),
  }));
  const out: Record<string, StoredClose[]> = {};
  for (const { symbol, rows } of perSymbol) out[symbol] = rows.map((r) => mapRow(storedCloseFromRow, r as PriceCloseRow, ctx));
  return out;
}

/**
 * Idempotent upsert on (symbol, trade_date); a later duplicate in the input wins. Chunks run in one transaction.
 * Returns the number of unique rows written.
 */
export async function upsertPricesDaily(
  db: PgDb,
  rows: readonly PriceDailyInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'prices_daily', op: 'upsert' };
  const byKey = new Map<string, PriceDailyInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.trade_date}`, row);
  const unique = [...byKey.values()];
  await upsertChunked(db, ctx, 'prices_daily', pickRows(unique, INSERT_COLS), ['symbol', 'trade_date'], chunkSize);
  return unique.length;
}

import type { PriceQuote } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap, unwrapFound } from '../errors';
import { priceQuoteFromRow } from '../mappers';
import type { PriceDailyInsert, PriceDailyRow } from '../rows';

const COLS = 'symbol,trade_date,close,source,fetched_at';

/** Latest stored close per symbol; symbols without a row are omitted. One query per symbol. */
export async function getLatestCloses(db: Db, symbols: readonly string[]): Promise<Record<string, PriceQuote>> {
  const ctx = { table: 'prices_daily', op: 'latest' };
  const rows = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return unwrapFound<PriceDailyRow>(
          await db.from('prices_daily').select(COLS).eq('symbol', symbol).order('trade_date', { ascending: false }).limit(1).maybeSingle(),
          ctx,
        );
      } catch (e) {
        if (e instanceof DataError && e.code === 'NOT_FOUND') return null;
        throw e;
      }
    }),
  );
  const out: Record<string, PriceQuote> = {};
  for (const row of rows) {
    if (row) out[row.symbol] = mapRow(priceQuoteFromRow, row, ctx);
  }
  return out;
}

/**
 * Idempotent upsert on (symbol, trade_date); a later duplicate in the input wins. Sequential chunks,
 * no `.select()` (supabase returns data: null on success). Returns the number of rows sent.
 */
export async function upsertPricesDaily(
  db: Db,
  rows: readonly PriceDailyInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'prices_daily', op: 'upsert' };
  const byKey = new Map<string, PriceDailyInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.trade_date}`, row);
  const unique = [...byKey.values()];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const res = await db.from('prices_daily').upsert(unique.slice(i, i + chunkSize), { onConflict: 'symbol,trade_date' });
    if (res.error) unwrap(res, ctx);
  }
  return unique.length;
}

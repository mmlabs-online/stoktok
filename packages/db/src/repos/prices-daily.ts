import type { PriceQuote } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrapFound } from '../errors';
import { priceQuoteFromRow } from '../mappers';
import type { PriceDailyRow } from '../rows';

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

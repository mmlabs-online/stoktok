import type { IntradayQuote } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap, unwrapFound } from '../errors';
import { intradayQuoteFromRow } from '../mappers';
import type { PriceIntradayInsert, PriceIntradayRow } from '../rows';

const COLS = 'symbol,ts,price,volume,source,fetched_at';

/** Newest stored intraday quote per symbol; symbols without a row are omitted. One query per symbol. */
export async function getLatestIntraday(db: Db, symbols: readonly string[]): Promise<Record<string, IntradayQuote>> {
  const ctx = { table: 'prices_intraday', op: 'latest' };
  const rows = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return unwrapFound<PriceIntradayRow>(
          await db.from('prices_intraday').select(COLS).eq('symbol', symbol).order('ts', { ascending: false }).limit(1).maybeSingle(),
          ctx,
        );
      } catch (e) {
        if (e instanceof DataError && e.code === 'NOT_FOUND') return null;
        throw e;
      }
    }),
  );
  const out: Record<string, IntradayQuote> = {};
  for (const row of rows) {
    if (row) out[row.symbol] = mapRow(intradayQuoteFromRow, row, ctx);
  }
  return out;
}

/**
 * Idempotent last-write-wins upsert on (symbol, ts); a later duplicate in the input wins. Sequential chunks,
 * no `.select()`. Returns the number of rows sent.
 */
export async function upsertPricesIntraday(
  db: Db,
  rows: readonly PriceIntradayInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'prices_intraday', op: 'upsert' };
  const byKey = new Map<string, PriceIntradayInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.ts}`, row);
  const unique = [...byKey.values()];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const res = await db.from('prices_intraday').upsert(unique.slice(i, i + chunkSize), { onConflict: 'symbol,ts' });
    if (res.error) unwrap(res, ctx);
  }
  return unique.length;
}

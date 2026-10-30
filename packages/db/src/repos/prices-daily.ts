import type { PriceQuote, StoredClose } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, fetchAll, mapRow, unwrap, unwrapFound } from '../errors';
import { priceQuoteFromRow, storedCloseFromRow, tradeDateFromRow } from '../mappers';
import type { PriceCloseRow, PriceDailyInsert, PriceDailyRow, TradeDateRow } from '../rows';

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

/** Stored trade dates of one symbol in [from, to], ascending. Paged with `.range()` to stay under the PostgREST row cap. */
export async function listPriceDates(
  db: Db,
  symbol: string,
  from: string,
  to: string,
  { pageSize = 1000 }: { pageSize?: number } = {},
): Promise<string[]> {
  const ctx = { table: 'prices_daily', op: 'list_dates' };
  const rows = await fetchAll<TradeDateRow>(
    (lo, hi) =>
      db
        .from('prices_daily')
        .select('trade_date')
        .eq('symbol', symbol)
        .gte('trade_date', from)
        .lte('trade_date', to)
        .order('trade_date', { ascending: true })
        .range(lo, hi),
    ctx,
    pageSize,
  );
  return rows.map((r) => mapRow(tradeDateFromRow, r, ctx));
}

/** Earliest stored trade date per symbol; symbols without a row are omitted. One query per symbol. */
export async function getFirstPriceDates(db: Db, symbols: readonly string[]): Promise<Record<string, string>> {
  const ctx = { table: 'prices_daily', op: 'first_date' };
  const out: Record<string, string> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const row = unwrapFound<TradeDateRow>(
          await db.from('prices_daily').select('trade_date').eq('symbol', symbol).order('trade_date', { ascending: true }).limit(1).maybeSingle(),
          ctx,
        );
        out[symbol] = mapRow(tradeDateFromRow, row, ctx);
      } catch (e) {
        if (e instanceof DataError && e.code === 'NOT_FOUND') return;
        throw e;
      }
    }),
  );
  return out;
}

/** Last `n` stored closes per symbol, newest first, with volume. One query per symbol; no row gives []. */
export async function getRecentCloses(
  db: Db,
  symbols: readonly string[],
  n = 2,
): Promise<Record<string, StoredClose[]>> {
  const ctx = { table: 'prices_daily', op: 'recent' };
  const out: Record<string, StoredClose[]> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const rows = unwrap<PriceCloseRow[]>(
        await db.from('prices_daily').select(`${COLS},volume`).eq('symbol', symbol).order('trade_date', { ascending: false }).limit(n),
        ctx,
      );
      out[symbol] = rows.map((r) => mapRow(storedCloseFromRow, r, ctx));
    }),
  );
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

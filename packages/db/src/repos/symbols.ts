import type { Exchange, SectorInfo } from '@stoktok/core';
import type { Db } from '../client';
import { mapRow, unwrap } from '../errors';
import { symbolExchangeFromRow, symbolSectorFromRow } from '../mappers';
import type { SymbolRow, SymbolSectorRow } from '../rows';

/** Exchange per symbol in one query; symbols without a row are omitted, null means unknown. */
export async function getSymbolExchanges(
  db: Db,
  symbols: readonly string[],
): Promise<Record<string, Exchange | null>> {
  if (symbols.length === 0) return {};
  const ctx = { table: 'symbols', op: 'get' };
  const rows = unwrap<SymbolRow[]>(await db.from('symbols').select('symbol,exchange').in('symbol', [...symbols]), ctx);
  const out: Record<string, Exchange | null> = {};
  for (const row of rows) out[row.symbol] = mapRow(symbolExchangeFromRow, row, ctx);
  return out;
}

/** Always overwrites; the caller decides when a blank must not wipe a known exchange. */
export async function setSymbolExchange(db: Db, symbol: string, exchange: Exchange | null): Promise<void> {
  const ctx = { table: 'symbols', op: 'set_exchange' };
  const res = await db
    .from('symbols')
    .upsert({ symbol, exchange, updated_at: new Date().toISOString() }, { onConflict: 'symbol' });
  if (res.error) unwrap(res, ctx);
}

/** Writes only the sector columns (never `exchange`); a new row gets exchange NULL = unknown. R4: source + fetched_at. */
export async function setSymbolSector(
  db: Db,
  symbol: string,
  { sector, source, fetchedAt }: { sector: string; source: string; fetchedAt: string },
): Promise<void> {
  const ctx = { table: 'symbols', op: 'set_sector' };
  const res = await db.from('symbols').upsert(
    { symbol, sector, sector_source: source, sector_fetched_at: fetchedAt, updated_at: new Date().toISOString() },
    { onConflict: 'symbol' },
  );
  if (res.error) unwrap(res, ctx);
}

/** Sector with provenance per symbol in one query; symbols without a row are omitted, sector null means unknown. */
export async function listSymbolSectors(db: Db, symbols: readonly string[]): Promise<Record<string, SectorInfo>> {
  if (symbols.length === 0) return {};
  const ctx = { table: 'symbols', op: 'list_sectors' };
  const rows = unwrap<SymbolSectorRow[]>(
    await db.from('symbols').select('symbol,sector,sector_source,sector_fetched_at').in('symbol', [...symbols]),
    ctx,
  );
  const out: Record<string, SectorInfo> = {};
  for (const row of rows) out[row.symbol] = mapRow(symbolSectorFromRow, row, ctx);
  return out;
}

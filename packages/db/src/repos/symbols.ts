import type { Exchange, SectorInfo } from '@stoktok/core';
import { mapRow } from '../errors';
import { symbolExchangeFromRow, symbolSectorFromRow } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { upsertInto } from '../pg/upsert';
import type { SymbolRow, SymbolSectorRow } from '../rows';

/** Exchange per symbol in one query; symbols without a row are omitted, null means unknown. */
export async function getSymbolExchanges(db: PgDb, symbols: readonly string[]): Promise<Record<string, Exchange | null>> {
  if (symbols.length === 0) return {};
  const ctx = { table: 'symbols', op: 'get' };
  const rows = await q(db, ctx, (k) => k.selectFrom('symbols').select(['symbol', 'exchange']).where('symbol', 'in', [...symbols]).execute());
  const out: Record<string, Exchange | null> = {};
  for (const row of rows) out[row.symbol] = mapRow(symbolExchangeFromRow, row as SymbolRow, ctx);
  return out;
}

/** Always overwrites; the caller decides when a blank must not wipe a known exchange. */
export async function setSymbolExchange(db: PgDb, symbol: string, exchange: Exchange | null): Promise<void> {
  const ctx = { table: 'symbols', op: 'set_exchange' };
  const row = { symbol, exchange, updated_at: new Date().toISOString() };
  await q(db, ctx, async (k) => {
    await upsertInto(k, 'symbols', [row], ['symbol']).execute();
  });
}

/** Writes only the sector columns (never `exchange`); a new row gets exchange NULL = unknown. R4: source + fetched_at. */
export async function setSymbolSector(
  db: PgDb,
  symbol: string,
  { sector, source, fetchedAt }: { sector: string; source: string; fetchedAt: string },
): Promise<void> {
  const ctx = { table: 'symbols', op: 'set_sector' };
  const row = { symbol, sector, sector_source: source, sector_fetched_at: fetchedAt, updated_at: new Date().toISOString() };
  await q(db, ctx, async (k) => {
    await upsertInto(k, 'symbols', [row], ['symbol']).execute();
  });
}

/** Sector with provenance per symbol in one query; symbols without a row are omitted, sector null means unknown. */
export async function listSymbolSectors(db: PgDb, symbols: readonly string[]): Promise<Record<string, SectorInfo>> {
  if (symbols.length === 0) return {};
  const ctx = { table: 'symbols', op: 'list_sectors' };
  const rows = await q(db, ctx, (k) =>
    k.selectFrom('symbols').select(['symbol', 'sector', 'sector_source', 'sector_fetched_at']).where('symbol', 'in', [...symbols]).execute(),
  );
  const out: Record<string, SectorInfo> = {};
  for (const row of rows) out[row.symbol] = mapRow(symbolSectorFromRow, row as SymbolSectorRow, ctx);
  return out;
}

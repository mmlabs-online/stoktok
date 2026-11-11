import type { GapResolvedReason } from '@stoktok/core';
import { sql } from 'kysely';
import { mapRow } from '../errors';
import { openGapFromRow } from '../mappers';
import type { OpenGapRecord } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { chunkRows, pickRows } from '../pg/upsert';
import type { DataGapInsert, OpenGapRow } from '../rows';

const COLS = ['id', 'symbol', 'from_ts', 'to_ts'] as const;
const INSERT_COLS = ['symbol', 'data_type', 'from_ts', 'to_ts', 'source', 'fetched_at'] as const;
/** Rows per insert statement. */
const INSERT_CHUNK_SIZE = 500;

/** Unresolved gaps of one data type for the symbols. Gaps are never deleted, only resolved. */
export async function listOpenGaps(db: PgDb, dataType: string, symbols: readonly string[]): Promise<OpenGapRecord[]> {
  if (symbols.length === 0) return [];
  const ctx = { table: 'data_gaps', op: 'list_open' };
  const rows = await q(db, ctx, (k) =>
    k.selectFrom('data_gaps').select(COLS).where('data_type', '=', dataType).where('symbol', 'in', [...symbols]).where('resolved_at', 'is', null).execute(),
  );
  return rows.map((r) => mapRow(openGapFromRow, r as OpenGapRow, ctx));
}

/** Unresolved market-wide gaps (symbol IS NULL) of one data type; `listOpenGaps` filters by symbol and misses them. */
export async function listOpenMarketGaps(db: PgDb, dataType: string): Promise<OpenGapRecord[]> {
  const ctx = { table: 'data_gaps', op: 'list_open_market' };
  const rows = await q(db, ctx, (k) =>
    k.selectFrom('data_gaps').select(COLS).where('data_type', '=', dataType).where('symbol', 'is', null).where('resolved_at', 'is', null).execute(),
  );
  return rows.map((r) => mapRow(openGapFromRow, r as OpenGapRow, ctx));
}

/** Every unresolved gap of one data type, any symbol (including NULL), in one select ordered by id. `source` narrows it to one source. */
export async function listAllOpenGaps(db: PgDb, dataType: string, opts: { source?: string } = {}): Promise<OpenGapRecord[]> {
  const ctx = { table: 'data_gaps', op: 'list_all_open' };
  const rows = await q(db, ctx, (k) => {
    let b = k.selectFrom('data_gaps').select(COLS).where('data_type', '=', dataType);
    if (opts.source !== undefined) b = b.where('source', '=', opts.source);
    return b.where('resolved_at', 'is', null).orderBy('id', 'asc').execute();
  });
  return rows.map((r) => mapRow(openGapFromRow, r as OpenGapRow, ctx));
}

/** Several chunks run in one transaction, so a failure leaves no partial insert. */
export async function insertGaps(db: PgDb, rows: readonly DataGapInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const ctx = { table: 'data_gaps', op: 'insert' };
  const chunks = chunkRows(pickRows(rows, INSERT_COLS), INSERT_CHUNK_SIZE);
  if (chunks.length === 1) {
    await q(db, ctx, async (k) => {
      await k.insertInto('data_gaps').values(chunks[0]!).execute();
    });
    return;
  }
  await q(db, ctx, (k) =>
    k.transaction().execute(async (trx) => {
      for (const chunk of chunks) await trx.insertInto('data_gaps').values(chunk).execute();
    }),
  );
}

/** Only unresolved rows: a rerun never overwrites an earlier resolved_at. `reason` is written only when given. */
export async function resolveGaps(db: PgDb, ids: readonly number[], resolvedAt: string, reason?: GapResolvedReason): Promise<void> {
  if (ids.length === 0) return;
  const patch = reason === undefined ? { resolved_at: resolvedAt } : { resolved_at: resolvedAt, resolved_reason: reason };
  await q(db, { table: 'data_gaps', op: 'resolve' }, async (k) => {
    await k.updateTable('data_gaps').set(patch).where(sql<boolean>`id = any(${[...ids]}::bigint[])`).where('resolved_at', 'is', null).execute();
  });
}

/** Moves the end of still-open gaps forward (a continuing outage is one row). Resolved rows are never touched. */
export async function extendGaps(db: PgDb, ids: readonly number[], toTs: string): Promise<void> {
  if (ids.length === 0) return;
  await q(db, { table: 'data_gaps', op: 'extend' }, async (k) => {
    await k.updateTable('data_gaps').set({ to_ts: toTs }).where(sql<boolean>`id = any(${[...ids]}::bigint[])`).where('resolved_at', 'is', null).execute();
  });
}

/** PostgREST-style upsert helpers over Kysely. Server-only (R3). */
import { sql, type Insertable, type InsertQueryBuilder, type Kysely, type RawBuilder } from 'kysely';
import type { Ctx } from '../errors';
import { q } from './access';
import type { PgDb } from './client';
import { PG_MAX_BIND_PARAMS } from './config';
import type { Database } from './schema';

export interface UpsertOptions {
  ignoreDuplicates?: boolean;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function keysOf(row: object): string[] {
  const keys = Object.entries(row)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
  for (const k of keys) if (!IDENT.test(k)) throw new Error(`upsert: invalid column name ${JSON.stringify(k)}`);
  return keys;
}

/**
 * `insert ... on conflict (cols) do update set <provided non-conflict columns> = excluded.<col>`.
 * Columns a row does not provide stay unchanged on conflict. Every row must provide the same columns (including
 * the conflict columns), else this is a programming error and throws a plain Error. The caller adds `.returning()`.
 * Two rows with the same conflict key in one batch fail in Postgres (21000): callers dedupe first.
 */
export function upsertInto<T extends keyof Database & string>(
  db: Kysely<Database>,
  table: T,
  rows: Insertable<Database[T]>[],
  conflict: readonly (keyof Database[T] & string)[],
  opts: UpsertOptions = {},
): InsertQueryBuilder<Database, T, unknown> {
  const first = rows[0];
  if (!first) throw new Error(`upsertInto ${table}: no rows`);
  const keys = keysOf(first);
  const sig = keys.join(',');
  if (rows.some((r) => keysOf(r).join(',') !== sig)) throw new Error(`upsertInto ${table}: rows have different columns`);
  for (const c of conflict) if (!keys.includes(c)) throw new Error(`upsertInto ${table}: conflict column ${c} is not in the rows`);
  const setCols = keys.filter((k) => !(conflict as readonly string[]).includes(k));
  const q = db.insertInto(table).values(rows as never);
  return q.onConflict((oc) => {
    const target = oc.columns(conflict as never);
    if (opts.ignoreDuplicates || setCols.length === 0) return target.doNothing();
    return target.doUpdateSet((eb) => Object.fromEntries(setCols.map((c) => [c, eb.ref(`excluded.${c}` as never)])) as never);
  });
}

/** Splits rows so each statement stays under the bind-parameter limit (floor(maxParams / columns) rows per chunk). */
export function chunkForParams<T extends object>(rows: readonly T[], maxParams = PG_MAX_BIND_PARAMS): T[][] {
  const first = rows[0];
  if (!first) return [];
  const per = Math.max(1, Math.floor(maxParams / Math.max(1, keysOf(first).length)));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

/** `chunkForParams`, then each chunk is sliced to at most `chunkSize` rows. */
export function chunkRows<T extends object>(rows: readonly T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  return chunkForParams(rows).flatMap((chunk) => {
    const out: T[][] = [];
    for (let i = 0; i < chunk.length; i += size) out.push(chunk.slice(i, i + size));
    return out;
  });
}

/**
 * Builds each row from exactly `cols`: `undefined` becomes `null` and extra properties are dropped, so every row
 * of a batch has the same columns (upsertInto requires that).
 */
export function pickRows<T extends object>(rows: readonly T[], cols: readonly (keyof T & string)[]): T[] {
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])) as T);
}

/**
 * Upserts `rows` in chunks. One chunk is one statement; several chunks run in one transaction so a later failure
 * rolls the earlier chunks back. Only `trx` is used inside the transaction.
 */
export async function upsertChunked<T extends keyof Database & string>(
  db: PgDb,
  ctx: Ctx,
  table: T,
  rows: Insertable<Database[T]>[],
  conflict: readonly (keyof Database[T] & string)[],
  chunkSize: number,
): Promise<void> {
  const chunks = chunkRows(rows, chunkSize);
  if (chunks.length === 0) return;
  if (chunks.length === 1) {
    await q(db, ctx, async (k) => {
      await upsertInto(k, table, chunks[0] as Insertable<Database[T]>[], conflict).execute();
    });
    return;
  }
  await q(db, ctx, (k) =>
    k.transaction().execute(async (trx) => {
      for (const chunk of chunks) await upsertInto(trx, table, chunk, conflict).execute();
    }),
  );
}

/** Stores a JS array or object as jsonb (a raw JS array would be sent as a PG array literal). */
export function jsonb(value: unknown): RawBuilder<unknown> {
  if (value === undefined) throw new Error('jsonb: value is undefined');
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** PostgREST-style upsert helpers over Kysely. Server-only (R3). */
import { sql, type Insertable, type InsertQueryBuilder, type Kysely, type RawBuilder } from 'kysely';
import { PG_MAX_BIND_PARAMS } from './config';
import type { Database } from './schema';

export interface UpsertOptions {
  ignoreDuplicates?: boolean;
}

function keysOf(row: object): string[] {
  return Object.entries(row)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
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

/** Stores a JS array or object as jsonb (a raw JS array would be sent as a PG array literal). */
export function jsonb(value: unknown): RawBuilder<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

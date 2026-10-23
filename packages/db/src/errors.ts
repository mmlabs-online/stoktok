import { RowMappingError } from '@stoktok/core';

export type DataErrorCode = 'DB_ERROR' | 'NOT_FOUND' | 'NOT_CONFIGURED' | 'CONFLICT' | 'VALIDATION' | 'MAPPING';

export interface Ctx {
  table: string;
  op: string;
}

/** Messages carry table, op and pg code only: never payloads, error details, the URL or the key. */
export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    readonly table: string,
    readonly op: string,
    text: string,
    readonly pgCode?: string,
    options?: { cause?: unknown },
  ) {
    super(`${table}.${op}: ${text}${pgCode ? ` [${pgCode}]` : ''}`, options);
    this.name = 'DataError';
  }
}

interface PgResult<T> {
  data: T | null;
  error: { code?: string } | null;
}

/** The caller states the row type: the untyped client does not infer it. */
export function unwrap<T>(res: PgResult<unknown>, ctx: Ctx): T {
  if (res.error) {
    const pg = res.error.code;
    if (pg === '23505') throw new DataError('CONFLICT', ctx.table, ctx.op, 'conflict', pg, { cause: res.error });
    if (pg === '23502' || pg === '23514' || pg === '22P02') {
      throw new DataError('VALIDATION', ctx.table, ctx.op, 'validation failed', pg, { cause: res.error });
    }
    throw new DataError('DB_ERROR', ctx.table, ctx.op, 'database error', pg, { cause: res.error });
  }
  if (res.data === null) throw new DataError('DB_ERROR', ctx.table, ctx.op, 'no data returned');
  return res.data as T;
}

/** For `.maybeSingle()` results: no row is NOT_FOUND. */
export function unwrapFound<T>(res: PgResult<unknown>, ctx: Ctx): T {
  if (!res.error && res.data === null) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
  return unwrap<T>(res, ctx);
}

/**
 * Loops `.range()` until a short page (PostgREST caps responses at max_rows).
 * Pages are separate requests and not snapshot-consistent; acceptable for a single user.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PgResult<T[]>>,
  ctx: Ctx,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const rows = unwrap<T[]>(await page(from, from + pageSize - 1), ctx);
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

export function mapRow<R, T>(fn: (row: R) => T, row: R, ctx: Ctx): T {
  try {
    return fn(row);
  } catch (e) {
    if (e instanceof RowMappingError) {
      throw new DataError('MAPPING', ctx.table, ctx.op, `row mapping failed (${e.field})`, undefined, { cause: e });
    }
    throw e;
  }
}

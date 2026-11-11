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

/** For `executeTakeFirst()` results: no row is NOT_FOUND. */
export function found<T>(row: T | undefined, ctx: Ctx): T {
  if (row === undefined) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
  return row;
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

/** A real SQLSTATE (five chars) or undefined. Node errno codes (EPIPE, ECONNRESET...) start with E and are not SQLSTATEs. */
export function sqlstateOf(e: unknown): string | undefined {
  const raw = (e as { code?: unknown } | null)?.code;
  return typeof raw === 'string' && /^[0-9A-Z]{5}$/.test(raw) && !/^E[A-Z]+$/.test(raw) ? raw : undefined;
}

/** Optional per-call override of the SQLSTATE to code mapping; consulted first. */
export type SqlstateMap = (sqlstate: string) => DataErrorCode | undefined;

const MAPPED_TEXT: Partial<Record<DataErrorCode, string>> = {
  VALIDATION: 'validation failed',
  CONFLICT: 'conflict',
  NOT_FOUND: 'not found',
};

/**
 * Maps a thrown driver error to a DataError. No cause is attached: pg's `detail`
 * echoes key values and Node net errors carry host and port.
 */
export function toDataError(e: unknown, ctx: Ctx, map?: SqlstateMap): DataError {
  if (e instanceof DataError) return e;
  if (e instanceof RowMappingError) {
    return new DataError('MAPPING', ctx.table, ctx.op, `row mapping failed (${e.field})`);
  }
  const pg = sqlstateOf(e);
  const mapped = pg ? map?.(pg) : undefined;
  if (mapped) return new DataError(mapped, ctx.table, ctx.op, MAPPED_TEXT[mapped] ?? 'database error', pg);
  if (pg === '23505') return new DataError('CONFLICT', ctx.table, ctx.op, 'conflict', pg);
  if (pg === '23502' || pg === '23514' || pg === '22P02') {
    return new DataError('VALIDATION', ctx.table, ctx.op, 'validation failed', pg);
  }
  return new DataError('DB_ERROR', ctx.table, ctx.op, 'database error', pg);
}

/** Runs a driver call and rethrows any failure as a DataError. */
export async function run<T>(ctx: Ctx, fn: () => Promise<T>, opts?: { map?: SqlstateMap }): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDataError(e, ctx, opts?.map);
  }
}

import 'server-only';
import { createServiceClient } from '@stoktok/db';
import type { Db } from '@stoktok/db';

let db: Db | undefined;

/**
 * The only web entry into the data layer (R3). Reads the service role key from process.env at runtime.
 * R6 is suspended: when it is restored, call requireUser() at the top of every caller of getDb().
 */
export function getDb(): Db {
  db ??= createServiceClient(process.env);
  return db;
}

export * from '@stoktok/db';

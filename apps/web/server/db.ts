import 'server-only';
import { createServiceClient } from '@stoktok/db';
import type { Db } from '@stoktok/db';

let db: Db | undefined;

/**
 * The only web entry into the data layer (R3). Reads the service role key from process.env at runtime.
 * Callers must call requireUser() first (R6).
 */
export function getDb(): Db {
  db ??= createServiceClient(process.env);
  return db;
}

export * from '@stoktok/db';

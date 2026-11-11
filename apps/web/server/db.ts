import 'server-only';
import { createPgDb } from '@stoktok/db/pg';
import type { Db } from '@stoktok/db';

/** One handle per process, shared across module instances (dev HMR and bundler duplicates). */
const CACHE_KEY = Symbol.for('stoktok.db');

/**
 * The only web entry into the data layer (R3). Created on first use from process.env at runtime, so importing this
 * module needs no database. Callers must call requireUser() first (R6).
 */
export function getDb(): Db {
  const g = globalThis as Record<symbol, Db | undefined>;
  return (g[CACHE_KEY] ??= createPgDb(process.env, 'web'));
}

export * from '@stoktok/db';

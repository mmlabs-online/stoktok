/** Subpath barrel (@stoktok/db/pg). Server-only (R3). Apps import createPgDb from here only in apps/web/server/db.ts and apps/worker/src/cli.ts. */
export { createPgDb } from './client';
export type { PgDb, PgPoolStats } from './client';
export { PG_POOL_PROFILES } from './config';
export type { PgProfile, PoolProfile } from './config';
export { chunkForParams, jsonb, upsertInto } from './upsert';
export type { Database } from './schema';

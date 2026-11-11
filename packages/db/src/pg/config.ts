/** Pool profiles and driver limits: the single source of these values (R5 spirit). Server-only (R3). */
export interface PoolProfile {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMs: number;
  applicationName: string;
}

export type PgProfile = 'web' | 'worker';

export const PG_POOL_PROFILES: Record<PgProfile, PoolProfile> = {
  // Web and worker share one Postgres on one host (max_connections 100). Web serves a single user: 5 is plenty.
  web: { max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, statementTimeoutMs: 15_000, applicationName: 'stoktok-web' },
  // Jobs run sequentially (ADR 0003): 2 connections. 120 s statement timeout leaves room for bulk upserts.
  worker: { max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, statementTimeoutMs: 120_000, applicationName: 'stoktok-worker' },
};

/** Postgres wire protocol limit on bind parameters per statement. */
export const PG_MAX_BIND_PARAMS = 65_535;

/** Per-symbol fan-outs run at most this many queries at once: <= the worker pool `max`, so no caller waits near connectionTimeoutMillis. */
export const PG_FANOUT_CONCURRENCY = 2;

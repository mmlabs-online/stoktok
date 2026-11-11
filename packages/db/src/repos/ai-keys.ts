import { AI_PROVIDERS, validateAiKeyFormat } from '@stoktok/core';
import type { AiProvider } from '@stoktok/core';
import { sql } from 'kysely';
import { DataError } from '../errors';
import type { SqlstateMap } from '../errors';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';

export interface AiKeyMeta {
  provider: AiProvider;
  last4: string;
  updatedAt: string;
}

export type StoredAiKeySecrets = Partial<Record<AiProvider, string>>;

const TABLE = 'ai_keys';

/**
 * Errors carry a fixed text and the pg code only (q() attaches no cause). The key is only ever a bound parameter,
 * never part of the SQL text. Nothing in this module logs.
 */
const AI_KEY_MAP: SqlstateMap = (s) => (s === '22023' ? 'VALIDATION' : undefined);

function assertProvider(provider: string, op: string): asserts provider is AiProvider {
  if (!AI_PROVIDERS.includes(provider as AiProvider)) throw new DataError('VALIDATION', TABLE, op, 'unknown provider');
}

/** Stores or replaces the provider key in Vault through ai_key_set. Returns metadata only. */
export async function saveAiKey(db: PgDb, provider: string, key: string): Promise<AiKeyMeta> {
  assertProvider(provider, 'set');
  if (!validateAiKeyFormat(key).ok) throw new DataError('VALIDATION', TABLE, 'set', 'invalid key format');
  const rows = await q(
    db,
    { table: TABLE, op: 'set' },
    async (k) => (await sql<{ key_last4: unknown; saved_at: unknown }>`select key_last4, saved_at from public.ai_key_set(${provider}::text, ${key}::text)`.execute(k)).rows,
    { map: AI_KEY_MAP },
  );
  const row = rows[0];
  if (!row || typeof row.key_last4 !== 'string' || typeof row.saved_at !== 'string') {
    throw new DataError('MAPPING', TABLE, 'set', 'row mapping failed (result)');
  }
  return { provider, last4: row.key_last4, updatedAt: row.saved_at };
}

/** Returns whether a key was stored. */
export async function deleteAiKey(db: PgDb, provider: string): Promise<boolean> {
  assertProvider(provider, 'delete');
  const rows = await q(
    db,
    { table: TABLE, op: 'delete' },
    async (k) => (await sql<{ deleted: unknown }>`select public.ai_key_delete(${provider}::text) as deleted`.execute(k)).rows,
    { map: AI_KEY_MAP },
  );
  return rows[0]?.deleted === true;
}

/** Metadata only (provider, last 4, date): never decrypts. */
export async function listAiKeyMeta(db: PgDb): Promise<AiKeyMeta[]> {
  const rows = await q(db, { table: TABLE, op: 'list' }, (k) => k.selectFrom('ai_keys').select(['provider', 'last4', 'updated_at']).execute(), { map: AI_KEY_MAP });
  return rows.map((r) => {
    if (!AI_PROVIDERS.includes(r.provider as AiProvider)) throw new DataError('MAPPING', TABLE, 'list', 'row mapping failed (provider)');
    return { provider: r.provider as AiProvider, last4: r.last4, updatedAt: r.updated_at };
  });
}

/** The only decrypting call (r3-guard lists its allowed callers). Server code only. */
export async function readAiKeySecrets(db: PgDb): Promise<StoredAiKeySecrets> {
  const rows = await q(
    db,
    { table: TABLE, op: 'read' },
    async (k) => (await sql<{ provider: string; secret: unknown }>`select provider, secret from public.ai_key_secrets()`.execute(k)).rows,
    { map: AI_KEY_MAP },
  );
  const out: StoredAiKeySecrets = {};
  for (const r of rows) {
    if (!AI_PROVIDERS.includes(r.provider as AiProvider)) throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (provider)');
    if (typeof r.secret !== 'string' || r.secret === '') throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (secret)');
    out[r.provider as AiProvider] = r.secret;
  }
  return out;
}

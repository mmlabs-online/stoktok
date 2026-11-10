import { AI_PROVIDERS, validateAiKeyFormat } from '@stoktok/core';
import type { AiProvider } from '@stoktok/core';
import type { Db } from '../client';
import { DataError } from '../errors';

export interface AiKeyMeta {
  provider: AiProvider;
  last4: string;
  updatedAt: string;
}

export type StoredAiKeySecrets = Partial<Record<AiProvider, string>>;

const TABLE = 'ai_keys';

/**
 * Never uses unwrap(): that attaches the PostgREST error as `cause`, and its message/details could echo the rpc parameters (the key).
 * Errors here carry a fixed text and the pg code only. Nothing in this module logs.
 */
function fail(op: string, error: { code?: string }): never {
  const pg = error.code;
  if (pg === '22023') throw new DataError('VALIDATION', TABLE, op, 'invalid arguments', pg);
  throw new DataError('DB_ERROR', TABLE, op, 'database error', pg);
}

function assertProvider(provider: string, op: string): asserts provider is AiProvider {
  if (!AI_PROVIDERS.includes(provider as AiProvider)) throw new DataError('VALIDATION', TABLE, op, 'unknown provider');
}

/** Stores or replaces the provider key in Vault through ai_key_set. Returns metadata only. */
export async function saveAiKey(db: Db, provider: string, key: string): Promise<AiKeyMeta> {
  assertProvider(provider, 'set');
  if (!validateAiKeyFormat(key).ok) throw new DataError('VALIDATION', TABLE, 'set', 'invalid key format');
  const res = await db.rpc('ai_key_set', { p_provider: provider, p_key: key });
  if (res.error) fail('set', res.error);
  const data = res.data as { key_last4?: unknown; saved_at?: unknown }[] | { key_last4?: unknown; saved_at?: unknown } | null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.key_last4 !== 'string' || typeof row.saved_at !== 'string') {
    throw new DataError('MAPPING', TABLE, 'set', 'row mapping failed (result)');
  }
  return { provider, last4: row.key_last4, updatedAt: row.saved_at };
}

/** Returns whether a key was stored. */
export async function deleteAiKey(db: Db, provider: string): Promise<boolean> {
  assertProvider(provider, 'delete');
  const res = await db.rpc('ai_key_delete', { p_provider: provider });
  if (res.error) fail('delete', res.error);
  return res.data === true;
}

/** Metadata only (provider, last 4, date): never decrypts. */
export async function listAiKeyMeta(db: Db): Promise<AiKeyMeta[]> {
  const res = await db.from(TABLE).select('provider, last4, updated_at');
  if (res.error) fail('list', res.error);
  return ((res.data ?? []) as { provider: string; last4: string; updated_at: string }[]).map((r) => {
    if (!AI_PROVIDERS.includes(r.provider as AiProvider)) throw new DataError('MAPPING', TABLE, 'list', 'row mapping failed (provider)');
    return { provider: r.provider as AiProvider, last4: r.last4, updatedAt: r.updated_at };
  });
}

/** The only decrypting call (r3-guard lists its allowed callers). Server code only. */
export async function readAiKeySecrets(db: Db): Promise<StoredAiKeySecrets> {
  const res = await db.rpc('ai_key_secrets');
  if (res.error) fail('read', res.error);
  const out: StoredAiKeySecrets = {};
  for (const r of (res.data ?? []) as { provider: string; secret: string }[]) {
    if (!AI_PROVIDERS.includes(r.provider as AiProvider)) throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (provider)');
    out[r.provider as AiProvider] = r.secret;
  }
  return out;
}

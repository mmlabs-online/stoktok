import { AI_PROVIDERS, validateAiKeyFormat } from '@stoktok/core';
import type { AiProvider } from '@stoktok/core';
import { sql } from 'kysely';
import { DataError } from '../errors';
import { keyringOf, q } from '../pg/access';
import type { PgDb } from '../pg/client';

export interface AiKeyMeta {
  provider: AiProvider;
  last4: string;
  updatedAt: string;
}

export type StoredAiKeySecrets = Partial<Record<AiProvider, string>>;

const TABLE = 'ai_keys';

/**
 * Keys are sealed and opened app-side (ADR 0011, ../keyring.ts); the database only ever sees ciphertext as bound parameters.
 * Errors carry a fixed text and the pg code only (q() attaches no cause). Nothing in this module logs.
 * The upsert is atomic, so no advisory lock is needed.
 */

function assertProvider(provider: string, op: string): asserts provider is AiProvider {
  if (!AI_PROVIDERS.includes(provider as AiProvider)) throw new DataError('VALIDATION', TABLE, op, 'unknown provider');
}

/** Encrypts and stores or replaces the provider key. Returns metadata only. Never writes without a usable keyring. */
export async function saveAiKey(db: PgDb, provider: string, key: string): Promise<AiKeyMeta> {
  assertProvider(provider, 'set');
  if (!validateAiKeyFormat(key).ok) throw new DataError('VALIDATION', TABLE, 'set', 'invalid key format');
  const keyring = keyringOf(db);
  if (keyring.state !== 'ok') throw new DataError('NOT_CONFIGURED', TABLE, 'set', 'ai keyring unavailable');
  const sealed = keyring.seal(provider, key);
  const last4 = key.slice(-4);
  const values = { ciphertext: sealed.ciphertext, iv: sealed.iv, auth_tag: sealed.authTag, key_version: sealed.keyVersion, last4 };
  const rows = await q(db, { table: TABLE, op: 'set' }, (k) =>
    k
      .insertInto('ai_keys')
      .values({ provider, ...values })
      .onConflict((oc) => oc.column('provider').doUpdateSet({ ...values, updated_at: sql<string>`now()` }))
      .returning(['last4', 'updated_at'])
      .execute(),
  );
  const row = rows[0];
  if (!row || typeof row.last4 !== 'string' || typeof row.updated_at !== 'string') {
    throw new DataError('MAPPING', TABLE, 'set', 'row mapping failed (result)');
  }
  return { provider, last4: row.last4, updatedAt: row.updated_at };
}

/** Returns whether a key was stored. Needs no keyring, so a lost master key can still be cleaned up. */
export async function deleteAiKey(db: PgDb, provider: string): Promise<boolean> {
  assertProvider(provider, 'delete');
  const rows = await q(db, { table: TABLE, op: 'delete' }, (k) => k.deleteFrom('ai_keys').where('provider', '=', provider).returning('provider').execute());
  return rows.length > 0;
}

/** Metadata only (provider, last 4, date): never decrypts. */
export async function listAiKeyMeta(db: PgDb): Promise<AiKeyMeta[]> {
  const rows = await q(db, { table: TABLE, op: 'list' }, (k) => k.selectFrom('ai_keys').select(['provider', 'last4', 'updated_at']).execute());
  return rows.map((r) => {
    if (!AI_PROVIDERS.includes(r.provider as AiProvider)) throw new DataError('MAPPING', TABLE, 'list', 'row mapping failed (provider)');
    return { provider: r.provider as AiProvider, last4: r.last4, updatedAt: r.updated_at };
  });
}

/**
 * The only decrypting call (r3-guard lists its allowed callers). Server code only. No cache (ADR 0009 section 4).
 * All or nothing: no rows gives {} (env fallback); rows with a missing or wrong key, or any row that fails to open, throw.
 * A partial map would let the resolver fall back to the env key of the failed provider (ADR 0009 section 5).
 */
export async function readAiKeySecrets(db: PgDb): Promise<StoredAiKeySecrets> {
  const rows = await q(db, { table: TABLE, op: 'read' }, (k) =>
    k.selectFrom('ai_keys').select(['provider', 'ciphertext', 'iv', 'auth_tag', 'key_version', 'last4']).execute(),
  );
  if (rows.length === 0) return {};
  const keyring = keyringOf(db);
  if (keyring.state !== 'ok') throw new DataError('NOT_CONFIGURED', TABLE, 'read', 'ai keyring unavailable');
  const out: StoredAiKeySecrets = {};
  // Outside q(): a crypto failure must stay MAPPING, never DB_ERROR.
  for (const r of rows) {
    if (!AI_PROVIDERS.includes(r.provider as AiProvider)) throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (provider)');
    const provider = r.provider as AiProvider;
    if (!Buffer.isBuffer(r.ciphertext) || !Buffer.isBuffer(r.iv) || !Buffer.isBuffer(r.auth_tag) || typeof r.key_version !== 'number') {
      throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (secret)');
    }
    let plain: string;
    try {
      plain = keyring.open(provider, { ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag, keyVersion: r.key_version });
    } catch {
      throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (secret)');
    }
    if (!validateAiKeyFormat(plain).ok || plain.slice(-4) !== r.last4) {
      throw new DataError('MAPPING', TABLE, 'read', 'row mapping failed (secret)');
    }
    out[provider] = plain;
  }
  return out;
}

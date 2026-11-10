import 'server-only';
import { AI_PROVIDERS, aiKeyRows, validateAiKeyFormat } from '@stoktok/core';
import type { AiKeyActionState, AiKeyRow, AiProvider } from '@stoktok/core';
import { DataError, deleteAiKey, listAiKeyMeta, saveAiKey } from './db';
import type { Db } from './db';

export type AiKeyRowsRead = { ok: true; rows: AiKeyRow[] } | { ok: false };

function parseProvider(fd: FormData): AiProvider | null {
  const p = fd.get('provider');
  return typeof p === 'string' && AI_PROVIDERS.includes(p as AiProvider) ? (p as AiProvider) : null;
}

/** Only {event, provider, code}: never the error, its message or the form data (the key could be in them). */
function log(event: string, provider: AiProvider | null, e: unknown): void {
  console.warn(JSON.stringify({ event, provider, code: e instanceof DataError ? e.code : 'unknown' }));
}

export async function handleSaveAiKey(db: Db, fd: FormData): Promise<AiKeyActionState> {
  const provider = parseProvider(fd);
  if (!provider) return { ok: false, provider: null, code: 'AI_KEY_PROVIDER' };
  const raw = fd.get('key');
  const key = typeof raw === 'string' ? raw : ''; // no trim (ADR 0009 §6)
  const check = validateAiKeyFormat(key);
  if (!check.ok) return { ok: false, provider, code: check.code };
  try {
    const m = await saveAiKey(db, provider, key);
    return { ok: true, provider, last4: m.last4, savedAt: m.updatedAt };
  } catch (e) {
    log('ai_key_save_failed', provider, e);
    return { ok: false, provider, code: 'AI_KEY_DB_ERROR' };
  }
}

export async function handleDeleteAiKey(db: Db, fd: FormData): Promise<AiKeyActionState> {
  const provider = parseProvider(fd);
  if (!provider) return { ok: false, provider: null, code: 'AI_KEY_PROVIDER' };
  try {
    return { ok: true, provider, deleted: await deleteAiKey(db, provider) };
  } catch (e) {
    log('ai_key_delete_failed', provider, e);
    return { ok: false, provider, code: 'AI_KEY_DB_ERROR' };
  }
}

/** Soft-fail: a failed read is "could not read", never shown as "no key". Metadata only, never decrypts. */
export async function readAiKeyRows(
  db: Db,
  loadPresence: () => Promise<Record<AiProvider, boolean>> = async () => (await import('./ai')).aiEnvPresence(),
): Promise<AiKeyRowsRead> {
  try {
    return { ok: true, rows: aiKeyRows(await listAiKeyMeta(db), await loadPresence()) };
  } catch (e) {
    console.warn(JSON.stringify({ event: 'ai_key_list_failed', code: e instanceof DataError ? e.code : 'read_failed' }));
    return { ok: false };
  }
}

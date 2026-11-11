import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './db';

vi.mock('server-only', () => ({}));
const saveAiKey = vi.hoisted(() => vi.fn());
const deleteAiKey = vi.hoisted(() => vi.fn());
const listAiKeyMeta = vi.hoisted(() => vi.fn());
vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  saveAiKey,
  deleteAiKey,
  listAiKeyMeta,
}));

import { DataError } from './db';
import { handleDeleteAiKey, handleSaveAiKey, readAiKeyRows } from './ai-keys';

const SENTINEL = 'DUMMY-SENTINEL-not-a-real-key';
const results: unknown[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];

const form = (o: Record<string, string | File | undefined>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) fd.set(k, v);
  return fd;
};
const db = { marker: 'db' } as unknown as Db;
const dbError = (code = 'XX000') => new DataError('DB_ERROR', 'ai_keys', 'set', 'database error', code);
const logged = () => spies.flatMap((s) => s.mock.calls);

beforeEach(() => {
  results.length = 0;
  saveAiKey.mockReset();
  deleteAiKey.mockReset();
  listAiKeyMeta.mockReset();
  saveAiKey.mockResolvedValue({ provider: 'anthropic', last4: 'only', updatedAt: '2026-11-10T03:00:00Z' });
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  spies.forEach((s) => s.mockRestore());
});

const track = <T,>(r: T): T => {
  results.push(r);
  return r;
};

describe('handleSaveAiKey', () => {
  it('valid key: saveAiKey called with (db, provider, key), result has exactly four keys', async () => {
    const r = track(await handleSaveAiKey(db, form({ provider: 'anthropic', key: SENTINEL })));
    expect(saveAiKey).toHaveBeenCalledTimes(1);
    expect(saveAiKey).toHaveBeenCalledWith(db, 'anthropic', SENTINEL);
    expect(Object.keys(r).sort()).toEqual(['last4', 'ok', 'provider', 'savedAt']);
    expect(r).toEqual({ ok: true, provider: 'anthropic', last4: 'only', savedAt: '2026-11-10T03:00:00Z' });
  });

  it.each([
    ['empty', { provider: 'google', key: '' }, 'AI_KEY_EMPTY'],
    ['missing key', { provider: 'google' }, 'AI_KEY_EMPTY'],
    ['leading space', { provider: 'google', key: ` ${SENTINEL}` }, 'AI_KEY_WHITESPACE'],
    ['trailing newline', { provider: 'google', key: `${SENTINEL}\n` }, 'AI_KEY_WHITESPACE'],
    ['19 chars', { provider: 'google', key: 'a'.repeat(19) }, 'AI_KEY_LENGTH'],
    ['257 chars', { provider: 'google', key: 'a'.repeat(257) }, 'AI_KEY_LENGTH'],
    ['non-ascii', { provider: 'google', key: `${SENTINEL}ã` }, 'AI_KEY_CHARSET'],
  ])('format rejection: %s', async (_n, input, code) => {
    const r = track(await handleSaveAiKey(db, form(input)));
    expect(r).toEqual({ ok: false, provider: 'google', code });
    expect(saveAiKey).not.toHaveBeenCalled();
  });

  it('unknown, missing or File provider', async () => {
    for (const input of [{ provider: 'openai', key: SENTINEL }, { key: SENTINEL }, { provider: new File(['x'], 'x.txt'), key: SENTINEL }]) {
      expect(track(await handleSaveAiKey(db, form(input)))).toEqual({ ok: false, provider: null, code: 'AI_KEY_PROVIDER' });
      expect(track(await handleDeleteAiKey(db, form(input)))).toEqual({ ok: false, provider: null, code: 'AI_KEY_PROVIDER' });
    }
    expect(saveAiKey).not.toHaveBeenCalled();
    expect(deleteAiKey).not.toHaveBeenCalled();
  });

  it('a DataError from the repo maps to AI_KEY_DB_ERROR', async () => {
    saveAiKey.mockRejectedValue(dbError());
    expect(track(await handleSaveAiKey(db, form({ provider: 'google', key: SENTINEL })))).toEqual({ ok: false, provider: 'google', code: 'AI_KEY_DB_ERROR' });
  });

  it('a thrown non-DataError maps to AI_KEY_DB_ERROR', async () => {
    saveAiKey.mockRejectedValue(new Error(`boom ${SENTINEL}`));
    expect(track(await handleSaveAiKey(db, form({ provider: 'google', key: SENTINEL })))).toMatchObject({ code: 'AI_KEY_DB_ERROR' });
  });
});

describe('handleDeleteAiKey', () => {
  it('data true / false', async () => {
    for (const deleted of [true, false]) {
      deleteAiKey.mockResolvedValueOnce(deleted);
      expect(track(await handleDeleteAiKey(db, form({ provider: 'anthropic' })))).toEqual({ ok: true, provider: 'anthropic', deleted });
    }
    expect(deleteAiKey).toHaveBeenCalledWith(db, 'anthropic');
  });
  it('error maps to AI_KEY_DB_ERROR', async () => {
    deleteAiKey.mockRejectedValue(dbError());
    expect(track(await handleDeleteAiKey(db, form({ provider: 'anthropic' })))).toEqual({ ok: false, provider: 'anthropic', code: 'AI_KEY_DB_ERROR' });
  });
});

describe('no leaks', () => {
  it('no result or console output contains the sentinel; logs are exactly {event, provider, code}', async () => {
    saveAiKey.mockRejectedValueOnce(dbError());
    track(await handleSaveAiKey(db, form({ provider: 'google', key: SENTINEL })));
    saveAiKey.mockRejectedValueOnce(new Error(SENTINEL));
    track(await handleSaveAiKey(db, form({ provider: 'google', key: SENTINEL })));
    deleteAiKey.mockRejectedValueOnce(dbError());
    track(await handleDeleteAiKey(db, form({ provider: 'google' })));
    track(await handleSaveAiKey(db, form({ provider: 'google', key: SENTINEL })));
    expect(JSON.stringify(results)).not.toContain('SENTINEL');
    const lines = logged();
    expect(lines.length).toBe(3);
    for (const [line] of lines) {
      expect(JSON.stringify(line)).not.toContain('SENTINEL');
      const o = JSON.parse(line as string) as Record<string, unknown>;
      expect(Object.keys(o).sort()).toEqual(['code', 'event', 'provider']);
      expect(['ai_key_save_failed', 'ai_key_delete_failed']).toContain(o.event);
    }
  });
});

describe('readAiKeyRows', () => {
  const presence = async () => ({ anthropic: false, google: true });

  it('returns rows from listAiKeyMeta', async () => {
    listAiKeyMeta.mockResolvedValue([{ provider: 'anthropic', last4: 'abcd', updatedAt: '2026-11-10T03:00:00Z' }]);
    const r = await readAiKeyRows(db, presence);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.rows.map((x) => x.state)).toEqual(['ui', 'env']);
      expect(r.rows[0]?.savedOn).toBe('10/11/2026');
    }
    expect(listAiKeyMeta).toHaveBeenCalledWith(db);
  });
  it('list failure soft-fails with one log', async () => {
    listAiKeyMeta.mockRejectedValue(dbError('42501'));
    expect(await readAiKeyRows(db, presence)).toEqual({ ok: false });
    expect(logged().map(([l]) => JSON.parse(l as string))).toEqual([{ event: 'ai_key_list_failed', code: 'DB_ERROR' }]);
  });
  it('presence loader throwing soft-fails', async () => {
    listAiKeyMeta.mockResolvedValue([]);
    expect(await readAiKeyRows(db, async () => Promise.reject(new Error('x')))).toEqual({ ok: false });
  });
});

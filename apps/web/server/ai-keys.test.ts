import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './db';

vi.mock('server-only', () => ({}));

import { handleDeleteAiKey, handleSaveAiKey, readAiKeyRows } from './ai-keys';

const SENTINEL = 'DUMMY-SENTINEL-not-a-real-key';
const results: unknown[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];

const form = (o: Record<string, string | File | undefined>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) fd.set(k, v);
  return fd;
};
const fakeDb = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as Db;
const okRpc = () => vi.fn().mockResolvedValue({ data: [{ key_last4: 'only', saved_at: '2026-11-10T03:00:00Z' }], error: null });
const logged = () => spies.flatMap((s) => s.mock.calls);

beforeEach(() => {
  results.length = 0;
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
  it('valid key: one rpc without a third argument, result has exactly four keys', async () => {
    const rpc = okRpc();
    const r = track(await handleSaveAiKey(fakeDb(rpc), form({ provider: 'anthropic', key: SENTINEL })));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual(['ai_key_set', { p_provider: 'anthropic', p_key: SENTINEL }]);
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
    const rpc = okRpc();
    const r = track(await handleSaveAiKey(fakeDb(rpc), form(input)));
    expect(r).toEqual({ ok: false, provider: 'google', code });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('unknown, missing or File provider', async () => {
    const rpc = okRpc();
    for (const input of [{ provider: 'openai', key: SENTINEL }, { key: SENTINEL }, { provider: new File(['x'], 'x.txt'), key: SENTINEL }]) {
      expect(track(await handleSaveAiKey(fakeDb(rpc), form(input)))).toEqual({ ok: false, provider: null, code: 'AI_KEY_PROVIDER' });
      expect(track(await handleDeleteAiKey(fakeDb(rpc), form(input)))).toEqual({ ok: false, provider: null, code: 'AI_KEY_PROVIDER' });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error result maps to AI_KEY_DB_ERROR', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: `x ${SENTINEL}`, details: SENTINEL } });
    expect(track(await handleSaveAiKey(fakeDb(rpc), form({ provider: 'google', key: SENTINEL })))).toEqual({
      ok: false,
      provider: 'google',
      code: 'AI_KEY_DB_ERROR',
    });
  });

  it('thrown rpc error maps to AI_KEY_DB_ERROR', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error(`boom ${SENTINEL}`));
    expect(track(await handleSaveAiKey(fakeDb(rpc), form({ provider: 'google', key: SENTINEL })))).toMatchObject({ code: 'AI_KEY_DB_ERROR' });
  });
});

describe('handleDeleteAiKey', () => {
  it('data true / false', async () => {
    for (const deleted of [true, false]) {
      const rpc = vi.fn().mockResolvedValue({ data: deleted, error: null });
      expect(track(await handleDeleteAiKey(fakeDb(rpc), form({ provider: 'anthropic' })))).toEqual({ ok: true, provider: 'anthropic', deleted });
      expect(rpc.mock.calls[0]).toEqual(['ai_key_delete', { p_provider: 'anthropic' }]);
    }
  });
  it('error maps to AI_KEY_DB_ERROR', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: SENTINEL } });
    expect(track(await handleDeleteAiKey(fakeDb(rpc), form({ provider: 'anthropic' })))).toEqual({ ok: false, provider: 'anthropic', code: 'AI_KEY_DB_ERROR' });
  });
});

describe('no leaks', () => {
  it('no result or console output contains the sentinel; logs are exactly {event, provider, code}', async () => {
    const bad = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: SENTINEL, details: SENTINEL } });
    track(await handleSaveAiKey(fakeDb(bad), form({ provider: 'google', key: SENTINEL })));
    track(await handleSaveAiKey(fakeDb(vi.fn().mockRejectedValue(new Error(SENTINEL))), form({ provider: 'google', key: SENTINEL })));
    track(await handleDeleteAiKey(fakeDb(bad), form({ provider: 'google' })));
    track(await handleSaveAiKey(fakeDb(okRpc()), form({ provider: 'google', key: SENTINEL })));
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
  const dbWith = (res: { data: unknown; error: unknown }) => {
    const rpc = vi.fn();
    const select = vi.fn().mockResolvedValue(res);
    return { db: { rpc, from: vi.fn(() => ({ select })) } as unknown as Db, rpc };
  };
  const presence = async () => ({ anthropic: false, google: true });

  it('returns rows and never calls rpc', async () => {
    const { db, rpc } = dbWith({ data: [{ provider: 'anthropic', last4: 'abcd', updated_at: '2026-11-10T03:00:00Z' }], error: null });
    const r = await readAiKeyRows(db, presence);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.rows.map((x) => x.state)).toEqual(['ui', 'env']);
      expect(r.rows[0]?.savedOn).toBe('10/11/2026');
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it('list failure soft-fails with one log', async () => {
    const { db } = dbWith({ data: null, error: { code: '42501' } });
    expect(await readAiKeyRows(db, presence)).toEqual({ ok: false });
    expect(logged().map(([l]) => JSON.parse(l as string))).toEqual([{ event: 'ai_key_list_failed', code: 'DB_ERROR' }]);
  });
  it('presence loader throwing soft-fails', async () => {
    const { db } = dbWith({ data: [], error: null });
    expect(await readAiKeyRows(db, async () => Promise.reject(new Error('x')))).toEqual({ ok: false });
  });
});

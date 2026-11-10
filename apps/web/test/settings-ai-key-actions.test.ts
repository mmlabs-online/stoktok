import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const state = vi.hoisted(() => ({ ok: true }));
const requireUser = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const handleSaveAiKey = vi.hoisted(() => vi.fn());
const handleDeleteAiKey = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('../server/auth/require-user', () => ({ requireUser }));
vi.mock('../server/db', () => ({ getDb }));
vi.mock('../server/settings/handlers', () => ({ handleSaveSettings: vi.fn() }));
vi.mock('../server/ai-keys', () => ({ handleSaveAiKey, handleDeleteAiKey }));

import { deleteAiKeyAction, saveAiKeyAction } from '../app/(app)/settings/actions';

beforeEach(() => {
  order.length = 0;
  state.ok = true;
  for (const m of [requireUser, revalidatePath, redirect, getDb, handleSaveAiKey, handleDeleteAiKey]) m.mockReset();
  requireUser.mockImplementation(async () => void order.push('requireUser'));
  getDb.mockImplementation(() => (order.push('getDb'), {}));
  handleSaveAiKey.mockImplementation(async () => (order.push('handleSaveAiKey'), { ok: state.ok }));
  handleDeleteAiKey.mockImplementation(async () => (order.push('handleDeleteAiKey'), { ok: state.ok }));
});

describe.each([
  ['saveAiKeyAction', saveAiKeyAction, 'handleSaveAiKey'],
  ['deleteAiKeyAction', deleteAiKeyAction, 'handleDeleteAiKey'],
] as const)('%s', (_n, action, handler) => {
  it('requireUser before getDb before handler; revalidates on ok only; no redirect', async () => {
    await action(null, new FormData());
    expect(order).toEqual(['requireUser', 'getDb', handler]);
    expect(revalidatePath).toHaveBeenCalledWith('/settings');
    revalidatePath.mockClear();
    state.ok = false;
    await action(null, new FormData());
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
  it('requireUser rejection touches nothing else', async () => {
    requireUser.mockRejectedValue(new Error('unauthorized'));
    await expect(action(null, new FormData())).rejects.toThrow();
    expect(getDb).not.toHaveBeenCalled();
    expect(handleSaveAiKey).not.toHaveBeenCalled();
    expect(handleDeleteAiKey).not.toHaveBeenCalled();
  });
});

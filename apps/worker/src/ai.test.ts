import type { Db } from '@stoktok/db';
import { describe, expect, test, vi } from 'vitest';
import { createWorkerAi } from './ai';

const chat = () => ({ task: 'chat' as const, system: 's', messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] }] });

describe('createWorkerAi', () => {
  test('with env {} builds a client whose budgetStatus reads ai_month_spend', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5_000_000, error: null });
    const ai = createWorkerAi({ env: {}, db: { rpc } as unknown as Db });
    expect(await ai.budgetStatus()).toMatchObject({ spentMicroUsd: 5_000_000, level: 'exhausted' });
    expect(rpc).toHaveBeenCalledWith('ai_month_spend', expect.any(Object));
  });
  test('generate reads stored keys per call via db.rpc(ai_key_secrets)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const ai = createWorkerAi({ env: {}, db: { rpc } as unknown as Db });
    await ai.generate(chat());
    await ai.generate(chat());
    expect(rpc.mock.calls.filter((c) => c[0] === 'ai_key_secrets')).toHaveLength(2);
  });
  test('an rpc error gives provider_unavailable and logs no secret', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: 'DUMMY-SENTINEL-not-a-real-key' } });
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const ai = createWorkerAi({ env: {}, db: { rpc } as unknown as Db });
    const res = await ai.generate(chat());
    expect(!res.ok && res.reason).toBe('provider_unavailable');
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('SENTINEL');
    spies.forEach((s) => s.mockRestore());
  });
});

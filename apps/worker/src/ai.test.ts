import type { Db } from '@stoktok/db';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const readAiKeySecrets = vi.hoisted(() => vi.fn());
const monthSpend = vi.hoisted(() => vi.fn());
const aiUsageLedger = vi.hoisted(() => vi.fn());
vi.mock('@stoktok/db', () => ({ readAiKeySecrets, aiUsageLedger }));

import { createWorkerAi } from './ai';

const chat = () => ({ task: 'chat' as const, system: 's', messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] }] });
const db = { marker: 'db' } as unknown as Db;

beforeEach(() => {
  readAiKeySecrets.mockReset();
  monthSpend.mockReset();
  aiUsageLedger.mockReset();
  aiUsageLedger.mockImplementation(() => ({ monthSpend }));
});

describe('createWorkerAi', () => {
  test('budgetStatus reads monthSpend from aiUsageLedger(db) with the passed db', async () => {
    monthSpend.mockResolvedValue(5_000_000);
    const ai = createWorkerAi({ env: {}, db });
    expect(await ai.budgetStatus()).toMatchObject({ spentMicroUsd: 5_000_000, level: 'exhausted' });
    expect(aiUsageLedger).toHaveBeenCalledWith(db);
    expect(monthSpend).toHaveBeenCalledWith(expect.any(Object));
  });
  test('generate reads stored keys per call via readAiKeySecrets(db)', async () => {
    readAiKeySecrets.mockResolvedValue({});
    const ai = createWorkerAi({ env: {}, db });
    await ai.generate(chat());
    await ai.generate(chat());
    expect(readAiKeySecrets).toHaveBeenCalledTimes(2);
    expect(readAiKeySecrets).toHaveBeenCalledWith(db);
  });
  test('a key-read rejection carrying a sentinel gives provider_unavailable and logs no sentinel', async () => {
    readAiKeySecrets.mockRejectedValue(new Error('boom DUMMY-SENTINEL-not-a-real-key'));
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const ai = createWorkerAi({ env: {}, db });
    const res = await ai.generate(chat());
    expect(!res.ok && res.reason).toBe('provider_unavailable');
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('SENTINEL');
    spies.forEach((s) => s.mockRestore());
  });
});

import type { Db } from '@stoktok/db';
import { describe, expect, test, vi } from 'vitest';
import { createWorkerAi } from './ai';

describe('createWorkerAi', () => {
  test('with env {} builds a client whose budgetStatus reads ai_month_spend', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5_000_000, error: null });
    const ai = createWorkerAi({ env: {}, db: { rpc } as unknown as Db });
    expect(await ai.budgetStatus()).toMatchObject({ spentMicroUsd: 5_000_000, level: 'exhausted' });
    expect(rpc).toHaveBeenCalledWith('ai_month_spend', expect.any(Object));
  });
});

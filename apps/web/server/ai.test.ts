import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getDb = vi.hoisted(() => vi.fn());
vi.mock('./db', () => ({
  getDb,
  // Stands in for the db package's ledger: monthSpend goes through the fake client's rpc.
  aiUsageLedger: (db: { rpc: (n: string, a: object) => Promise<{ data: number }> }) => ({
    monthSpend: async () => (await db.rpc('ai_month_spend', {})).data,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  getDb.mockReset();
});

describe('server/ai', () => {
  test('importing the module does not call getDb or build providers', async () => {
    await import('./ai');
    expect(getDb).not.toHaveBeenCalled();
  });
  test("getAiBudgetStatus with no AI keys returns budgetStatus of the ledger's month spend", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 4_000_000, error: null });
    getDb.mockReturnValue({ rpc });
    const { getAiBudgetStatus } = await import('./ai');
    expect(await getAiBudgetStatus()).toMatchObject({ spentMicroUsd: 4_000_000, percent: 80, level: 'warn' });
    expect(rpc).toHaveBeenCalledWith('ai_month_spend', expect.any(Object));
  });
  test('getAi returns the same instance on repeated calls', async () => {
    getDb.mockReturnValue({ rpc: vi.fn() });
    const { getAi } = await import('./ai');
    expect(getAi()).toBe(getAi());
    expect(getDb).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getDb = vi.hoisted(() => vi.fn());
const readAiKeySecrets = vi.hoisted(() => vi.fn());
vi.mock('./db', () => ({
  getDb,
  readAiKeySecrets,
  // Stands in for the db package's ledger: monthSpend goes through the fake client's rpc.
  aiUsageLedger: (db: { rpc: (n: string, a: object) => Promise<{ data: number }> }) => ({
    monthSpend: async () => (await db.rpc('ai_month_spend', {})).data,
  }),
}));

const chat = () => ({ task: 'chat' as const, system: 's', messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] }] });

beforeEach(() => {
  vi.resetModules();
  getDb.mockReset();
  readAiKeySecrets.mockReset();
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
  test('getAiBudgetStatus does not call readAiKeySecrets', async () => {
    getDb.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: 0, error: null }) });
    const { getAiBudgetStatus } = await import('./ai');
    await getAiBudgetStatus();
    expect(readAiKeySecrets).not.toHaveBeenCalled();
  });
  test('generate reads stored keys on every call', async () => {
    getDb.mockReturnValue({ rpc: vi.fn() });
    readAiKeySecrets.mockResolvedValue({});
    const { getAi } = await import('./ai');
    await getAi().generate(chat());
    await getAi().generate(chat());
    expect(readAiKeySecrets).toHaveBeenCalledTimes(2);
  });
  test('a failing key read gives provider_unavailable and logs no secret', async () => {
    getDb.mockReturnValue({ rpc: vi.fn() });
    readAiKeySecrets.mockRejectedValue(new Error('boom DUMMY-SENTINEL-not-a-real-key'));
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { getAi } = await import('./ai');
    const res = await getAi().generate(chat());
    expect(!res.ok && res.reason).toBe('provider_unavailable');
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain('SENTINEL');
    spies.forEach((s) => s.mockRestore());
  });
  test('aiEnvPresence returns booleans only', async () => {
    const { aiEnvPresence } = await import('./ai');
    const sentinel = 'DUMMY-SENTINEL-not-a-real-key';
    const r = aiEnvPresence({ anthropicApiKey: sentinel });
    expect(r).toEqual({ anthropic: true, google: false });
    expect(JSON.stringify(r)).not.toContain('SENTINEL');
    expect(aiEnvPresence({})).toEqual({ anthropic: false, google: false });
  });
});

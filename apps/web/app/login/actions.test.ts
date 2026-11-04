import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const signInWithPassword = vi.fn();
const signOut = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('../../server/auth/authen-client', () => ({
  createAuthenClient: () => ({ auth: { signInWithPassword, signOut } }),
  nextCookieAdapter: () => ({}),
}));

const { signInAction, signOutAction } = await import('./actions');

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTHEN_SUPABASE_URL', 'https://abc.supabase.co');
  vi.stubEnv('AUTHEN_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('ALLOWLIST_USER_IDS', '11111111-1111-4111-8111-111111111111');
});

describe('signInAction', () => {
  it('redirects to safeNext(next) on success', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(signInAction(form({ email: 'a@b.c', password: 'pw', next: '/transactions' }))).rejects.toThrow(
      'REDIRECT:/transactions',
    );
    await expect(signInAction(form({ email: 'a@b.c', password: 'pw', next: '//evil.com' }))).rejects.toThrow('REDIRECT:/');
    await expect(signInAction(form({ email: 'a@b.c', password: 'pw', next: '/\t/evil.com' }))).rejects.toThrow('REDIRECT:/');
  });

  it('redirects to /login?error=1 for any auth error and for empty fields', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') });
    await expect(signInAction(form({ email: 'a@b.c', password: 'bad' }))).rejects.toThrow('REDIRECT:/login?error=1');
    signInWithPassword.mockRejectedValue(new Error('network'));
    await expect(signInAction(form({ email: 'a@b.c', password: 'pw' }))).rejects.toThrow('REDIRECT:/login?error=1');
    signInWithPassword.mockClear();
    await expect(signInAction(form({ email: '', password: '' }))).rejects.toThrow('REDIRECT:/login?error=1');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('never passes form data to console', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    signInWithPassword.mockRejectedValue(new Error('boom'));
    await signInAction(form({ email: 'a@b.c', password: 'hunter2' })).catch(() => {});
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('hunter2');
  });
});

describe('signOutAction', () => {
  it("calls signOut({ scope: 'local' }) and redirects to /login", async () => {
    signOut.mockResolvedValue({ error: null });
    await expect(signOutAction()).rejects.toThrow('REDIRECT:/login');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

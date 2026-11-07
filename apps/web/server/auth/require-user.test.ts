import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getClaims = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
let pathHeader: string | null = null;

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => ({ get: () => pathHeader }),
}));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('./authen-client', () => ({
  createAuthenClient: () => ({ auth: { getClaims } }),
  nextCookieAdapter: () => ({}),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const ISS = 'https://abc.supabase.co/auth/v1';
const claims = (over = {}) => ({
  iss: ISS,
  aud: 'authenticated',
  role: 'authenticated',
  sub: ID,
  session_id: 'sess-1',
  exp: Math.floor(Date.now() / 1000) + 600,
  ...over,
});

const { requireUser } = await import('./require-user');

beforeEach(() => {
  vi.clearAllMocks();
  pathHeader = null;
  vi.stubEnv('AUTHEN_SUPABASE_URL', 'https://abc.supabase.co');
  vi.stubEnv('AUTHEN_SUPABASE_ANON_KEY', 'anon');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requireUser', () => {
  it('returns userId when getClaims and checkClaims succeed', async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });
    await expect(requireUser()).resolves.toEqual({ userId: ID });
  });

  it('redirects to /login?next=<x-stoktok-path> when there is no session', async () => {
    pathHeader = '/transactions?page=2';
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    await expect(requireUser()).rejects.toThrow('REDIRECT:/login?next=%2Ftransactions%3Fpage%3D2');
  });

  it('redirects to /login when getClaims throws (Auth/JWKS outage)', async () => {
    getClaims.mockRejectedValue(new Error('network'));
    await expect(requireUser()).rejects.toThrow('REDIRECT:/login');
  });

  it('redirects to /login when auth config is missing', async () => {
    vi.stubEnv('AUTHEN_SUPABASE_URL', '');
    await expect(requireUser()).rejects.toThrow('REDIRECT:/login');
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('returns userId for an arbitrary sub', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    getClaims.mockResolvedValue({ data: { claims: claims({ sub: other }) }, error: null });
    await expect(requireUser()).resolves.toEqual({ userId: other });
  });

  it("redirects to /login for an anonymous session, and the caller's next line never runs", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims({ is_anonymous: true }) }, error: null });
    const getDb = vi.fn();
    const entry = async () => {
      await requireUser();
      getDb();
    };
    await expect(entry()).rejects.toThrow('REDIRECT:/login');
    expect(getDb).not.toHaveBeenCalled();
  });
});

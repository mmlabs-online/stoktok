import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClaims = vi.fn();
let writeCookies = false;

vi.mock('server-only', () => ({}));
vi.mock('./server/auth/authen-client', async (orig) => {
  const real = await orig<typeof import('./server/auth/authen-client')>();
  return {
    ...real,
    createAuthenClient: (_cfg: unknown, cookies: { setAll?: (l: unknown[]) => void }) => ({
      auth: {
        getClaims: async () => {
          if (writeCookies) cookies.setAll?.([{ name: 'stoktok-auth', value: 'refreshed', options: { httpOnly: true } }]);
          return getClaims();
        },
      },
    }),
  };
});

const { proxy } = await import('./proxy');
const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  writeCookies = false;
  vi.stubEnv('AUTHEN_SUPABASE_URL', 'https://abc.supabase.co');
  vi.stubEnv('AUTHEN_SUPABASE_ANON_KEY', 'anon');
});

describe('proxy', () => {
  it('lets /login and /healthz through without a cookie and without auth env', async () => {
    vi.stubEnv('AUTHEN_SUPABASE_URL', '');
    for (const p of ['/login', '/healthz']) {
      const res = await proxy(req(p));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    }
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('redirects a protected path with no session to /login?next=<path+search>', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    const res = await proxy(req('/transactions?page=2'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(
      '/login?next=%2Ftransactions%3Fpage%3D2',
    );
  });

  it('redirects when getClaims returns an error', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('bad jwt') });
    expect((await proxy(req('/'))).status).toBe(307);
  });

  it('passes a valid session through and copies refreshed cookies onto the returned response', async () => {
    writeCookies = true;
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    const res = await proxy(req('/'));
    expect(res.status).toBe(200);
    expect(res.cookies.get('stoktok-auth')?.value).toBe('refreshed');
  });

  it('sets Cache-Control private, no-store when cookies are written', async () => {
    writeCookies = true;
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    expect((await proxy(req('/'))).headers.get('cache-control')).toBe('private, no-store');
  });
});

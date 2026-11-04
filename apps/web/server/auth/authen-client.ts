import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { CookieMethodsServer } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import type { AuthConfig } from './config';

type CookieOptions = Parameters<NonNullable<CookieMethodsServer['setAll']>>[0][number]['options'];

export const COOKIE_NAME = 'stoktok-auth';

/** httpOnly, host-only (no domain): the session never reaches browser JS or other hosts. */
export const COOKIE_OPTIONS = {
  name: COOKIE_NAME,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/** The only module that talks to the Authen (CaleChip) Supabase project; separate from getDb(). */
export function createAuthenClient(cfg: Pick<AuthConfig, 'supabaseUrl' | 'anonKey'>, cookies: CookieMethodsServer) {
  return createServerClient(cfg.supabaseUrl, cfg.anonKey, {
    cookies,
    cookieOptions: COOKIE_OPTIONS,
    auth: { flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type CookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): void;
};

/** Adapter over next/headers cookies(). Server Components cannot write cookies, so writes are skipped there. */
export function nextCookieAdapter(store: CookieStore, opts: { canWrite: boolean }): CookieMethodsServer {
  return {
    getAll: () => store.getAll(),
    setAll(list) {
      if (!opts.canWrite) return;
      try {
        for (const { name, value, options } of list) store.set(name, value, options);
      } catch {
        // Called from a context that cannot set cookies; the proxy refreshes the session instead.
      }
    },
  };
}

/** Adapter for the proxy: writes go to the request (for later readers) and to a recreated response. */
export function requestCookieAdapter(
  req: NextRequest,
  ctx: { res: NextResponse },
  makeResponse: (req: NextRequest) => NextResponse,
): CookieMethodsServer {
  return {
    getAll: () => req.cookies.getAll(),
    setAll(list) {
      for (const { name, value } of list) req.cookies.set(name, value);
      ctx.res = makeResponse(req);
      for (const { name, value, options } of list) ctx.res.cookies.set(name, value, options);
    },
  };
}

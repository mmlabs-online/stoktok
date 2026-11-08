import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { nowInstant } from '../clock';
import { createAuthenClient, nextCookieAdapter } from './authen-client';
import { checkClaims } from './claims';
import type { ClaimsResult } from './claims';
import { loadAuthConfig } from './config';
import { loginPath } from './login-path';

/** Verifies the session cookie (getClaims) and its claims. Any failure is 'unauthenticated' (fail closed). */
export async function authenticate(): Promise<ClaimsResult> {
  let cfg;
  try {
    cfg = loadAuthConfig();
  } catch {
    console.error('auth: config invalid');
    return { kind: 'unauthenticated' };
  }
  try {
    const client = createAuthenClient(cfg, nextCookieAdapter(await cookies(), { canWrite: false }));
    const { data, error } = await client.auth.getClaims();
    if (error || !data) return { kind: 'unauthenticated' };
    return checkClaims(data.claims, cfg, Math.floor(nowInstant().getTime() / 1000));
  } catch {
    console.error('auth: getClaims failed');
    return { kind: 'unauthenticated' };
  }
}

/** Single entry point for pages, route handlers and server actions (R6). Redirects to /login; never returns otherwise. */
export async function requireUser(): Promise<{ userId: string }> {
  const result = await authenticate();
  if (result.kind === 'ok') return { userId: result.userId };
  redirect(loginPath((await headers()).get('x-stoktok-path')));
}

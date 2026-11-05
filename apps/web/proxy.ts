import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAuthenClient, requestCookieAdapter } from './server/auth/authen-client';
import { loadAuthConfig } from './server/auth/config';
import { loginPath } from './server/auth/login-path';

export const PUBLIC_PATHS = ['/login', '/healthz'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Coarse gate: a verified session is required. The allowlist is checked by requireUser() in each entry point. */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const toLogin = () => NextResponse.redirect(new URL(loginPath(pathname + search), request.url));
  request.headers.set('x-stoktok-path', pathname + search);
  const first = NextResponse.next({ request });
  const ctx = { res: first };
  try {
    const cfg = loadAuthConfig();
    const client = createAuthenClient(
      cfg,
      requestCookieAdapter(request, ctx, (r) => NextResponse.next({ request: r })),
    );
    const { data, error } = await client.auth.getClaims();
    if (error || !data) return toLogin();
  } catch {
    return toLogin();
  }
  if (ctx.res !== first) ctx.res.headers.set('Cache-Control', 'private, no-store');
  return ctx.res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

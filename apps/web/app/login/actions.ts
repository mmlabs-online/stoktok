'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAuthenClient, nextCookieAdapter } from '../../server/auth/authen-client';
import { loadAuthConfig } from '../../server/auth/config';
import { safeNext } from '../../server/auth/login-path';

function failure(next: string): never {
  const n = safeNext(next);
  redirect(n === '/' ? '/login?error=1' : `/login?error=1&next=${encodeURIComponent(n)}`);
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = formData.get('email');
  const password = formData.get('password');
  const next = safeNext(formData.get('next'));
  if (typeof email !== 'string' || typeof password !== 'string') failure(next);
  if (email === '' || email.length > 320 || password === '' || password.length > 256) failure(next);

  let ok: boolean;
  try {
    const client = createAuthenClient(loadAuthConfig(), nextCookieAdapter(await cookies(), { canWrite: true }));
    const { error } = await client.auth.signInWithPassword({ email, password });
    ok = !error;
  } catch {
    ok = false;
  }
  if (!ok) failure(next);
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  try {
    const client = createAuthenClient(loadAuthConfig(), nextCookieAdapter(await cookies(), { canWrite: true }));
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing to clear if the config or session is missing.
  }
  redirect('/login');
}

/** Keeps only a same-site relative path; anything else (open-redirect attempts, /login itself) becomes '/'. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\') || /[\\\r\n]/.test(raw)) return '/';
  if (raw === '/login' || raw.startsWith('/login/') || raw.startsWith('/login?')) return '/';
  return raw;
}

export function loginPath(next: unknown): string {
  const n = safeNext(next);
  return n === '/' ? '/login' : `/login?next=${encodeURIComponent(n)}`;
}

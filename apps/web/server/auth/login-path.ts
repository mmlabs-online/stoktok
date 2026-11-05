/** Keeps only a same-site relative path; anything else (open-redirect attempts, /login itself) becomes '/'. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || /[\\\s]/.test(raw) || [...raw].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return '/';
  try {
    const u = new URL(raw, 'http://sentinel.invalid');
    if (u.origin !== 'http://sentinel.invalid' || u.pathname.startsWith('//')) return '/';
  } catch {
    return '/';
  }
  if (raw === '/login' || raw.startsWith('/login/') || raw.startsWith('/login?')) return '/';
  return raw;
}

export function loginPath(next: unknown): string {
  const n = safeNext(next);
  return n === '/' ? '/login' : `/login?next=${encodeURIComponent(n)}`;
}

export type ClaimsResult = { kind: 'ok'; userId: string } | { kind: 'unauthenticated' };

/**
 * Pure check of already signature-verified claims: expiry, issuer, audience/role, non-anonymous session, session id, sub.
 * Any user of the project's Auth passes; single-user access comes from disabled public sign-ups (STK-060).
 */
export function checkClaims(claims: unknown, cfg: { issuer: string }, nowSec: number): ClaimsResult {
  if (typeof claims !== 'object' || claims === null) return { kind: 'unauthenticated' };
  const c = claims as Record<string, unknown>;
  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp) || c.exp <= nowSec) return { kind: 'unauthenticated' };
  if (c.iss !== cfg.issuer) return { kind: 'unauthenticated' };
  const aud = c.aud;
  const audOk = Array.isArray(aud) ? aud.includes('authenticated') : aud === 'authenticated';
  if (!audOk || c.role !== 'authenticated') return { kind: 'unauthenticated' };
  if (c.is_anonymous === true) return { kind: 'unauthenticated' };
  if (typeof c.session_id !== 'string' || c.session_id === '') return { kind: 'unauthenticated' };
  if (typeof c.sub !== 'string' || c.sub === '') return { kind: 'unauthenticated' };
  return { kind: 'ok', userId: c.sub.toLowerCase() };
}

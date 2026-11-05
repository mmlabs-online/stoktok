export type ClaimsResult = { kind: 'ok'; userId: string } | { kind: 'unauthenticated' } | { kind: 'forbidden' };

/** Pure check of already signature-verified claims: issuer, audience/role, expiry, then the allowlist. */
export function checkClaims(
  claims: unknown,
  cfg: { issuer: string; allowlist: ReadonlySet<string> },
  nowSec: number,
): ClaimsResult {
  if (typeof claims !== 'object' || claims === null) return { kind: 'unauthenticated' };
  const c = claims as Record<string, unknown>;
  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp) || c.exp <= nowSec) return { kind: 'unauthenticated' };
  if (c.iss !== cfg.issuer) return { kind: 'unauthenticated' };
  const aud = c.aud;
  const audOk = Array.isArray(aud) ? aud.includes('authenticated') : aud === 'authenticated';
  if (!audOk || c.role !== 'authenticated') return { kind: 'unauthenticated' };
  if (typeof c.sub !== 'string' || c.sub === '') return { kind: 'unauthenticated' };
  const userId = c.sub.toLowerCase();
  return cfg.allowlist.has(userId) ? { kind: 'ok', userId } : { kind: 'forbidden' };
}

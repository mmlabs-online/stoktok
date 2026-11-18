// Readiness probe: public (R6 exemption, like /healthz); answers only whether the database round trip works.
// Body and logs never carry an error message: it can contain the host or credentials (R3).
// The result is memoised for a few seconds, so unauthenticated callers cannot drive one DB round trip per request.
import { DataError, getDb, pingDb } from '../../server/db';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 2_000;
const CACHE_MS = 3_000;
const headers = { 'cache-control': 'no-store' };

type Result = { ok: true } | { ok: false; code: string };
let cached: { at: number; result: Promise<Result> } | undefined;

async function check(): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    });
    await Promise.race([pingDb(getDb()), timeout]);
    return { ok: true };
  } catch (e) {
    const code = e instanceof DataError ? e.code : e instanceof Error && e.message === 'timeout' ? 'timeout' : 'config';
    console.error(JSON.stringify({ event: 'readyz_db_unavailable', code }));
    return { ok: false, code };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const now = performance.now();
  if (!cached || now - cached.at >= CACHE_MS) cached = { at: now, result: check() };
  const result = await cached.result;
  return result.ok
    ? Response.json({ status: 'ok' }, { headers })
    : Response.json({ status: 'unavailable' }, { status: 503, headers });
}

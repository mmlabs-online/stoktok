// Readiness probe: public (R6 exemption, like /healthz); answers only whether the database round trip works.
// Body and logs never carry an error message: it can contain the host or credentials (R3).
import { DataError, getDb, pingDb } from '../../server/db';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 2_000;
const headers = { 'cache-control': 'no-store' };

export async function GET(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    });
    await Promise.race([pingDb(getDb()), timeout]);
    return Response.json({ status: 'ok' }, { headers });
  } catch (e) {
    const code = e instanceof DataError ? e.code : e instanceof Error && e.message === 'timeout' ? 'timeout' : 'config';
    console.error(JSON.stringify({ event: 'readyz_db_unavailable', code }));
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}

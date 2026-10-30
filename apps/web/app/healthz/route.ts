// Liveness probe for the container healthcheck and the CI smoke test.
// No imports on purpose: it must answer without touching the database.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    { status: 'ok', version: process.env.STOKTOK_VERSION ?? null },
    { headers: { 'cache-control': 'no-store' } },
  );
}

import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import type { Ctx } from '../errors';
import { q } from './access';
import type { PgDb } from './client';
import type { Database } from './schema';

declare const db: PgDb;
declare const ctx: Ctx;

// Compile-time only: the function is never called.
export function typeFixtures() {
  // positive: plain row results
  void q(
    db,
    ctx,
    async (k) =>
      (await k
        .selectFrom('instruments' as never)
        .selectAll()
        .execute()) as { id: string }[],
  );
  void q(db, ctx, async () => 1 as number | null);
  void q(db, ctx, async (k) => (await sql`select 1`.execute(k)).rows);
  // @ts-expect-error a query builder (Compilable) must not escape
  void q(db, ctx, async (k) => k.selectFrom('instruments' as never).selectAll());
  // @ts-expect-error a Kysely handle must not escape
  void q(db, ctx, async (k) => k);
  // @ts-expect-error a Transaction handle must not escape
  void q(db, ctx, async (k) => k as Transaction<Database>);
  // @ts-expect-error a Kysely handle inside a union must not escape
  void q(db, ctx, async (k) => k as Kysely<Database> | null);
  // @ts-expect-error a transaction builder must not escape
  void q(db, ctx, async (k) => k.transaction());
  // @ts-expect-error a connection builder must not escape
  void q(db, ctx, async (k) => k.connection());
  // @ts-expect-error a query creator (with) must not escape
  void q(db, ctx, async (k) => k.with('x', (d) => d.selectNoFrom((eb) => eb.lit(1).as('a'))));
  // @ts-expect-error the introspector must not escape
  void q(db, ctx, async (k) => k.introspection);
  // @ts-expect-error any must not escape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fixture is the point
  void q(db, ctx, async (k) => k as any);
}

test('q() return-type fixtures are checked by typecheck', () => {
  expect(typeof typeFixtures).toBe('function');
});

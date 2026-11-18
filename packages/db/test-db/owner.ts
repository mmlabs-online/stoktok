// test:db owner role (STK-090). Tests run as this non-superuser login; the admin URL is used only for
// cluster-level work. The role is never dropped.
import { createHash } from 'node:crypto';

export interface QueryClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export const TEST_OWNER_ROLE = 'stoktok_test_owner';
export const OWNER_PASSWORD_LABEL = 'stoktok-test-owner:v1:';
/** Fixed advisory-lock key, different from MIGRATION_LOCK_KEY and outside hashtext's int4 range. */
export const OWNER_ROLE_LOCK_KEY = '7865372190';
const ATTRS = 'login nosuperuser nocreatedb nocreaterole noreplication nobypassrls';

/** Deterministic so concurrent runs agree; derived from the admin password only. */
export function ownerPassword(adminUrl: string): string {
  return createHash('sha256')
    .update(OWNER_PASSWORD_LABEL + decodeURIComponent(new URL(adminUrl).password))
    .digest('hex');
}

/** Swaps the userinfo for the owner's. Only call it with an admin-credential URL. */
export function asOwner(url: string): string {
  const password = ownerPassword(url);
  const u = new URL(url);
  u.username = TEST_OWNER_ROLE;
  u.password = password;
  return u.toString();
}

/** Creates or resets the owner role (admin connection). Never drops it. */
export async function ensureOwnerRole(c: QueryClient, password: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(password)) throw new Error('owner password must be 64 lowercase hex characters');
  const attempt = async () => {
    await c.query('begin');
    try {
      await c.query('select pg_advisory_xact_lock($1::bigint)', [OWNER_ROLE_LOCK_KEY]);
      const { rows } = await c.query('select 1 from pg_roles where rolname = $1', [TEST_OWNER_ROLE]);
      if (rows.length === 0) await c.query(`create role ${TEST_OWNER_ROLE} ${ATTRS} password '${password}'`);
      else await c.query(`alter role ${TEST_OWNER_ROLE} with ${ATTRS} password '${password}'`);
      await c.query(`alter role ${TEST_OWNER_ROLE} reset all`);
      const m = await c.query(
        'select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = $1',
        [TEST_OWNER_ROLE],
      );
      if (m.rows[0].n > 0) throw new Error(`${TEST_OWNER_ROLE} is a member of another role; remove the membership`);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    }
  };
  try {
    await attempt();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== '42710' && code !== '23505') throw e;
    await attempt();
  }
}

/** Run as admin in the target database: the owner owns `public`, PUBLIC has nothing on it. */
export async function ownPublicSchema(c: QueryClient): Promise<void> {
  await c.query(`alter schema public owner to ${TEST_OWNER_ROLE}`);
  await c.query('revoke all on schema public from public');
}

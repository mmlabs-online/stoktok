import { createHash } from 'node:crypto';

/** Non-superuser role that owns the test template, every clone and their public schema (STK-089). Never dropped. */
export const OWNER_ROLE = 'stoktok_test_owner';
/** pg_advisory_xact_lock key for creating the role; distinct from MIGRATION_LOCK_KEY. */
export const OWNER_ROLE_LOCK_KEY = '7865372089';

/** Deterministic, derived from the admin password so every worker process and run agrees. */
export function ownerPassword(admin: URL | string): string {
  const u = typeof admin === 'string' ? new URL(admin) : admin;
  return createHash('sha256').update(`${OWNER_ROLE}:${decodeURIComponent(u.password)}`).digest('hex');
}

/** The admin URL with the owner's credentials and the given database. Host, port and query are kept. */
export function ownerUrl(admin: URL | string, db: string): string {
  const u = new URL(typeof admin === 'string' ? admin : admin.toString());
  u.username = OWNER_ROLE;
  u.password = ownerPassword(admin);
  u.pathname = `/${db}`;
  return u.toString();
}

/** ALTER ROLE cannot take a bind parameter, so the password is asserted to be hex before it is inlined. */
export function ownerRoleSql(password: string): string {
  if (!/^[0-9a-f]{64}$/.test(password)) throw new Error('owner password must be 64 hex chars');
  if (!/^[a-z_]+$/.test(OWNER_ROLE)) throw new Error('bad owner role name');
  return `alter role ${OWNER_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`;
}

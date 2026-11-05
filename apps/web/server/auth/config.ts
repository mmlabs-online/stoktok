import 'server-only';

export type AuthConfig = {
  supabaseUrl: string;
  anonKey: string;
  issuer: string;
  allowlist: ReadonlySet<string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads the Authen settings (Supabase Auth of the stoktok project). Throws on anything missing or malformed (fail closed). */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const supabaseUrl = (env.AUTHEN_SUPABASE_URL ?? '').trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(supabaseUrl)) {
    throw new Error('auth config: AUTHEN_SUPABASE_URL must be https://<host> with no path');
  }
  const anonKey = (env.AUTHEN_SUPABASE_ANON_KEY ?? '').trim();
  if (!anonKey) throw new Error('auth config: AUTHEN_SUPABASE_ANON_KEY is missing');

  const ids = (env.ALLOWLIST_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '');
  if (ids.length === 0 || ids.some((id) => !UUID.test(id))) {
    throw new Error('auth config: ALLOWLIST_USER_IDS must be a non-empty list of UUIDs');
  }

  return { supabaseUrl, anonKey, issuer: `${supabaseUrl}/auth/v1`, allowlist: new Set(ids) };
}

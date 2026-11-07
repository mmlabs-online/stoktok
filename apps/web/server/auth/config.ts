import 'server-only';

export type AuthConfig = {
  supabaseUrl: string;
  anonKey: string;
  issuer: string;
};

/** Reads the Authen settings (Supabase Auth of the stoktok project). Throws on anything missing or malformed (fail closed). */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const supabaseUrl = (env.AUTHEN_SUPABASE_URL ?? '').trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(supabaseUrl)) {
    throw new Error('auth config: AUTHEN_SUPABASE_URL must be https://<host> with no path');
  }
  const anonKey = (env.AUTHEN_SUPABASE_ANON_KEY ?? '').trim();
  if (!anonKey) throw new Error('auth config: AUTHEN_SUPABASE_ANON_KEY is missing');

  return { supabaseUrl, anonKey, issuer: `${supabaseUrl}/auth/v1` };
}

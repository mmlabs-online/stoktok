import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Db = Pick<SupabaseClient, 'from'>;

/** Server-only (R3): reads the service role key from the given env object, never from a module global. */
export function createServiceClient(env: Record<string, string | undefined>): SupabaseClient {
  const url = env.SUPABASE_URL;
  if (!url) throw new Error('Missing env SUPABASE_URL');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing env SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

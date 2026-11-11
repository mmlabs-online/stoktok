-- STK-082 (ADR 0011, supersedes ADR 0009): AI provider keys are encrypted app-side (AES-256-GCM, packages/db/src/keyring.ts)
-- and stored in public.ai_keys as ciphertext. The master key (STOKTOK_AI_KEYS_MASTER_KEY) never reaches the database.
--
-- NEVER apply this migration to the live Supabase project: the running release still calls the Vault wrappers dropped here.
-- It is for db:check, test:db and the STK-083 baseline (the self-hosted Postgres). The guard below refuses a real Vault.
-- Keys stored by the previous shape are discarded on purpose and re-entered on Settings (ADR 0011). The Vault rows on
-- Supabase are cleaned in the STK-084 runbook, not here.
-- RLS and the service_role grants are the interim Supabase-shaped model; STK-083 removes them from the baseline.
-- The key format (20-256 printable ASCII) is checked by validateAiKeyFormat in packages/core/src/ai/keys.ts before sealing;
-- the database only sees ciphertext, so it checks the ciphertext length.

do $$
begin
  if pg_catalog.to_regnamespace('vault') is not null
     and pg_catalog.obj_description(pg_catalog.to_regnamespace('vault')::oid, 'pg_namespace') is distinct from 'stoktok db:check vault stub' then
    raise exception 'refusing to apply on a database with Supabase Vault (ADR 0011)';
  end if;
end $$;

drop function if exists public.ai_key_secrets();
drop function if exists public.ai_key_delete(text);
drop function if exists public.ai_key_set(text, text);
drop table if exists public.ai_keys;

create table public.ai_keys (
  provider text primary key check (provider in ('anthropic', 'google')),
  ciphertext bytea not null check (octet_length(ciphertext) between 20 and 256),
  iv bytea not null check (octet_length(iv) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null check (key_version >= 1),
  last4 text not null check (last4 ~ '^[\x21-\x7e]{4}$'),
  updated_at timestamptz not null default now()
);

comment on table public.ai_keys is 'AI provider keys, AES-256-GCM encrypted by the app (ADR 0011); AAD binds provider and key_version. Never holds a plaintext key';

alter table public.ai_keys enable row level security;
revoke all on public.ai_keys from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.ai_keys to service_role;

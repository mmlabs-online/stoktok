-- STK-074 (ADR 0009): AI provider API keys entered on Settings, stored in Supabase Vault.
-- public.ai_keys holds NO secret: only the provider, the Vault secret id and the last 4 characters (the only part ever shown).
-- public.ai_key_secrets() is the only decrypt path. Rolling back deletes the stored keys on purpose (ADR 0009).
-- The key format below (20-256 printable ASCII) repeats validateAiKeyFormat in packages/core/src/ai/keys.ts; keep them in sync.

do $$
begin
  if pg_catalog.to_regclass('vault.secrets') is null then
    raise exception 'supabase_vault is required: enable Vault on the project first';
  end if;
end $$;

create table public.ai_keys (
  provider text primary key check (provider in ('anthropic', 'google')),
  secret_id uuid not null unique,
  last4 text not null check (last4 ~ '^[\x21-\x7e]{4}$'),
  updated_at timestamptz not null default now()
);

comment on table public.ai_keys is 'Metadata of AI provider keys stored in Vault (secret named stoktok_ai_key_<provider>); never holds a key. Written only by ai_key_set / ai_key_delete';

alter table public.ai_keys enable row level security;
revoke all on public.ai_keys from public, anon, authenticated, service_role;
grant select on public.ai_keys to service_role;

-- (A regex repetition count is capped at 255, hence the separate length test.)
-- security definer: Vault privileges for service_role are not guaranteed, and this keeps the surface to three functions.
create function public.ai_key_set(p_provider text, p_key text)
returns table (key_last4 text, saved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
  v_last4 text;
  v_now timestamptz := pg_catalog.now();
begin
  if p_provider is null or p_provider not in ('anthropic', 'google')
     or p_key is null or pg_catalog.char_length(p_key) not between 20 and 256 or p_key !~ '^[\x21-\x7e]+$' then
    raise exception 'invalid ai key arguments' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_key.' || p_provider));
  v_name := 'stoktok_ai_key_' || p_provider;
  v_last4 := pg_catalog.right(p_key, 4);

  select k.secret_id into v_id
    from public.ai_keys k
    where k.provider = p_provider
      and exists (select 1 from vault.secrets s where s.id = k.secret_id);

  if v_id is not null then
    perform vault.update_secret(v_id, p_key);
  else
    delete from vault.secrets s where s.name = v_name;
    v_id := vault.create_secret(p_key, v_name, 'stoktok AI provider key');
  end if;

  insert into public.ai_keys (provider, secret_id, last4, updated_at)
    values (p_provider, v_id, v_last4, v_now)
    on conflict (provider) do update
      set secret_id = excluded.secret_id, last4 = excluded.last4, updated_at = excluded.updated_at;

  return query select v_last4, v_now;
end $$;

create function public.ai_key_delete(p_provider text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
  v_existed boolean;
begin
  if p_provider is null or p_provider not in ('anthropic', 'google') then
    raise exception 'invalid ai key arguments' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_key.' || p_provider));
  v_name := 'stoktok_ai_key_' || p_provider;

  select k.secret_id into v_id from public.ai_keys k where k.provider = p_provider;
  v_existed := found;

  delete from vault.secrets s where s.id = v_id or s.name = v_name;
  delete from public.ai_keys k where k.provider = p_provider;
  return v_existed;
end $$;

-- The single decrypt path: one round trip for both providers.
create function public.ai_key_secrets()
returns table (provider text, secret text)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  return query
    select k.provider, d.decrypted_secret
    from public.ai_keys k
    join vault.decrypted_secrets d on d.id = k.secret_id;
end $$;

revoke all on function public.ai_key_set(text, text) from public, anon, authenticated;
grant execute on function public.ai_key_set(text, text) to service_role;
revoke all on function public.ai_key_delete(text) from public, anon, authenticated;
grant execute on function public.ai_key_delete(text) to service_role;
revoke all on function public.ai_key_secrets() from public, anon, authenticated;
grant execute on function public.ai_key_secrets() to service_role;

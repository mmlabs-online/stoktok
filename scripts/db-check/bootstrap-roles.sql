-- TEST ONLY (never a migration). Mimics Supabase roles and default grants so the revoke is exercised.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- TEST ONLY (never a migration): minimal stand-in for Supabase Vault so the ai_key_* wrappers can be exercised. It stores plaintext; real Vault encrypts.
do $$
begin
  if pg_catalog.to_regnamespace('vault') is null then
    create schema vault;
    comment on schema vault is 'stoktok db:check vault stub';
    create table vault.secrets (
      id uuid primary key default gen_random_uuid(),
      name text unique,
      description text not null default '',
      secret text not null,
      key_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create view vault.decrypted_secrets as select s.*, s.secret as decrypted_secret from vault.secrets s;
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
      returns uuid language plpgsql as $f$
      declare v_id uuid;
      begin
        insert into vault.secrets (secret, name, description, key_id)
          values (new_secret, new_name, coalesce(new_description, ''), new_key_id) returning id into v_id;
        return v_id;
      end $f$;
    create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
      returns void language plpgsql as $f$
      begin
        update vault.secrets s set
          secret = coalesce(new_secret, s.secret),
          name = coalesce(new_name, s.name),
          description = coalesce(new_description, s.description),
          key_id = coalesce(new_key_id, s.key_id),
          updated_at = now()
        where s.id = secret_id;
      end $f$;
    revoke all on schema vault from public;
    revoke all on all tables in schema vault from public;
    revoke all on all functions in schema vault from public;
  end if;
end $$;

-- STK-074: deletes the stored AI keys (Vault rows) on purpose; re-enter them after a restore (ADR 0009). Never drops the extension or the schema.
drop function if exists public.ai_key_secrets();
drop function if exists public.ai_key_delete(text);
drop function if exists public.ai_key_set(text, text);

do $$
begin
  if pg_catalog.to_regclass('vault.secrets') is not null then
    if pg_catalog.to_regclass('public.ai_keys') is not null then
      delete from vault.secrets where id in (select secret_id from public.ai_keys);
    end if;
    delete from vault.secrets where name like 'stoktok\_ai\_key\_%';
  end if;
end $$;

drop table if exists public.ai_keys;

-- STK-069 rollback: restore the slice-1 ai_reserve body. The function is dropped by 20261109000100_ai_usage.down.sql.

create or replace function public.ai_reserve(
  p_provider text,
  p_model text,
  p_task text,
  p_reserve_micro_usd bigint,
  p_cap_micro_usd bigint,
  p_from timestamptz,
  p_to timestamptz
) returns table (usage_id bigint, granted boolean, spent_micro_usd bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_spent bigint;
  v_id bigint;
  v_granted boolean;
begin
  if p_provider is null or p_model is null or p_task is null
     or p_reserve_micro_usd is null or p_cap_micro_usd is null or p_from is null or p_to is null
     or p_reserve_micro_usd < 0 or p_cap_micro_usd <= 0 or p_from >= p_to then
    raise exception 'invalid ai_reserve arguments' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stoktok.ai_budget'));

  select coalesce(sum(coalesce(u.cost_micro_usd, u.reserved_micro_usd)), 0)::bigint into v_spent
    from public.ai_usage u
    where u.created_at >= p_from and u.created_at < p_to;

  v_granted := v_spent < p_cap_micro_usd and v_spent + p_reserve_micro_usd <= p_cap_micro_usd;

  if v_granted then
    insert into public.ai_usage (provider, model, task, status, reserved_micro_usd)
      values (p_provider, p_model, p_task, 'reserved', p_reserve_micro_usd)
      returning id into v_id;
  else
    insert into public.ai_usage (provider, model, task, status, reserved_micro_usd, cost_micro_usd, settled_at)
      values (p_provider, p_model, p_task, 'refused', p_reserve_micro_usd, 0, pg_catalog.now())
      returning id into v_id;
  end if;

  return query select v_id, v_granted, v_spent;
end $$;

revoke execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) to service_role;

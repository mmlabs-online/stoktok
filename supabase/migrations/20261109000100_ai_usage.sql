-- STK-063: AI usage ledger and the monthly budget gate. One row per AI call (or refusal). Rows never hold prompt or output text.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

create table public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  provider text not null check (provider in ('anthropic', 'google')),
  model text not null check (char_length(model) between 1 and 100),
  task text not null check (task ~ '^[a-z][a-z_]{0,49}$'),
  status text not null check (status in ('reserved', 'ok', 'provider_error', 'invalid_output', 'refused')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  reserved_micro_usd bigint not null check (reserved_micro_usd >= 0),
  cost_micro_usd bigint check (cost_micro_usd >= 0),
  error_code text check (error_code ~ '^[a-z0-9_]{1,100}$'),
  check (status <> 'reserved' or (cost_micro_usd is null and settled_at is null)),
  check (status not in ('ok', 'invalid_output') or (cost_micro_usd is not null and settled_at is not null)),
  check (status <> 'refused' or cost_micro_usd = 0),
  check (status <> 'provider_error' or settled_at is not null)
);

create index ai_usage_created_at_idx on public.ai_usage (created_at);

comment on table public.ai_usage is 'AI calls and refusals; never stores prompts or outputs (R9). Spend = sum(coalesce(cost_micro_usd, reserved_micro_usd)), so unsettled and unknown-cost rows stay counted at the worst case';
comment on column public.ai_usage.cost_micro_usd is 'integer micro-USD computed in packages/core from the configured price table; null = unknown (reservation stays counted)';
comment on column public.ai_usage.reserved_micro_usd is 'worst-case estimate reserved before the call, kept for audit';

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant select, insert, update, delete on public.ai_usage to service_role;

-- Atomic check-and-insert across processes (web and worker): the advisory lock serialises concurrent reservations.
create function public.ai_reserve(
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
     or p_reserve_micro_usd <= 0 or p_cap_micro_usd <= 0 or p_from >= p_to
     -- the window must contain the row's created_at (DB now()), or the sum checks the wrong month
     or pg_catalog.now() < p_from or pg_catalog.now() >= p_to then
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

create function public.ai_month_spend(p_from timestamptz, p_to timestamptz) returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(coalesce(u.cost_micro_usd, u.reserved_micro_usd)), 0)::bigint
    from public.ai_usage u
    where u.created_at >= p_from and u.created_at < p_to
$$;

revoke execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) to service_role;
revoke execute on function public.ai_month_spend(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_month_spend(timestamptz, timestamptz) to service_role;

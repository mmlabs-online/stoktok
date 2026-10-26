-- STK-015: medium-term signals. One row per (symbol, rule, day); suppressed rows are stored with their reasons.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

create table public.signals (
  id bigint generated always as identity primary key,
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  rule_id text not null check (rule_id ~ '^[a-z0-9_]{1,60}$'),
  horizon text not null check (horizon = 'medium'),
  signal_date date not null,
  status text not null check (status in ('ok', 'suppressed')),
  label text check (label in ('bullish', 'bearish', 'neutral')),
  value bigint,
  data_fresh boolean not null,
  reason_codes text[] not null default '{}',
  inputs_snapshot jsonb not null,
  rule_version smallint not null check (rule_version >= 1),
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (symbol, rule_id, horizon, signal_date),
  check (
    (status = 'ok' and label is not null and value is not null and cardinality(reason_codes) = 0)
    or (status = 'suppressed' and label is null and value is null and cardinality(reason_codes) > 0)
  ),
  check (data_fresh or status = 'suppressed'),
  check (
    cardinality(reason_codes) <= 20
    and array_position(reason_codes, null) is null
    and (cardinality(reason_codes) = 0 or array_to_string(reason_codes, ',') ~ '^[a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*$')
  ),
  check (jsonb_typeof(inputs_snapshot) = 'object' and pg_column_size(inputs_snapshot) <= 32768)
);

comment on column public.signals.signal_date is 'data date the signal is about (newest stored trade date or the expected one), not the run date';
comment on column public.signals.label is 'direction of a rule, never an action (R9/R10)';
comment on column public.signals.value is 'integer; unit per rule_id: pe_vs_sector and pb_vs_sector = premium vs sector median in ppm; price_vs_ma_N = distance from the N-day MA in ppm; earnings_growth_trend = signed streak of quarters';
comment on column public.signals.data_fresh is 'false when a data reason (stale, gap, missing, insufficient history) is among reason_codes';
comment on column public.signals.inputs_snapshot is 'refs with source and fetched_at, rule params and basis, for audit (R4)';

alter table public.signals enable row level security;
revoke all on public.signals from anon, authenticated;
revoke all on sequence public.signals_id_seq from anon, authenticated;
grant select, insert, update, delete on public.signals to service_role;
grant usage, select on sequence public.signals_id_seq to service_role;

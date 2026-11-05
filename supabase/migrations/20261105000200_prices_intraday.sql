-- STK-049: intraday prices (ADR 0006). One row per (symbol, source minute bar); re-polling within a minute updates the row.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

create table public.prices_intraday (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  ts timestamptz not null,
  price integer not null check (price > 0),
  volume bigint not null check (volume >= 0),
  source text not null check (source <> ''),
  fetched_at timestamptz not null,
  primary key (symbol, ts)
);

comment on column public.prices_intraday.ts is 'source minute-bar time (not fetch time)';
comment on column public.prices_intraday.price is 'integer VND (R2)';
comment on column public.prices_intraday.volume is 'session-cumulative volume: sum of the source''s minute volumes for that VN day';

alter table public.prices_intraday enable row level security;
revoke all on public.prices_intraday from public, anon, authenticated;
grant select, insert, update, delete on public.prices_intraday to service_role;

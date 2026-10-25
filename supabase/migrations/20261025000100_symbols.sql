-- STK-011: per-symbol exchange, shared by held and watched symbols.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

create table public.symbols (
  symbol text primary key check (symbol ~ '^[A-Z0-9]{1,20}$'),
  exchange text check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.symbols.exchange is 'NULL = unknown; never default to HOSE; mirrors core EXCHANGES';

alter table public.symbols enable row level security;
revoke all on public.symbols from anon, authenticated;
grant select, insert, update, delete on public.symbols to service_role;

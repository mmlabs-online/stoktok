-- STK-014: quarterly financials and a sector label per symbol.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

create table public.financials (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  period text not null check (period ~ '^[0-9]{4}Q[1-4]$'),
  eps bigint not null,
  bvps bigint not null,
  revenue bigint not null check (revenue >= 0),
  net_income bigint not null,
  source text not null,
  fetched_at timestamptz not null,
  primary key (symbol, period)
);

comment on column public.financials.period is 'source fiscal-quarter label, treated as calendar quarter';
comment on column public.financials.eps is 'VND per share as published by the source; basis (quarterly vs TTM, basic vs diluted) UNVERIFIED, see docs/adr/0002';
comment on column public.financials.bvps is 'VND per share as published by the source';
comment on column public.financials.revenue is 'VND (integer, R2), converted from source units in core';
comment on column public.financials.net_income is 'VND (integer, R2), converted from source units in core';

alter table public.financials enable row level security;
revoke all on public.financials from anon, authenticated;
grant select, insert, update, delete on public.financials to service_role;

alter table public.symbols
  add column sector text,
  add column sector_source text,
  add column sector_fetched_at timestamptz,
  add constraint symbols_sector_format check (sector is null or (length(sector) between 1 and 100 and sector = btrim(sector))),
  add constraint symbols_sector_provenance check (
    (sector is null) = (sector_source is null) and (sector is null) = (sector_fetched_at is null)
  );

comment on column public.symbols.sector is 'NULL = unknown; label as published by sector_source (R4)';

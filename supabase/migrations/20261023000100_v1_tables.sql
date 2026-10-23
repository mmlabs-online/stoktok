-- STK-003: v1.0 tables. Money is bigint VND, quantities/prices are integers (R2).
-- No `lots` table: lots are derived in packages/core (see supabase/README.md).

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  trade_date date not null,
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  side text not null check (side in ('buy', 'sell')),
  quantity integer not null check (quantity > 0),
  price integer not null check (price >= 0),
  fee bigint check (fee >= 0),
  tax bigint check (tax >= 0),
  source text not null default 'manual' check (source in ('manual', 'import')),
  import_batch_id text,
  external_ref text,
  created_at timestamptz not null default now(),
  unique (source, import_batch_id, external_ref)
);
comment on column public.transactions.seq is 'same-day ordering key; insert imports in file order';
comment on column public.transactions.fee is 'NULL = use settings estimate';
comment on column public.transactions.tax is 'NULL = use settings estimate';
create index transactions_symbol_date_seq_idx on public.transactions (symbol, trade_date, seq);

create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  type text not null check (type in ('cash_dividend', 'stock_dividend')),
  ex_date date not null,
  record_date date,
  pay_date date,
  listing_date date,
  amount_per_share bigint,
  ratio_num integer,
  ratio_den integer,
  created_at timestamptz not null default now(),
  constraint corporate_actions_type_shape check (
    (type = 'cash_dividend' and amount_per_share >= 0 and ratio_num is null and ratio_den is null)
    or
    (type = 'stock_dividend' and ratio_num > 0 and ratio_den > 0 and amount_per_share is null)
  ),
  unique (symbol, type, ex_date)
);
comment on table public.corporate_actions is '100:20 = ratio_den 100 held, ratio_num 20 received';
create index corporate_actions_symbol_ex_date_idx on public.corporate_actions (symbol, ex_date);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('cash', 'other')),
  name text not null,
  value bigint not null check (value >= 0),
  as_of date not null,
  created_at timestamptz not null default now()
);
create index assets_type_as_of_idx on public.assets (type, as_of desc);

create table public.watchlist (
  symbol text primary key check (symbol ~ '^[A-Z0-9]{1,20}$'),
  group_name text not null default 'watching',
  added_at timestamptz not null default now()
);

create table public.settings (
  id smallint primary key default 1 check (id = 1),
  fee_rate_ppm integer check (fee_rate_ppm >= 0),
  sell_tax_rate_ppm integer not null check (sell_tax_rate_ppm >= 0),
  dividend_withholding_rate_ppm integer not null check (dividend_withholding_rate_ppm >= 0),
  settlement_days smallint not null check (settlement_days >= 0),
  holidays date[] not null default '{}',
  cash_dividend_treatment text not null check (cash_dividend_treatment in ('reduceCost', 'income')),
  cost_method text not null check (cost_method = 'WAC'),
  concentration_threshold_ppm integer check (concentration_threshold_ppm between 0 and 1000000),
  rule_configs jsonb not null default '{}' check (jsonb_typeof(rule_configs) = 'object'),
  updated_at timestamptz not null default now()
);
comment on column public.settings.fee_rate_ppm is 'user setting (TCBS rate); NULL until entered, no default';
comment on column public.settings.rule_configs is 'R5 per-exchange price limits, lot size, signal rule params; no money values (R2)';

create table public.prices_daily (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  trade_date date not null,
  open integer not null,
  high integer not null,
  low integer not null,
  close integer not null,
  volume bigint not null check (volume >= 0),
  foreign_net bigint,
  source text not null,
  fetched_at timestamptz not null,
  primary key (symbol, trade_date),
  check (low >= 0 and low <= high and open between low and high and close between low and high)
);
comment on column public.prices_daily.foreign_net is 'signed net foreign buy-sell value, VND';

create table public.data_gaps (
  id bigint generated always as identity primary key,
  symbol text check (symbol ~ '^[A-Z0-9]{1,20}$'),
  data_type text not null,
  from_ts timestamptz not null,
  to_ts timestamptz not null check (to_ts >= from_ts),
  detected_at timestamptz not null default now(),
  source text not null,
  fetched_at timestamptz not null,
  resolved_at timestamptz
);
comment on column public.data_gaps.symbol is 'NULL = market-wide gap';
create index data_gaps_symbol_from_idx on public.data_gaps (symbol, from_ts);

-- STK-083: plain-Postgres baseline, squashed from supabase/migrations 20261023000100 - 20261111000100.
-- Single-owner model (ADR 0010 section 7): the login role that runs this file owns every object.
-- No RLS, no grants and no Vault. The only privilege statements are the two revokes on the ai_* functions.
-- Faithfulness proof: work/tickets/STK-083/schema-diff.md (scripts/schema-diff.sh).
-- Never edit this file once applied; add a new migration instead.

-- from 20261023000100_v1_tables.sql
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

-- from 20261025000100_symbols.sql
-- STK-011: per-symbol exchange, shared by held and watched symbols.

create table public.symbols (
  symbol text primary key check (symbol ~ '^[A-Z0-9]{1,20}$'),
  exchange text check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.symbols.exchange is 'NULL = unknown; never default to HOSE; mirrors core EXCHANGES';

-- from 20261026000100_financials.sql
-- STK-014: quarterly financials and a sector label per symbol.

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

alter table public.symbols
  add column sector text,
  add column sector_source text,
  add column sector_fetched_at timestamptz,
  add constraint symbols_sector_format check (sector is null or (length(sector) between 1 and 100 and sector = btrim(sector))),
  add constraint symbols_sector_provenance check (
    (sector is null) = (sector_source is null) and (sector is null) = (sector_fetched_at is null)
  );

comment on column public.symbols.sector is 'NULL = unknown; label as published by sector_source (R4)';

-- from 20261026000200_signals.sql
-- STK-015: medium-term signals. One row per (symbol, rule, day); suppressed rows are stored with their reasons.

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

-- from 20261105000100_data_gaps_resolved_reason.sql
-- STK-046: record why a data gap was resolved. Additive and nullable; works with the previous worker image.
alter table public.data_gaps
  add column resolved_reason text,
  add constraint data_gaps_resolved_reason_check check (resolved_reason is null or resolved_reason in ('data_stored','non_trading_day')),
  add constraint data_gaps_resolved_reason_needs_resolved check (resolved_reason is null or resolved_at is not null);

comment on column public.data_gaps.resolved_reason is 'Why the gap was resolved (STK-046). NULL: resolved before STK-046 or by a job that records no reason (financials).';

-- from 20261105000200_prices_intraday.sql
-- STK-049: intraday prices (ADR 0006). One row per (symbol, source minute bar); re-polling within a minute updates the row.

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

-- from 20261106000100_lottery.sql
-- STK-053: Vietlott tracker schema (F8). Draw results (worker-fetched, R4) and personal tickets (recorded only, R10).
-- Game rules (number ranges, bao sizes, prizes, tax) live in packages/core (R5); SQL keeps loose structural bounds only.

create table public.lottery_draws (
  game text not null check (game in ('mega645', 'power655')),
  draw_no integer not null check (draw_no > 0),
  draw_date date not null,
  numbers smallint[] not null,
  bonus smallint,
  jackpot_vnd bigint,
  jackpot_winners integer,
  jackpot2_vnd bigint,
  jackpot2_winners integer,
  source text not null check (source <> ''),
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (game, draw_no),
  constraint lottery_draws_numbers_shape check (
    cardinality(numbers) = 6 and array_position(numbers, null) is null and 1 <= all (numbers) and 55 >= all (numbers)
  ),
  constraint lottery_draws_bonus_shape check ((game = 'power655') = (bonus is not null) and (bonus is null or bonus between 1 and 55)),
  constraint lottery_draws_jackpot_shape check (
    (jackpot_vnd is null) = (jackpot_winners is null) and jackpot_vnd >= 0 and jackpot_winners >= 0
  ),
  constraint lottery_draws_jackpot2_shape check (
    (jackpot2_vnd is null) = (jackpot2_winners is null) and jackpot2_vnd >= 0 and jackpot2_winners >= 0
  ),
  constraint lottery_draws_jackpot2_power_only check (game = 'power655' or (jackpot2_vnd is null and jackpot2_winners is null))
);

comment on column public.lottery_draws.jackpot_vnd is 'integer VND (R2): tier jackpot for mega645, jackpot1 for power655';
comment on column public.lottery_draws.jackpot2_vnd is 'integer VND (R2): power655 tier jackpot2 only';

create table public.lottery_tickets (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('mega645', 'power655')),
  draw_no integer not null check (draw_no > 0),
  lines jsonb not null check (
    jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50 and pg_column_size(lines) <= 8192
  ),
  cost_vnd bigint not null check (cost_vnd >= 0),
  channel text not null check (channel in ('sms', 'momo', 'manual')),
  purchased_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  prize_tier text check (prize_tier in ('jackpot', 'jackpot1', 'jackpot2', 'first', 'second', 'third')),
  gross_vnd bigint check (gross_vnd >= 0),
  checked_at timestamptz,
  raw_text text check (raw_text is null or char_length(raw_text) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint lottery_tickets_status_shape check (
    (status = 'pending' and prize_tier is null and gross_vnd is null and checked_at is null)
    or (status = 'lost' and prize_tier is null and gross_vnd is not null and gross_vnd = 0 and checked_at is not null)
    or (status = 'won' and prize_tier is not null and gross_vnd is not null and gross_vnd > 0 and checked_at is not null)
  )
);

comment on column public.lottery_tickets.lines is 'jsonb array of number arrays, canonical order (core canonicalTicketLines); line length is its system size';
comment on column public.lottery_tickets.cost_vnd is 'integer VND (R2)';
comment on column public.lottery_tickets.gross_vnd is 'integer VND (R2), before tax; tax and net are recomputed by core';
comment on column public.lottery_tickets.raw_text is 'pasted confirmation text, verbatim';

-- Raw text is stored verbatim; whitespace is normalised only for the uniqueness key.
create unique index lottery_tickets_raw_text_uidx
  on public.lottery_tickets (md5(regexp_replace(btrim(raw_text), '\s+', ' ', 'g')))
  where raw_text is not null;
-- md5 keeps the index row under the btree size limit for large bao tickets.
create unique index lottery_tickets_sms_identity_uidx
  on public.lottery_tickets (game, draw_no, purchased_at, md5(lines::text))
  where channel = 'sms';
create index lottery_tickets_pending_idx on public.lottery_tickets (game, draw_no) where status = 'pending';
create index lottery_tickets_game_purchased_idx on public.lottery_tickets (game, purchased_at desc);

-- from 20261108000100_financial_lines.sql
-- STK-061: statement lines for the AI layer (ADR 0007). One row per (symbol, period_kind, period, line).

create table public.financial_lines (
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,20}$'),
  period_kind text not null check (period_kind in ('quarter', 'year')),
  period text not null,
  statement text not null check (statement in ('income', 'balance', 'cashflow')),
  line text not null check (line ~ '^[a-z][a-z0-9_]{1,63}$'),
  value bigint not null,
  source text not null check (source <> ''),
  fetched_at timestamptz not null,
  primary key (symbol, period_kind, period, line),
  check (
    (period_kind = 'quarter' and period ~ '^[0-9]{4}Q[1-4]$')
    or (period_kind = 'year' and period ~ '^[0-9]{4}$')
  )
);

comment on column public.financial_lines.period is 'source fiscal label treated as calendar: YYYYQn for quarter rows, YYYY for year rows';
comment on column public.financial_lines.statement is 'cashflow is allowed now so the cash-flow slice needs no migration';
comment on column public.financial_lines.line is 'registry name from packages/core statement-lines; operating_profit is the VAS "Lai/(lo) tu hoat dong kinh doanh", NOT EBIT; *_borrowings are "Vay" lines only and may exclude bonds and leases';
comment on column public.financial_lines.value is 'integer VND (R2); sign is meaningful (losses are negative)';
comment on table public.financial_lines is 'a missing line is a missing row, never 0 (R4); the gap is recorded in data_gaps';

-- from 20261108000200_news.sql
-- STK-062: news articles collected from RSS (F5). One row per article url.

create table public.news (
  id bigint generated always as identity primary key,
  url text not null unique check (url ~ '^https?://' and char_length(url) <= 2048),
  title text not null check (char_length(title) between 1 and 500),
  source text not null check (source <> ''),
  credibility text not null check (credibility in ('official_disclosure', 'established_outlet')),
  published_at timestamptz not null,
  fetched_at timestamptz not null,
  symbols text[] not null default '{}' check (
    cardinality(symbols) <= 50
    and array_to_string(symbols, ',') ~ '^([A-Z0-9]{1,20}(,[A-Z0-9]{1,20})*)?$'
  ),
  excerpt text not null default '' check (char_length(excerpt) <= 10000),
  check (published_at <= fetched_at + interval '1 day')
);

create index news_published_at_idx on public.news (published_at desc, id desc);
create index news_symbols_idx on public.news using gin (symbols);

comment on table public.news is 'RSS articles; rows are referenced by future suggestions.news_ids by id, so they must not be silently deleted';
comment on column public.news.title is 'UNTRUSTED plain text from a third party: never render as HTML, never treat as instructions (R9)';
comment on column public.news.excerpt is 'UNTRUSTED plain text (tags stripped, capped by worker config): never render as HTML, never treat as instructions (R9)';
comment on column public.news.source is 'outlet display name (R4); fetched_at is when we read it, published_at is the outlet time';
comment on column public.news.credibility is 'spec F5 tag: official_disclosure > established_outlet; social is not collected';
comment on column public.news.symbols is 'tickers linked by packages/core linkSymbols; empty = none linked (spec section 5 has one symbol column, which cannot hold several)';

-- from 20261109000100_ai_usage.sql and 20261110000100_ai_reserve_harden.sql (final ai_reserve body)
-- STK-063: AI usage ledger and the monthly budget gate. One row per AI call (or refusal). Rows never hold prompt or output text.

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

revoke execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) from public;
revoke execute on function public.ai_month_spend(timestamptz, timestamptz) from public;

-- from 20261110000300_ai_summaries.sql
-- STK-064: daily AI summaries, one row per (scope, symbol, summary_date). A rerun replaces the row.
-- The body shape is validated in packages/core (parseStoredSummaryBody); the checks below are a coarse guard only.

create table public.ai_summaries (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('symbol', 'portfolio')),
  symbol text not null default '',
  summary_date date not null,
  generator text not null check (generator in ('model', 'template')),
  provider text check (provider in ('anthropic', 'google')),
  model text check (char_length(model) between 1 and 100),
  usage_id bigint references public.ai_usage (id) on delete set null,
  body_version smallint not null default 1 check (body_version >= 1),
  body jsonb not null,
  input_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (scope, symbol, summary_date),
  check ((scope = 'symbol' and symbol ~ '^[A-Z0-9]{1,20}$') or (scope = 'portfolio' and symbol = '')),
  check (
    (generator = 'model' and provider is not null and model is not null)
    or (generator = 'template' and provider is null and model is null and usage_id is null)
  ),
  check (jsonb_typeof(body) = 'object' and body ? 'sections' and jsonb_typeof(body -> 'sections') = 'array' and pg_column_size(body) <= 32768),
  check (
    cardinality(input_ids) <= 200
    and array_position(input_ids, null) is null
    and (cardinality(input_ids) = 0 or array_to_string(input_ids, ',') ~ '^[A-Za-z0-9_.:-]{1,64}(,[A-Za-z0-9_.:-]{1,64})*$')
  )
);

create index ai_summaries_date_idx on public.ai_summaries (summary_date desc);
create index ai_summaries_usage_id_idx on public.ai_summaries (usage_id);

comment on table public.ai_summaries is 'Daily AI summaries per symbol and for the single v1 portfolio (symbol = ''''). No prompt or untrusted article text is stored; a skipped or failed run writes no row';
comment on column public.ai_summaries.summary_date is 'VN session date the summary is about, not the run date';
comment on column public.ai_summaries.body is 'MODEL OUTPUT after core validation; plain text only, never HTML (R9)';
comment on column public.ai_summaries.input_ids is 'provided input ids plus missing: markers (each sentence''s own ids are in body)';
comment on column public.ai_summaries.created_at is 'time of the latest (re)generation, refreshed on replace';
comment on column public.ai_summaries.usage_id is 'cost lives in ai_usage; no tokens or cost are copied here';

-- from 20261111000100_ai_keys_app_encryption.sql (final shape, ADR 0011)
create table public.ai_keys (
  provider text primary key check (provider in ('anthropic', 'google')),
  ciphertext bytea not null check (octet_length(ciphertext) between 20 and 256),
  iv bytea not null check (octet_length(iv) = 12),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null check (key_version >= 1),
  last4 text not null check (last4 ~ '^[\x21-\x7e]{4}$'),
  updated_at timestamptz not null default now()
);

comment on table public.ai_keys is 'AI provider keys, AES-256-GCM encrypted by the app (ADR 0011); AAD binds provider and key_version. Never holds a plaintext key';

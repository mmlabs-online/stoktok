-- STK-061: statement lines for the AI layer (ADR 0007). One row per (symbol, period_kind, period, line).
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

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

alter table public.financial_lines enable row level security;
revoke all on public.financial_lines from public, anon, authenticated;
grant select, insert, update, delete on public.financial_lines to service_role;

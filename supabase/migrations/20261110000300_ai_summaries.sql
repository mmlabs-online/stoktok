-- STK-064: daily AI summaries, one row per (scope, symbol, summary_date). A rerun replaces the row.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.
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

alter table public.ai_summaries enable row level security;
revoke all on public.ai_summaries from public, anon, authenticated;
grant select, insert, update, delete on public.ai_summaries to service_role;

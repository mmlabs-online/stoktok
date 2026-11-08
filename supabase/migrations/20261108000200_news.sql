-- STK-062: news articles collected from RSS (F5). One row per article url.
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.

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

alter table public.news enable row level security;
revoke all on public.news from public, anon, authenticated;
grant select, insert, update, delete on public.news to service_role;

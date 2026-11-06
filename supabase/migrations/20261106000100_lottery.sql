-- STK-053: Vietlott tracker schema (F8). Draw results (worker-fetched, R4) and personal tickets (recorded only, R10).
-- RLS and grants are in this file because the grants loop in 20261023000200 covers only tables that existed then.
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

alter table public.lottery_draws enable row level security;
revoke all on public.lottery_draws from public, anon, authenticated;
grant select, insert, update, delete on public.lottery_draws to service_role;

alter table public.lottery_tickets enable row level security;
revoke all on public.lottery_tickets from public, anon, authenticated;
grant select, insert, update, delete on public.lottery_tickets to service_role;

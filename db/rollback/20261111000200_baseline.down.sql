-- Test-only rollback of the baseline (never shipped, never run in production; recovery is the pre-migration dump).
drop function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz);
drop function public.ai_month_spend(timestamptz, timestamptz);

drop table public.ai_summaries;
drop table public.ai_usage;
drop table public.ai_keys;
drop table public.financial_lines;
drop table public.news;
drop table public.lottery_tickets;
drop table public.lottery_draws;
drop table public.prices_intraday;
drop table public.signals;
drop table public.financials;
drop table public.symbols;
drop table public.data_gaps;
drop table public.prices_daily;
drop table public.settings;
drop table public.watchlist;
drop table public.assets;
drop table public.corporate_actions;
drop table public.transactions;

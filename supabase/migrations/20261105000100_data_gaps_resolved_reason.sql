-- STK-046: record why a data gap was resolved. Additive and nullable; works with the previous worker image.
alter table public.data_gaps
  add column resolved_reason text,
  add constraint data_gaps_resolved_reason_check check (resolved_reason is null or resolved_reason in ('data_stored','non_trading_day')),
  add constraint data_gaps_resolved_reason_needs_resolved check (resolved_reason is null or resolved_at is not null);

comment on column public.data_gaps.resolved_reason is 'Why the gap was resolved (STK-046). NULL: resolved before STK-046 or by a job that records no reason (financials).';

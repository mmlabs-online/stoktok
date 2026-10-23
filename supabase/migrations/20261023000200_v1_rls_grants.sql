-- STK-003: RLS on, no policies, no anon/authenticated access (R3). Server uses service_role only.

do $$
declare t text;
begin
  foreach t in array array['transactions','corporate_actions','assets','watchlist','settings','prices_daily','data_gaps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

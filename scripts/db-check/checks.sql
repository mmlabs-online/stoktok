-- STK-003 schema checks, run as the (non-superuser) app owner role (STK-086). Run with ON_ERROR_STOP=1; any failure raises 'CHECK FAILED: <name>'.
-- Everything runs in one transaction that is rolled back at the end.
begin;

-- Helper: run a statement in a sub-transaction and require it to fail with one of the SQLSTATEs.
create function pg_temp.expect_fail(name text, stmt text, states text[]) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = any (states) then
      return;
    end if;
    raise exception 'CHECK FAILED: % (unexpected SQLSTATE % : %)', name, sqlstate, sqlerrm;
  end;
  raise exception 'CHECK FAILED: % (statement succeeded)', name;
end $$;

-- Helper: assert a column's data_type (and optional NOT NULL).
create function pg_temp.assert_col(tbl text, col text, typ text, not_null boolean default null) returns void language plpgsql as $$
declare r record;
begin
  select data_type, is_nullable into r from information_schema.columns
    where table_schema = 'public' and table_name = tbl and column_name = col;
  if not found or r.data_type <> typ or (not_null is not null and (r.is_nullable = 'NO') <> not_null) then
    raise exception 'CHECK FAILED: column %.% expected % (not_null=%), got %', tbl, col, typ, not_null, r;
  end if;
end $$;

do $$ -- runs_as_owner
begin
  if not exists (select 1 from pg_database d join pg_roles r on r.oid = d.datdba
                 where d.datname = current_database() and r.rolname = current_user and not r.rolsuper) then
    raise exception 'CHECK FAILED: runs_as_owner (% is not a non-superuser database owner)', current_user;
  end if;
end $$;

do $$ -- owner_role_flags
begin
  if exists (select 1 from pg_roles where rolname = current_user
             and (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls)) then
    raise exception 'CHECK FAILED: owner_role_flags (% has a privileged flag)', current_user;
  end if;
end $$;

do $$ -- owner_cannot_create_role
begin
  perform pg_temp.expect_fail('owner_cannot_create_role', 'create role dbcheck_zz', array['42501']);
end $$;

do $$ -- extensions_plpgsql_only
declare got text[];
begin
  select array_agg(extname order by extname) into got from pg_extension;
  if got is distinct from array['plpgsql'] then raise exception 'CHECK FAILED: extensions_plpgsql_only (got %)', got; end if;
end $$;

do $$ -- tables_exist
declare got text[];
begin
  select array_agg(tablename order by tablename) into got from pg_tables where schemaname = 'public';
  if got is distinct from array['ai_keys','ai_summaries','ai_usage','assets','corporate_actions','data_gaps','financial_lines','financials','lottery_draws','lottery_tickets','news','prices_daily','prices_intraday','settings','signals','symbols','transactions','watchlist'] then
    raise exception 'CHECK FAILED: tables_exist (got %)', got;
  end if;
end $$;

do $$ -- no_numeric_or_float_columns
declare n int;
begin
  select count(*) into n from information_schema.columns
    where table_schema = 'public' and data_type in ('numeric', 'real', 'double precision', 'money');
  if n <> 0 then raise exception 'CHECK FAILED: no_numeric_or_float_columns (% found)', n; end if;
end $$;

do $$ -- money_columns_bigint
begin
  perform pg_temp.assert_col('transactions', 'fee', 'bigint');
  perform pg_temp.assert_col('transactions', 'tax', 'bigint');
  perform pg_temp.assert_col('transactions', 'seq', 'bigint');
  perform pg_temp.assert_col('corporate_actions', 'amount_per_share', 'bigint');
  perform pg_temp.assert_col('assets', 'value', 'bigint', true);
  perform pg_temp.assert_col('prices_daily', 'volume', 'bigint', true);
  perform pg_temp.assert_col('prices_daily', 'foreign_net', 'bigint');
  perform pg_temp.assert_col('prices_intraday', 'volume', 'bigint', true);
  perform pg_temp.assert_col('lottery_draws', 'jackpot_vnd', 'bigint');
  perform pg_temp.assert_col('lottery_draws', 'jackpot2_vnd', 'bigint');
  perform pg_temp.assert_col('lottery_tickets', 'cost_vnd', 'bigint', true);
  perform pg_temp.assert_col('lottery_tickets', 'gross_vnd', 'bigint');
end $$;

do $$ -- qty_price_columns_integer
begin
  perform pg_temp.assert_col('transactions', 'quantity', 'integer', true);
  perform pg_temp.assert_col('transactions', 'price', 'integer', true);
  perform pg_temp.assert_col('prices_daily', 'open', 'integer', true);
  perform pg_temp.assert_col('prices_daily', 'high', 'integer', true);
  perform pg_temp.assert_col('prices_daily', 'low', 'integer', true);
  perform pg_temp.assert_col('prices_daily', 'close', 'integer', true);
  perform pg_temp.assert_col('prices_intraday', 'price', 'integer', true);
  perform pg_temp.assert_col('corporate_actions', 'ratio_num', 'integer');
  perform pg_temp.assert_col('corporate_actions', 'ratio_den', 'integer');
  perform pg_temp.assert_col('settings', 'fee_rate_ppm', 'integer');
  perform pg_temp.assert_col('settings', 'sell_tax_rate_ppm', 'integer', true);
  perform pg_temp.assert_col('settings', 'dividend_withholding_rate_ppm', 'integer', true);
end $$;

do $$ -- corporate_action_columns
begin
  perform pg_temp.assert_col('corporate_actions', 'ex_date', 'date', true);
  perform pg_temp.assert_col('corporate_actions', 'record_date', 'date');
  perform pg_temp.assert_col('corporate_actions', 'pay_date', 'date');
  perform pg_temp.assert_col('corporate_actions', 'listing_date', 'date');
end $$;

do $$ -- transactions_seq_identity_unique
declare ident text; uniq int;
begin
  select is_identity into ident from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'seq';
  select count(*) into uniq from pg_constraint
    where conrelid = 'public.transactions'::regclass and contype = 'u'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.transactions'::regclass and attname = 'seq')];
  if ident <> 'YES' or uniq <> 1 then raise exception 'CHECK FAILED: transactions_seq_identity_unique'; end if;
end $$;

do $$ -- source_fetched_at_not_null
begin
  perform pg_temp.assert_col('prices_daily', 'source', 'text', true);
  perform pg_temp.assert_col('prices_daily', 'fetched_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('prices_intraday', 'source', 'text', true);
  perform pg_temp.assert_col('prices_intraday', 'fetched_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('prices_intraday', 'ts', 'timestamp with time zone', true);
  perform pg_temp.assert_col('lottery_draws', 'source', 'text', true);
  perform pg_temp.assert_col('lottery_draws', 'fetched_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('financials', 'source', 'text', true);
  perform pg_temp.assert_col('financials', 'fetched_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('data_gaps', 'source', 'text', true);
  perform pg_temp.assert_col('data_gaps', 'fetched_at', 'timestamp with time zone', true);
end $$;

do $$ -- data_gaps_resolved_reason
begin
  perform pg_temp.assert_col('data_gaps', 'resolved_reason', 'text', false);
  if not exists (select 1 from pg_constraint where conrelid = 'public.data_gaps'::regclass and conname = 'data_gaps_resolved_reason_check') then
    raise exception 'data_gaps_resolved_reason_check missing';
  end if;
end $$;

do $$ -- settings_columns
declare n int;
begin
  perform pg_temp.assert_col('settings', 'cash_dividend_treatment', 'text', true);
  select count(*) into n from pg_constraint
    where conrelid = 'public.settings'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%cash_dividend_treatment%';
  if n < 1 then raise exception 'CHECK FAILED: settings_columns (no check on cash_dividend_treatment)'; end if;
end $$;

do $$ -- symbols_columns
begin
  perform pg_temp.assert_col('symbols', 'symbol', 'text', true);
  perform pg_temp.assert_col('symbols', 'exchange', 'text', false);
  perform pg_temp.assert_col('symbols', 'sector', 'text', false);
  perform pg_temp.assert_col('symbols', 'sector_source', 'text', false);
  perform pg_temp.assert_col('symbols', 'sector_fetched_at', 'timestamp with time zone', false);
end $$;

do $$ -- financials_columns
begin
  perform pg_temp.assert_col('financials', 'symbol', 'text', true);
  perform pg_temp.assert_col('financials', 'period', 'text', true);
  perform pg_temp.assert_col('financials', 'eps', 'bigint', true);
  perform pg_temp.assert_col('financials', 'bvps', 'bigint', true);
  perform pg_temp.assert_col('financials', 'revenue', 'bigint', true);
  perform pg_temp.assert_col('financials', 'net_income', 'bigint', true);
end $$;

do $$ -- news_columns
begin
  perform pg_temp.assert_col('news', 'id', 'bigint', true);
  perform pg_temp.assert_col('news', 'url', 'text', true);
  perform pg_temp.assert_col('news', 'title', 'text', true);
  perform pg_temp.assert_col('news', 'source', 'text', true);
  perform pg_temp.assert_col('news', 'credibility', 'text', true);
  perform pg_temp.assert_col('news', 'published_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('news', 'fetched_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('news', 'symbols', 'ARRAY', true);
  perform pg_temp.assert_col('news', 'excerpt', 'text', true);
end $$;

do $$ -- financial_lines_columns
begin
  perform pg_temp.assert_col('financial_lines', 'symbol', 'text', true);
  perform pg_temp.assert_col('financial_lines', 'period_kind', 'text', true);
  perform pg_temp.assert_col('financial_lines', 'period', 'text', true);
  perform pg_temp.assert_col('financial_lines', 'statement', 'text', true);
  perform pg_temp.assert_col('financial_lines', 'line', 'text', true);
  perform pg_temp.assert_col('financial_lines', 'value', 'bigint', true);
  perform pg_temp.assert_col('financial_lines', 'source', 'text', true);
  perform pg_temp.assert_col('financial_lines', 'fetched_at', 'timestamp with time zone', true);
end $$;

do $$ -- signals_columns
begin
  perform pg_temp.assert_col('signals', 'symbol', 'text', true);
  perform pg_temp.assert_col('signals', 'status', 'text', true);
  perform pg_temp.assert_col('signals', 'value', 'bigint', false);
  perform pg_temp.assert_col('signals', 'signal_date', 'date', true);
  perform pg_temp.assert_col('signals', 'data_fresh', 'boolean', true);
  perform pg_temp.assert_col('signals', 'reason_codes', 'ARRAY', true);
  perform pg_temp.assert_col('signals', 'inputs_snapshot', 'jsonb', true);
  perform pg_temp.assert_col('signals', 'computed_at', 'timestamp with time zone', true);
end $$;

do $$ -- rls_disabled_all_tables (single-owner model: no RLS, access is the owner role only)
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind in ('r', 'p') and (c.relrowsecurity or c.relforcerowsecurity);
  if n <> 0 then raise exception 'CHECK FAILED: rls_disabled_all_tables (% with RLS)', n; end if;
end $$;

do $$ -- no_policies
declare n int;
begin
  select count(*) into n from pg_policies where schemaname = 'public';
  if n <> 0 then raise exception 'CHECK FAILED: no_policies (% found)', n; end if;
end $$;

do $$ -- owner_can_read_write
declare n int;
begin
  insert into public.watchlist (symbol) values ('FPT');
  select count(*) into n from public.watchlist where symbol = 'FPT';
  delete from public.watchlist where symbol = 'FPT';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write'; end if;
end $$;

do $$ -- owner_can_read_write_symbols
declare n int;
begin
  insert into public.symbols (symbol, exchange) values ('FPT', 'HOSE');
  select count(*) into n from public.symbols where symbol = 'FPT';
  delete from public.symbols where symbol = 'FPT';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write_symbols'; end if;
end $$;

do $$ -- owner_can_read_write_financial_lines
declare n int;
begin
  insert into public.financial_lines (symbol, period_kind, period, statement, line, value, source, fetched_at)
    values ('FPT', 'quarter', '2026Q1', 'income', 'net_income_parent', -5, 'x', now());
  select count(*) into n from public.financial_lines where symbol = 'FPT';
  delete from public.financial_lines where symbol = 'FPT';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write_financial_lines'; end if;
end $$;

do $$ -- owner_can_read_write_news
declare n int;
begin
  insert into public.news (url, title, source, credibility, published_at, fetched_at, symbols)
    values ('https://cafef.vn/a-1.chn', 't', 'CafeF', 'established_outlet', now(), now(), '{HPG,VIC}');
  select count(*) into n from public.news where symbols @> '{HPG}';
  delete from public.news where url = 'https://cafef.vn/a-1.chn';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write_news'; end if;
end $$;

do $$ -- owner_can_read_write_financials
declare n int;
begin
  insert into public.financials (symbol, period, eps, bvps, revenue, net_income, source, fetched_at)
    values ('FPT', '2026Q1', 1000, 20000, 1000000000, 100000000, 'x', now());
  select count(*) into n from public.financials where symbol = 'FPT';
  delete from public.financials where symbol = 'FPT';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write_financials'; end if;
end $$;

do $$ -- owner_can_read_write_signals
declare n int; id1 bigint; id2 bigint;
begin
  insert into public.signals (symbol, rule_id, horizon, signal_date, status, label, value, data_fresh, inputs_snapshot, rule_version, computed_at)
    values ('FPT', 'price_vs_ma_50', 'medium', '2026-10-26', 'ok', 'neutral', 0, true, '{}', 1, now())
    returning id into id1;
  insert into public.signals (symbol, rule_id, horizon, signal_date, status, label, value, data_fresh, inputs_snapshot, rule_version, computed_at)
    values ('FPT', 'price_vs_ma_50', 'medium', '2026-10-26', 'ok', 'bullish', 30000, true, '{}', 1, now())
    on conflict (symbol, rule_id, horizon, signal_date) do update set label = excluded.label, value = excluded.value
    returning id into id2;
  select count(*) into n from public.signals where symbol = 'FPT';
  delete from public.signals where symbol = 'FPT';
  if n <> 1 or id1 <> id2 then raise exception 'CHECK FAILED: owner_can_read_write_signals'; end if;
end $$;

do $$ -- owner_can_read_write_prices_intraday
declare n int; p int;
begin
  insert into public.prices_intraday (symbol, ts, price, volume, source, fetched_at)
    values ('FPT', '2026-11-05T03:00:00Z', 102000, 10, 'x', now());
  insert into public.prices_intraday (symbol, ts, price, volume, source, fetched_at)
    values ('FPT', '2026-11-05T03:00:00Z', 102100, 20, 'x', now())
    on conflict (symbol, ts) do update set price = excluded.price, volume = excluded.volume, fetched_at = excluded.fetched_at;
  select count(*), max(price) into n, p from public.prices_intraday where symbol = 'FPT';
  delete from public.prices_intraday where symbol = 'FPT';
  if n <> 1 or p <> 102100 then raise exception 'CHECK FAILED: owner_can_read_write_prices_intraday'; end if;
end $$;

do $$ -- lottery_columns
begin
  perform pg_temp.assert_col('lottery_tickets', 'lines', 'jsonb', true);
  perform pg_temp.assert_col('lottery_draws', 'numbers', 'ARRAY', true);
  perform pg_temp.assert_col('lottery_draws', 'draw_no', 'integer', true);
  perform pg_temp.assert_col('lottery_tickets', 'draw_no', 'integer', true);
  perform pg_temp.assert_col('lottery_tickets', 'purchased_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('lottery_draws', 'draw_date', 'date', true);
end $$;

do $$ -- owner_can_read_write_lottery_draws
declare n int; j bigint;
begin
  insert into public.lottery_draws (game, draw_no, draw_date, numbers, jackpot_vnd, jackpot_winners, source, fetched_at)
    values ('mega645', 1, '2026-11-05', '{1,2,3,4,5,6}', 12000000000, 0, 'x', now());
  insert into public.lottery_draws (game, draw_no, draw_date, numbers, jackpot_vnd, jackpot_winners, source, fetched_at)
    values ('mega645', 1, '2026-11-05', '{1,2,3,4,5,6}', 13000000000, 0, 'x', now())
    on conflict (game, draw_no) do update set jackpot_vnd = excluded.jackpot_vnd;
  select count(*), max(jackpot_vnd) into n, j from public.lottery_draws where game = 'mega645';
  delete from public.lottery_draws where game = 'mega645';
  if n <> 1 or j <> 13000000000 then raise exception 'CHECK FAILED: owner_can_read_write_lottery_draws'; end if;
end $$;

do $$ -- owner_can_read_write_lottery_tickets
declare n int; st text; g bigint;
begin
  insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at)
    values ('mega645', 1, '[[1,2,3,4,5,6]]', 10000, 'sms', now());
  update public.lottery_tickets set status = 'won', prize_tier = 'third', gross_vnd = 30000, checked_at = now() where game = 'mega645';
  select count(*), max(status), max(gross_vnd) into n, st, g from public.lottery_tickets where game = 'mega645';
  delete from public.lottery_tickets where game = 'mega645';
  if n <> 1 or st <> 'won' or g <> 30000 then raise exception 'CHECK FAILED: owner_can_read_write_lottery_tickets'; end if;
end $$;

do $$ -- rejects_bad_rows
declare tx text := 'insert into public.transactions (trade_date, symbol, side, quantity, price, fee) values ';
        ca text := 'insert into public.corporate_actions (symbol, type, ex_date, amount_per_share, ratio_num, ratio_den) values ';
        pd text := 'insert into public.prices_daily (symbol, trade_date, open, high, low, close, volume, source, fetched_at) values ';
        pi text := 'insert into public.prices_intraday (symbol, ts, price, volume, source, fetched_at) values ';
        fi text := 'insert into public.financials (symbol, period, eps, bvps, revenue, net_income, source, fetched_at) values ';
        sg text := 'insert into public.signals (symbol, rule_id, horizon, signal_date, status, label, value, data_fresh, reason_codes, inputs_snapshot, rule_version, computed_at) values ';
        ld text := 'insert into public.lottery_draws (game, draw_no, draw_date, numbers, bonus, jackpot_vnd, jackpot_winners, jackpot2_vnd, jackpot2_winners, source, fetched_at) values ';
        lt text := 'insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at, status, prize_tier, gross_vnd, checked_at, raw_text) values ';
        st text := 'insert into public.settings (id, sell_tax_rate_ppm, dividend_withholding_rate_ppm, settlement_days, cash_dividend_treatment, cost_method) values ';
begin
  perform pg_temp.expect_fail('qty<=0', tx || '(''2026-01-05'',''VNM'',''buy'',0,100,null)', array['23514']);
  perform pg_temp.expect_fail('side hold', tx || '(''2026-01-05'',''VNM'',''hold'',100,100,null)', array['23514']);
  perform pg_temp.expect_fail('negative fee', tx || '(''2026-01-05'',''VNM'',''buy'',100,100,-1)', array['23514']);
  perform pg_temp.expect_fail('lowercase symbol', tx || '(''2026-01-05'',''vnm'',''buy'',100,100,null)', array['23514']);
  perform pg_temp.expect_fail('cash with ratio', ca || '(''VNM'',''cash_dividend'',''2026-01-05'',1000,1,10)', array['23514']);
  perform pg_temp.expect_fail('stock with amount', ca || '(''VNM'',''stock_dividend'',''2026-01-05'',1000,20,100)', array['23514']);
  perform pg_temp.expect_fail('stock zero ratio', ca || '(''VNM'',''stock_dividend'',''2026-01-05'',null,0,100)', array['23514']);
  perform pg_temp.expect_fail('prices low>high', pd || '(''VNM'',''2026-01-05'',100,100,101,100,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('intraday lowercase symbol', pi || '(''vnm'',now(),100,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('intraday price 0', pi || '(''VNM'',now(),0,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('intraday negative volume', pi || '(''VNM'',now(),100,-1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('intraday empty source', pi || '(''VNM'',now(),100,1,'''',now())', array['23514']);
  perform pg_temp.expect_fail('intraday null source', pi || '(''VNM'',now(),100,1,null,now())', array['23502']);
  perform pg_temp.expect_fail('intraday null fetched_at', pi || '(''VNM'',now(),100,1,''x'',null)', array['23502']);
  perform pg_temp.expect_fail('lottery game keno', ld || '(''keno'',1,''2026-11-05'',''{1,2,3,4,5,6}'',null,null,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery draw_no 0', ld || '(''mega645'',0,''2026-11-05'',''{1,2,3,4,5,6}'',null,null,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery 5 numbers', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5}'',null,null,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery number 56', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5,56}'',null,null,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery mega with bonus', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5,6}'',7,null,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery power without bonus', ld || '(''power655'',1,''2026-11-05'',''{1,2,3,4,5,6}'',null,null,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery jackpot without winners', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5,6}'',null,100,null,null,null,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery mega with jackpot2', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5,6}'',null,null,null,100,0,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('lottery empty source', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5,6}'',null,null,null,null,null,'''',now())', array['23514']);
  perform pg_temp.expect_fail('lottery null fetched_at', ld || '(''mega645'',1,''2026-11-05'',''{1,2,3,4,5,6}'',null,null,null,null,null,''x'',null)', array['23502']);
  perform pg_temp.expect_fail('lottery lines object', lt || '(''mega645'',1,''{}'',10000,''sms'',now(),''pending'',null,null,null,null)', array['23514']);
  perform pg_temp.expect_fail('lottery lines empty', lt || '(''mega645'',1,''[]'',10000,''sms'',now(),''pending'',null,null,null,null)', array['23514']);
  perform pg_temp.expect_fail('lottery negative cost', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',-1,''sms'',now(),''pending'',null,null,null,null)', array['23514']);
  perform pg_temp.expect_fail('lottery channel zalo', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',10000,''zalo'',now(),''pending'',null,null,null,null)', array['23514']);
  perform pg_temp.expect_fail('lottery won without gross', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',10000,''sms'',now(),''won'',''third'',null,now(),null)', array['23514']);
  perform pg_temp.expect_fail('lottery pending with checked_at', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',10000,''sms'',now(),''pending'',null,null,now(),null)', array['23514']);
  perform pg_temp.expect_fail('lottery lost with tier', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',10000,''sms'',now(),''lost'',''third'',0,now(),null)', array['23514']);
  perform pg_temp.expect_fail('lottery raw_text empty', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',10000,''sms'',now(),''pending'',null,null,null,'''')', array['23514']);
  perform pg_temp.expect_fail('lottery raw_text too long', lt || '(''mega645'',1,''[[1,2,3,4,5,6]]'',10000,''sms'',now(),''pending'',null,null,null,''' || repeat('a',2001) || ''')', array['23514']);
  perform pg_temp.expect_fail('settings id 2', st || '(2,1000,50000,2,''reduceCost'',''WAC'')', array['23514']);
  perform pg_temp.expect_fail('cost_method FIFO', st || '(1,1000,50000,2,''reduceCost'',''FIFO'')', array['23514']);
  perform pg_temp.expect_fail('gap to<from',
    'insert into public.data_gaps (data_type, from_ts, to_ts, source, fetched_at) values (''prices'', ''2026-01-02'', ''2026-01-01'', ''x'', now())',
    array['23514']);
  perform pg_temp.expect_fail('gap bad resolved_reason',
    'insert into public.data_gaps (data_type, from_ts, to_ts, source, fetched_at, resolved_at, resolved_reason) values (''prices'', ''2026-01-01'', ''2026-01-02'', ''x'', now(), now(), ''bogus'')',
    array['23514']);
  perform pg_temp.expect_fail('gap reason without resolved_at',
    'insert into public.data_gaps (data_type, from_ts, to_ts, source, fetched_at, resolved_reason) values (''prices'', ''2026-01-01'', ''2026-01-02'', ''x'', now(), ''non_trading_day'')',
    array['23514']);
  perform pg_temp.expect_fail('symbols lowercase symbol', 'insert into public.symbols (symbol) values (''vnm'')', array['23514']);
  perform pg_temp.expect_fail('symbols exchange HSX', 'insert into public.symbols (symbol, exchange) values (''VNM'', ''HSX'')', array['23514']);
  perform pg_temp.expect_fail('symbols exchange hose', 'insert into public.symbols (symbol, exchange) values (''VNM'', ''hose'')', array['23514']);
  perform pg_temp.expect_fail('fin period 2026Q5', fi || '(''VNM'',''2026Q5'',1,1,1,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fin period 2026-Q1', fi || '(''VNM'',''2026-Q1'',1,1,1,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fin period 26Q1', fi || '(''VNM'',''26Q1'',1,1,1,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fin lowercase symbol', fi || '(''vnm'',''2026Q1'',1,1,1,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fin negative revenue', fi || '(''VNM'',''2026Q1'',1,1,-1,1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fin null eps', fi || '(''VNM'',''2026Q1'',null,1,1,1,''x'',now())', array['23502']);
  perform pg_temp.expect_fail('fin null source', fi || '(''VNM'',''2026Q1'',1,1,1,1,null,now())', array['23502']);
  perform pg_temp.expect_fail('symbols sector empty',
    'insert into public.symbols (symbol, sector, sector_source, sector_fetched_at) values (''VNM'', '''', ''x'', now())', array['23514']);
  perform pg_temp.expect_fail('symbols sector untrimmed',
    'insert into public.symbols (symbol, sector, sector_source, sector_fetched_at) values (''VNM'', '' x'', ''x'', now())', array['23514']);
  perform pg_temp.expect_fail('symbols sector without provenance',
    'insert into public.symbols (symbol, sector) values (''VNM'', ''x'')', array['23514']);
  perform pg_temp.expect_fail('symbols provenance without sector',
    'insert into public.symbols (symbol, sector_source, sector_fetched_at) values (''VNM'', ''x'', now())', array['23514']);
  perform pg_temp.expect_fail('sig lowercase symbol', sg || '(''vnm'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,true,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig bad rule_id', sg || '(''VNM'',''PE'',''medium'',''2026-10-26'',''ok'',''neutral'',1,true,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig horizon long', sg || '(''VNM'',''pe_vs_sector'',''long'',''2026-10-26'',''ok'',''neutral'',1,true,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig label buy', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''buy'',1,true,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig ok null value', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',null,true,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig ok with reasons', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,true,''{price_stale}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig suppressed with value', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''suppressed'',null,1,false,''{price_stale}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig suppressed without reasons', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''suppressed'',null,null,false,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig ok but not fresh', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,false,''{}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig bad reason', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''suppressed'',null,null,false,''{"Bad Code"}'',''{}'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig snapshot array', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,true,''{}'',''[]'',1,now())', array['23514']);
  perform pg_temp.expect_fail('sig null snapshot', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,true,''{}'',null,1,now())', array['23502']);
  perform pg_temp.expect_fail('sig null data_fresh', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,null,''{}'',''{}'',1,now())', array['23502']);
  insert into public.signals (symbol, rule_id, horizon, signal_date, status, label, value, data_fresh, inputs_snapshot, rule_version, computed_at)
    values ('VNM', 'pe_vs_sector', 'medium', '2026-10-26', 'ok', 'neutral', 1, true, '{}', 1, now());
  perform pg_temp.expect_fail('sig duplicate key', sg || '(''VNM'',''pe_vs_sector'',''medium'',''2026-10-26'',''ok'',''neutral'',1,true,''{}'',''{}'',1,now())', array['23505']);
  insert into public.financials (symbol, period, eps, bvps, revenue, net_income, source, fetched_at)
    values ('VNM', '2026Q1', -5, -7, 0, -9, 'x', now());
  perform pg_temp.expect_fail('fin duplicate period', fi || '(''VNM'',''2026Q1'',1,1,1,1,''x'',now())', array['23505']);
  insert into public.symbols (symbol, exchange) values ('VNM', null);
  insert into public.corporate_actions (symbol, type, ex_date, amount_per_share) values ('VNM', 'cash_dividend', '2026-01-05', 1000);
  perform pg_temp.expect_fail('duplicate corporate action', ca || '(''VNM'',''cash_dividend'',''2026-01-05'',2000,null,null)', array['23505']);
end $$;

do $$ -- financial_lines_negatives
declare fl text := 'insert into public.financial_lines (symbol, period_kind, period, statement, line, value, source, fetched_at) values ';
begin
  perform pg_temp.expect_fail('fl bad symbol', fl || '(''vnm'',''quarter'',''2026Q1'',''income'',''revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl bad kind', fl || '(''VNM'',''month'',''2026Q1'',''income'',''revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl quarter label for year', fl || '(''VNM'',''year'',''2026Q1'',''income'',''revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl year label for quarter', fl || '(''VNM'',''quarter'',''2026'',''income'',''revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl bad quarter number', fl || '(''VNM'',''quarter'',''2026Q5'',''income'',''revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl bad statement', fl || '(''VNM'',''quarter'',''2026Q1'',''equity'',''revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl bad line', fl || '(''VNM'',''quarter'',''2026Q1'',''income'',''Revenue'',1,''x'',now())', array['23514']);
  perform pg_temp.expect_fail('fl empty source', fl || '(''VNM'',''quarter'',''2026Q1'',''income'',''revenue'',1,'''',now())', array['23514']);
  perform pg_temp.expect_fail('fl null value', fl || '(''VNM'',''quarter'',''2026Q1'',''income'',''revenue'',null,''x'',now())', array['23502']);
  insert into public.financial_lines (symbol, period_kind, period, statement, line, value, source, fetched_at)
    values ('VNM', 'year', '2025', 'income', 'revenue', 1, 'x', now());
  perform pg_temp.expect_fail('fl duplicate key', fl || '(''VNM'',''year'',''2025'',''income'',''revenue'',2,''x'',now())', array['23505']);
end $$;

do $$ -- news_negatives
declare nw text := 'insert into public.news (url, title, source, credibility, published_at, fetched_at, symbols) values ';
begin
  perform pg_temp.expect_fail('news bad scheme', nw || '(''javascript:x'',''t'',''s'',''established_outlet'',now(),now(),''{}'')', array['23514']);
  perform pg_temp.expect_fail('news empty title', nw || '(''https://a.vn/1'','''',''s'',''established_outlet'',now(),now(),''{}'')', array['23514']);
  perform pg_temp.expect_fail('news long title', nw || '(''https://a.vn/1'',repeat(''x'',501),''s'',''established_outlet'',now(),now(),''{}'')', array['23514']);
  perform pg_temp.expect_fail('news empty source', nw || '(''https://a.vn/1'',''t'','''',''established_outlet'',now(),now(),''{}'')', array['23514']);
  perform pg_temp.expect_fail('news bad credibility', nw || '(''https://a.vn/1'',''t'',''s'',''social'',now(),now(),''{}'')', array['23514']);
  perform pg_temp.expect_fail('news published too far after fetched', nw || '(''https://a.vn/1'',''t'',''s'',''established_outlet'',now() + interval ''2 days'',now(),''{}'')', array['23514']);
  perform pg_temp.expect_fail('news lowercase symbol', nw || '(''https://a.vn/1'',''t'',''s'',''established_outlet'',now(),now(),''{hpg}'')', array['23514']);
  perform pg_temp.expect_fail('news 51 symbols', nw || '(''https://a.vn/1'',''t'',''s'',''established_outlet'',now(),now(),(select array_agg(''A'' || g) from generate_series(1, 51) g))', array['23514']);
  perform pg_temp.expect_fail('news null title', nw || '(''https://a.vn/1'',null,''s'',''established_outlet'',now(),now(),''{}'')', array['23502']);
  insert into public.news (url, title, source, credibility, published_at, fetched_at)
    values ('https://a.vn/1', 't', 's', 'established_outlet', now(), now());
  perform pg_temp.expect_fail('news duplicate url', nw || '(''https://a.vn/1'',''t2'',''s'',''established_outlet'',now(),now(),''{}'')', array['23505']);
end $$;

do $$ -- ai_usage_columns
begin
  perform pg_temp.assert_col('ai_usage', 'id', 'bigint', true);
  perform pg_temp.assert_col('ai_usage', 'created_at', 'timestamp with time zone', true);
  perform pg_temp.assert_col('ai_usage', 'settled_at', 'timestamp with time zone', false);
  perform pg_temp.assert_col('ai_usage', 'provider', 'text', true);
  perform pg_temp.assert_col('ai_usage', 'model', 'text', true);
  perform pg_temp.assert_col('ai_usage', 'task', 'text', true);
  perform pg_temp.assert_col('ai_usage', 'status', 'text', true);
  perform pg_temp.assert_col('ai_usage', 'input_tokens', 'integer', true);
  perform pg_temp.assert_col('ai_usage', 'output_tokens', 'integer', true);
  perform pg_temp.assert_col('ai_usage', 'reserved_micro_usd', 'bigint', true);
  perform pg_temp.assert_col('ai_usage', 'cost_micro_usd', 'bigint', false);
  perform pg_temp.assert_col('ai_usage', 'error_code', 'text', false);
end $$;

do $$ -- owner_can_read_write_ai_usage
declare n int;
begin
  insert into public.ai_usage (provider, model, task, status, reserved_micro_usd)
    values ('google', 'gemini-2.5-flash', 'summary', 'reserved', 100);
  select count(*) into n from public.ai_usage where task = 'summary';
  delete from public.ai_usage where task = 'summary';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write_ai_usage'; end if;
end $$;

do $$ -- ai_usage_negatives
declare au text := 'insert into public.ai_usage (provider, model, task, status, input_tokens, output_tokens, reserved_micro_usd, cost_micro_usd, settled_at) values ';
begin
  perform pg_temp.expect_fail('ai bad provider', au || '(''openai'',''m'',''chat'',''reserved'',0,0,1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai empty model', au || '(''google'','''',''chat'',''reserved'',0,0,1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai bad task', au || '(''google'',''m'',''Chat!'',''reserved'',0,0,1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai bad status', au || '(''google'',''m'',''chat'',''done'',0,0,1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai negative input tokens', au || '(''google'',''m'',''chat'',''reserved'',-1,0,1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai negative output tokens', au || '(''google'',''m'',''chat'',''reserved'',0,-1,1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai negative reserve', au || '(''google'',''m'',''chat'',''reserved'',0,0,-1,null,null)', array['23514']);
  perform pg_temp.expect_fail('ai negative cost', au || '(''google'',''m'',''chat'',''ok'',0,0,1,-1,now())', array['23514']);
  perform pg_temp.expect_fail('ai ok with null cost', au || '(''google'',''m'',''chat'',''ok'',0,0,1,null,now())', array['23514']);
  perform pg_temp.expect_fail('ai reserved with cost', au || '(''google'',''m'',''chat'',''reserved'',0,0,1,5,null)', array['23514']);
  perform pg_temp.expect_fail('ai refused with cost > 0', au || '(''google'',''m'',''chat'',''refused'',0,0,1,5,now())', array['23514']);
  perform pg_temp.expect_fail('ai provider_error without settled_at', au || '(''google'',''m'',''chat'',''provider_error'',0,0,1,null,null)', array['23514']);
end $$;

do $$ -- ai_summaries_columns
begin
  perform pg_temp.assert_col('ai_summaries', 'id', 'bigint', true);
  perform pg_temp.assert_col('ai_summaries', 'scope', 'text', true);
  perform pg_temp.assert_col('ai_summaries', 'symbol', 'text', true);
  perform pg_temp.assert_col('ai_summaries', 'summary_date', 'date', true);
  perform pg_temp.assert_col('ai_summaries', 'generator', 'text', true);
  perform pg_temp.assert_col('ai_summaries', 'provider', 'text', false);
  perform pg_temp.assert_col('ai_summaries', 'model', 'text', false);
  perform pg_temp.assert_col('ai_summaries', 'usage_id', 'bigint', false);
  perform pg_temp.assert_col('ai_summaries', 'body_version', 'smallint', true);
  perform pg_temp.assert_col('ai_summaries', 'body', 'jsonb', true);
  perform pg_temp.assert_col('ai_summaries', 'input_ids', 'ARRAY', true);
  perform pg_temp.assert_col('ai_summaries', 'created_at', 'timestamp with time zone', true);
end $$;

do $$ -- owner_can_read_write_ai_summaries
declare n int;
begin
  insert into public.ai_summaries (scope, symbol, summary_date, generator, body)
    values ('symbol', 'VNM', '2026-11-10', 'template', '{"sections":[]}');
  update public.ai_summaries set input_ids = '{px:VNM:2026-11-10}' where symbol = 'VNM';
  select count(*) into n from public.ai_summaries where symbol = 'VNM' and input_ids = '{px:VNM:2026-11-10}';
  delete from public.ai_summaries where symbol = 'VNM';
  if n <> 1 then raise exception 'CHECK FAILED: owner_can_read_write_ai_summaries'; end if;
end $$;

do $$ -- ai_summaries_negatives
declare
  s text := 'insert into public.ai_summaries (scope, symbol, summary_date, generator, provider, model, usage_id, body, input_ids) values ';
  b text := '''{"sections":[]}''';
begin
  perform pg_temp.expect_fail('sum bad scope', s || '(''stock'',''VNM'',''2026-11-10'',''template'',null,null,null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum symbol scope with empty symbol', s || '(''symbol'','''',''2026-11-10'',''template'',null,null,null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum portfolio with symbol', s || '(''portfolio'',''VNM'',''2026-11-10'',''template'',null,null,null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum lowercase symbol', s || '(''symbol'',''vnm'',''2026-11-10'',''template'',null,null,null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum bad provider', s || '(''symbol'',''VNM'',''2026-11-10'',''model'',''openai'',''m'',null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum model without provider/model', s || '(''symbol'',''VNM'',''2026-11-10'',''model'',null,null,null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum template with provider', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',''google'',''m'',null,' || b || ',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum body is array', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,''[]'',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum body is string', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,''"x"'',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum body without sections', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,''{}'',''{}'')', array['23514']);
  perform pg_temp.expect_fail('sum oversize body',
    'insert into public.ai_summaries (scope, symbol, summary_date, generator, body) values (''symbol'',''VNM'',''2026-11-10'',''template'',jsonb_build_object(''sections'', jsonb_build_array(repeat(md5(random()::text), 2000))))',
    array['23514']);
  perform pg_temp.expect_fail('sum bad input id', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,' || b || ',''{"bad id"}'')', array['23514']);
  perform pg_temp.expect_fail('sum null input id', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,' || b || ',''{NULL}'')', array['23514']);
  perform pg_temp.expect_fail('sum too many input ids',
    'insert into public.ai_summaries (scope, symbol, summary_date, generator, body, input_ids) values (''symbol'',''VNM'',''2026-11-10'',''template'',''{"sections":[]}'',(select array_agg(''news:'' || g) from generate_series(1, 201) g))',
    array['23514']);
  perform pg_temp.expect_fail('sum null body', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,null,''{}'')', array['23502']);
  perform pg_temp.expect_fail('sum nonexistent usage_id', s || '(''symbol'',''VNM'',''2026-11-10'',''model'',''google'',''m'',999999,' || b || ',''{}'')', array['23503']);
  insert into public.ai_summaries (scope, symbol, summary_date, generator, body) values ('symbol', 'VNM', '2026-11-10', 'template', '{"sections":[]}');
  perform pg_temp.expect_fail('sum duplicate symbol/date', s || '(''symbol'',''VNM'',''2026-11-10'',''template'',null,null,null,' || b || ',''{}'')', array['23505']);
  insert into public.ai_summaries (scope, symbol, summary_date, generator, body) values ('portfolio', '', '2026-11-10', 'template', '{"sections":[]}');
  perform pg_temp.expect_fail('sum duplicate portfolio/date', s || '(''portfolio'','''',''2026-11-10'',''template'',null,null,null,' || b || ',''{}'')', array['23505']);
  delete from public.ai_summaries;
end $$;

do $$ -- ai_summaries_usage_fk
declare uid bigint;
begin
  insert into public.ai_usage (provider, model, task, status, reserved_micro_usd) values ('google', 'm', 'summary', 'reserved', 1) returning id into uid;
  insert into public.ai_summaries (scope, symbol, summary_date, generator, provider, model, usage_id, body)
    values ('symbol', 'VNM', '2026-11-10', 'model', 'google', 'm', uid, '{"sections":[]}');
  delete from public.ai_usage where id = uid;
  if not exists (select 1 from public.ai_summaries where symbol = 'VNM' and usage_id is null) then
    raise exception 'CHECK FAILED: ai_summaries_usage_fk';
  end if;
  delete from public.ai_summaries;
end $$;

do $$ -- ai_summaries_upsert_replaces
declare n int;
begin
  insert into public.ai_summaries (scope, symbol, summary_date, generator, body) values ('symbol', 'VNM', '2026-11-10', 'template', '{"sections":[],"v":1}');
  insert into public.ai_summaries (scope, symbol, summary_date, generator, provider, model, body)
    values ('symbol', 'VNM', '2026-11-10', 'model', 'google', 'm', '{"sections":[],"v":2}')
    on conflict (scope, symbol, summary_date) do update
      set generator = excluded.generator, provider = excluded.provider, model = excluded.model, body = excluded.body;
  select count(*) into n from public.ai_summaries where symbol = 'VNM' and body ->> 'v' = '2' and provider = 'google';
  if n <> 1 or (select count(*) from public.ai_summaries) <> 1 then raise exception 'CHECK FAILED: ai_summaries_upsert_replaces'; end if;
  delete from public.ai_summaries;
end $$;

do $$ -- ai_reserve_gate
declare
  r record;
  n int;
  first_id bigint;
  w_from timestamptz := now() - interval '1 day';
  w_to timestamptz := now() + interval '1 day';
begin
  select * into r from public.ai_reserve('google', 'gemini-2.5-flash', 'summary', 600, 1000, w_from, w_to);
  if not r.granted or r.spent_micro_usd <> 0 then raise exception 'CHECK FAILED: ai_reserve_gate (under cap: %)', r; end if;
  first_id := r.usage_id;
  select * into r from public.ai_reserve('google', 'gemini-2.5-flash', 'summary', 500, 1000, w_from, w_to);
  if r.granted or r.spent_micro_usd <> 600 then raise exception 'CHECK FAILED: ai_reserve_gate (second over cap: %)', r; end if;
  select count(*) into n from public.ai_usage where id = r.usage_id and status = 'refused' and cost_micro_usd = 0;
  if n <> 1 then raise exception 'CHECK FAILED: ai_reserve_gate (no refused row)'; end if;
  update public.ai_usage set status = 'ok', cost_micro_usd = 400, settled_at = now() where id = first_id;
  select * into r from public.ai_reserve('anthropic', 'claude-haiku-4-5', 'chat', 600, 1000, w_from, w_to);
  if not r.granted or r.spent_micro_usd <> 400 then raise exception 'CHECK FAILED: ai_reserve_gate (400 + 600: %)', r; end if;
  select * into r from public.ai_reserve('anthropic', 'claude-haiku-4-5', 'chat', 1, 1000, w_from, w_to);
  if r.granted or r.spent_micro_usd <> 1000 then raise exception 'CHECK FAILED: ai_reserve_gate (reserve 1 at cap: %)', r; end if;
  insert into public.ai_usage (created_at, provider, model, task, status, reserved_micro_usd, cost_micro_usd, settled_at)
    values (now() - interval '40 days', 'google', 'gemini-2.5-flash', 'summary', 'ok', 999, 999, now() - interval '40 days');
  if public.ai_month_spend(w_from, w_to) <> 1000 then raise exception 'CHECK FAILED: ai_reserve_gate (month spend / previous month counted)'; end if;
  select count(*) into n from public.ai_usage;
  perform pg_temp.expect_fail('ai_reserve null from', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, 1000, null, now() + interval ''1 day'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve null to', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, 1000, now() - interval ''1 day'', null)', array['22023']);
  perform pg_temp.expect_fail('ai_reserve null cap', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, null, now() - interval ''1 day'', now() + interval ''1 day'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve null reserve', 'select public.ai_reserve(''google'', ''m'', ''summary'', null, 1000, now() - interval ''1 day'', now() + interval ''1 day'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve from >= to', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, 1000, now() + interval ''1 day'', now() - interval ''1 day'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve negative reserve', 'select public.ai_reserve(''google'', ''m'', ''summary'', -1, 1000, now() - interval ''1 day'', now() + interval ''1 day'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve zero reserve under cap', 'select public.ai_reserve(''google'', ''m'', ''summary'', 0, 1000000, now() - interval ''1 day'', now() + interval ''1 day'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve past window', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, 1000000, now() - interval ''40 days'', now() - interval ''10 days'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve future window', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, 1000000, now() + interval ''1 day'', now() + interval ''30 days'')', array['22023']);
  perform pg_temp.expect_fail('ai_reserve window ends at now', 'select public.ai_reserve(''google'', ''m'', ''summary'', 1, 1000000, now() - interval ''1 day'', now())', array['22023']);
  if (select count(*) from public.ai_usage) <> n then raise exception 'CHECK FAILED: ai_reserve_gate (rejected calls inserted rows)'; end if;
  select * into r from public.ai_reserve('google', 'gemini-2.5-flash', 'summary', 1, 1000000, now(), now() + interval '1 day');
  if not r.granted then raise exception 'CHECK FAILED: ai_reserve_gate (window starting at now: %)', r; end if;
  delete from public.ai_usage;
end $$;

do $$ -- ai_functions_locked
declare f text;
begin
  foreach f in array array['public.ai_reserve(text,text,text,bigint,bigint,timestamptz,timestamptz)', 'public.ai_month_spend(timestamptz,timestamptz)'] loop
    if not has_function_privilege(current_user, f, 'execute') then
      raise exception 'CHECK FAILED: ai_functions_locked (owner cannot execute %)', f;
    end if;
  end loop;
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_reserve', 'ai_month_spend')
      and (p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))
  ) then
    raise exception 'CHECK FAILED: ai_functions_locked (security definer or search_path not empty)';
  end if;
end $$;

do $$ -- ai_keys_columns
begin
  perform pg_temp.assert_col('ai_keys', 'provider', 'text', true);
  perform pg_temp.assert_col('ai_keys', 'ciphertext', 'bytea', true);
  perform pg_temp.assert_col('ai_keys', 'iv', 'bytea', true);
  perform pg_temp.assert_col('ai_keys', 'auth_tag', 'bytea', true);
  perform pg_temp.assert_col('ai_keys', 'key_version', 'smallint', true);
  perform pg_temp.assert_col('ai_keys', 'last4', 'text', true);
  perform pg_temp.assert_col('ai_keys', 'updated_at', 'timestamp with time zone', true);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_keys' and column_name = 'secret_id') then
    raise exception 'CHECK FAILED: ai_keys_columns (secret_id still present)';
  end if;
end $$;

do $$ -- ai_keys_constraints
declare
  ct20 text := 'decode(repeat(''00'', 20), ''hex'')';
  iv12 text := 'decode(repeat(''00'', 12), ''hex'')';
  tag16 text := 'decode(repeat(''00'', 16), ''hex'')';
  n int;
begin
  -- valid rows at the ciphertext length bounds
  insert into public.ai_keys (provider, ciphertext, iv, auth_tag, key_version, last4) values ('anthropic', decode(repeat('00', 20), 'hex'), decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 1, 'abcd');
  insert into public.ai_keys (provider, ciphertext, iv, auth_tag, key_version, last4) values ('google', decode(repeat('00', 256), 'hex'), decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 1, 'abcd');
  delete from public.ai_keys;

  perform pg_temp.expect_fail('provider openai', format('insert into public.ai_keys values (''openai'', %s, %s, %s, 1, ''abcd'')', ct20, iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('ciphertext 19', format('insert into public.ai_keys values (''google'', decode(repeat(''00'', 19), ''hex''), %s, %s, 1, ''abcd'')', iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('ciphertext 257', format('insert into public.ai_keys values (''google'', decode(repeat(''00'', 257), ''hex''), %s, %s, 1, ''abcd'')', iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('iv 11', format('insert into public.ai_keys values (''google'', %s, decode(repeat(''00'', 11), ''hex''), %s, 1, ''abcd'')', ct20, tag16), array['23514']);
  perform pg_temp.expect_fail('iv 13', format('insert into public.ai_keys values (''google'', %s, decode(repeat(''00'', 13), ''hex''), %s, 1, ''abcd'')', ct20, tag16), array['23514']);
  perform pg_temp.expect_fail('tag 15', format('insert into public.ai_keys values (''google'', %s, %s, decode(repeat(''00'', 15), ''hex''), 1, ''abcd'')', ct20, iv12), array['23514']);
  perform pg_temp.expect_fail('tag 17', format('insert into public.ai_keys values (''google'', %s, %s, decode(repeat(''00'', 17), ''hex''), 1, ''abcd'')', ct20, iv12), array['23514']);
  perform pg_temp.expect_fail('key_version 0', format('insert into public.ai_keys values (''google'', %s, %s, %s, 0, ''abcd'')', ct20, iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('last4 3 chars', format('insert into public.ai_keys values (''google'', %s, %s, %s, 1, ''abc'')', ct20, iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('last4 5 chars', format('insert into public.ai_keys values (''google'', %s, %s, %s, 1, ''abcde'')', ct20, iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('last4 space', format('insert into public.ai_keys values (''google'', %s, %s, %s, 1, ''ab d'')', ct20, iv12, tag16), array['23514']);
  perform pg_temp.expect_fail('last4 non-ascii', format('insert into public.ai_keys values (''google'', %s, %s, %s, 1, %L)', ct20, iv12, tag16, 'ab' || chr(233) || chr(227)), array['23514']);

  perform pg_temp.expect_fail('null provider', format('insert into public.ai_keys values (null, %s, %s, %s, 1, ''abcd'')', ct20, iv12, tag16), array['23502']);
  perform pg_temp.expect_fail('null ciphertext', format('insert into public.ai_keys values (''google'', null, %s, %s, 1, ''abcd'')', iv12, tag16), array['23502']);
  perform pg_temp.expect_fail('null iv', format('insert into public.ai_keys values (''google'', %s, null, %s, 1, ''abcd'')', ct20, tag16), array['23502']);
  perform pg_temp.expect_fail('null auth_tag', format('insert into public.ai_keys values (''google'', %s, %s, null, 1, ''abcd'')', ct20, iv12), array['23502']);
  perform pg_temp.expect_fail('null key_version', format('insert into public.ai_keys values (''google'', %s, %s, %s, null, ''abcd'')', ct20, iv12, tag16), array['23502']);
  perform pg_temp.expect_fail('null last4', format('insert into public.ai_keys values (''google'', %s, %s, %s, 1, null)', ct20, iv12, tag16), array['23502']);

  insert into public.ai_keys (provider, ciphertext, iv, auth_tag, key_version, last4) values ('google', decode(repeat('00', 20), 'hex'), decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 1, 'abcd');
  perform pg_temp.expect_fail('duplicate provider', format('insert into public.ai_keys values (''google'', %s, %s, %s, 1, ''abcd'')', ct20, iv12, tag16), array['23505']);
  insert into public.ai_keys (provider, ciphertext, iv, auth_tag, key_version, last4) values ('google', decode(repeat('01', 20), 'hex'), decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 1, 'wxyz')
    on conflict (provider) do update set ciphertext = excluded.ciphertext, last4 = excluded.last4, updated_at = now();
  select count(*) into n from public.ai_keys;
  if n <> 1 or not exists (select 1 from public.ai_keys where provider = 'google' and last4 = 'wxyz') then
    raise exception 'CHECK FAILED: ai_keys_constraints (upsert left % rows)', n;
  end if;
  delete from public.ai_keys;
end $$;

do $$ -- ai_key_functions_gone
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('ai_key_set', 'ai_key_delete', 'ai_key_secrets')) then
    raise exception 'CHECK FAILED: ai_key_functions_gone (a key wrapper function still exists)';
  end if;
end $$;

do $$ -- security_definer_allowlist (empty: no definer function exists)
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef) then
    raise exception 'CHECK FAILED: security_definer_allowlist (a security definer function exists in public)';
  end if;
end $$;

do $$ -- manual_rows_nulls_dont_collide
begin
  insert into public.transactions (trade_date, symbol, side, quantity, price) values ('2026-01-05', 'VNM', 'buy', 100, 100);
  insert into public.transactions (trade_date, symbol, side, quantity, price) values ('2026-01-05', 'VNM', 'buy', 100, 100);
  insert into public.transactions (trade_date, symbol, side, quantity, price, source, import_batch_id, external_ref)
    values ('2026-01-05', 'VNM', 'buy', 100, 100, 'import', 'b1', 'r1');
  perform pg_temp.expect_fail('duplicate import',
    'insert into public.transactions (trade_date, symbol, side, quantity, price, source, import_batch_id, external_ref) values (''2026-01-05'',''VNM'',''buy'',100,100,''import'',''b1'',''r1'')',
    array['23505']);
end $$;

do $$ -- lottery_duplicates
declare ts timestamptz := '2026-11-05T01:00:00Z';
begin
  insert into public.lottery_draws (game, draw_no, draw_date, numbers, source, fetched_at)
    values ('mega645', 7, '2026-11-05', '{1,2,3,4,5,6}', 'x', now());
  perform pg_temp.expect_fail('lottery duplicate draw',
    'insert into public.lottery_draws (game, draw_no, draw_date, numbers, source, fetched_at) values (''mega645'',7,''2026-11-05'',''{1,2,3,4,5,6}'',''x'',now())',
    array['23505']);
  insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at, raw_text)
    values ('mega645', 7, '[[1,2,3,4,5,6]]', 10000, 'sms', ts, 'Ve so  123 ' || chr(10) || 'ky 7');
  perform pg_temp.expect_fail('lottery duplicate raw_text',
    'insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at, raw_text) values (''mega645'',8,''[[7,8,9,10,11,12]]'',10000,''momo'',now(),'' Ve so 123   ky 7'')',
    array['23505']);
  perform pg_temp.expect_fail('lottery duplicate sms identity',
    'insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at, raw_text) values (''mega645'',7,''[[1,2,3,4,5,6]]'',10000,''sms'',''2026-11-05T01:00:00Z'',''other text'')',
    array['23505']);
  insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at)
    values ('mega645', 7, '[[1,2,3,4,5,6]]', 10000, 'manual', ts);
  insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at)
    values ('mega645', 7, '[[1,2,3,4,5,6]]', 10000, 'manual', ts);
end $$;

do $$ -- settings_fee_unset_allowed
begin
  insert into public.settings (sell_tax_rate_ppm, dividend_withholding_rate_ppm, settlement_days, cash_dividend_treatment, cost_method)
    values (1000, 50000, 2, 'reduceCost', 'WAC');
  if (select fee_rate_ppm from public.settings) is not null then
    raise exception 'CHECK FAILED: settings_fee_unset_allowed';
  end if;
end $$;

rollback;

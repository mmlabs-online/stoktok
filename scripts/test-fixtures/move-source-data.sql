-- STK-091: seed rows for scripts/test-db-migrate-from-supabase.sh (applied to the throwaway source database only).
-- Synthetic data. Covers diacritics, NULLs, UTC+7 midnight timestamps, jsonb and array columns, an FK (ai_summaries -> ai_usage),
-- one ai_keys row (never moved), a sequence ahead of max (data_gaps), a sequence behind max (news) and an empty identity table (signals).

insert into public.transactions (trade_date, symbol, side, quantity, price, fee, tax, source, import_batch_id, external_ref, created_at) values
  ('2026-11-10', 'VNM', 'buy', 100, 65400, 98100, null, 'manual', null, null, '2026-11-10 00:00:00+07'),
  ('2026-11-11', 'VNM', 'sell', 100, 66000, null, 66000, 'import', 'batch-1', 'ref-1', '2026-11-11 23:59:59+07');

insert into public.corporate_actions (symbol, type, ex_date, record_date, pay_date, listing_date, amount_per_share, ratio_num, ratio_den) values
  ('VNM', 'cash_dividend', '2026-06-01', '2026-06-02', '2026-06-20', null, 2000, null, null),
  ('FPT', 'stock_dividend', '2026-07-01', null, null, '2026-07-15', null, 20, 100);

insert into public.assets (type, name, value, as_of) values
  ('cash', 'Tiền mặt TCBS', 150000000, '2026-11-10'),
  ('other', 'Quỹ dự phòng', 0, '2026-11-10');

insert into public.watchlist (symbol, group_name, added_at) values
  ('VNM', 'holding', '2026-10-24 00:00:00+07'),
  ('HPG', 'watching', '2026-10-25 00:00:00+07');

insert into public.settings (id, fee_rate_ppm, sell_tax_rate_ppm, dividend_withholding_rate_ppm, settlement_days, holidays, cash_dividend_treatment, cost_method, concentration_threshold_ppm, rule_configs, updated_at) values
  (1, null, 1000, 50000, 2, '{2026-09-02,2026-09-03}', 'reduceCost', 'WAC', 250000, '{"lotSize": 100, "limits": {"HOSE": 70000}}', '2026-11-10 00:00:00+07');

insert into public.prices_daily (symbol, trade_date, open, high, low, close, volume, foreign_net, source, fetched_at) values
  ('VNM', '2026-11-10', 65000, 66000, 64800, 65400, 1200000, -350000000, 'vci', '2026-11-10 16:00:00+07'),
  ('VNM', '2026-11-11', 65400, 66200, 65000, 66000, 900000, null, 'vci', '2026-11-11 16:00:00+07');

insert into public.data_gaps (symbol, data_type, from_ts, to_ts, source, fetched_at, resolved_at, resolved_reason) values
  ('VNM', 'prices_daily', '2026-11-03 00:00:00+07', '2026-11-04 00:00:00+07', 'vci', '2026-11-05 08:00:00+07', '2026-11-06 00:00:00+07', 'data_stored'),
  (null, 'prices_intraday', '2026-11-05 09:00:00+07', '2026-11-05 11:30:00+07', 'vci', '2026-11-05 12:00:00+07', null, null),
  ('HPG', 'financials', '2026-10-01 00:00:00+07', '2026-10-02 00:00:00+07', 'vci', '2026-11-05 12:00:00+07', null, null);
-- The highest id is deleted: the sequence last_value stays above max(id) and must not be lowered.
delete from public.data_gaps where id = (select max(id) from public.data_gaps);

insert into public.symbols (symbol, exchange, sector, sector_source, sector_fetched_at) values
  ('VNM', 'HOSE', 'Thực phẩm và đồ uống', 'vci', '2026-11-01 00:00:00+07'),
  ('HPG', null, null, null, null);

insert into public.financials (symbol, period, eps, bvps, revenue, net_income, source, fetched_at) values
  ('VNM', '2026Q2', 1200, 15000, 15000000000000, 2400000000000, 'vci', '2026-08-01 00:00:00+07'),
  ('VNM', '2026Q3', 1300, 15500, 16000000000000, -100000000, 'vci', '2026-11-01 00:00:00+07');

-- signals: left empty on purpose (uncalled identity sequence).

insert into public.prices_intraday (symbol, ts, price, volume, source, fetched_at) values
  ('VNM', '2026-11-11 09:15:00+07', 65500, 10000, 'vci', '2026-11-11 09:16:00+07'),
  ('VNM', '2026-11-11 09:16:00+07', 65600, 25000, 'vci', '2026-11-11 09:17:00+07');

insert into public.lottery_draws (game, draw_no, draw_date, numbers, bonus, jackpot_vnd, jackpot_winners, jackpot2_vnd, jackpot2_winners, source, fetched_at) values
  ('mega645', 1400, '2026-11-09', '{1,7,19,23,38,45}', null, 30000000000, 0, null, null, 'vietlott', '2026-11-09 19:00:00+07'),
  ('power655', 1200, '2026-11-10', '{3,9,14,27,41,55}', 12, 60000000000, 1, 3000000000, 0, 'vietlott', '2026-11-10 19:00:00+07');

insert into public.lottery_tickets (game, draw_no, lines, cost_vnd, channel, purchased_at, status, prize_tier, gross_vnd, checked_at, raw_text) values
  ('mega645', 1400, '[[1,7,19,23,38,45]]', 10000, 'sms', '2026-11-09 10:00:00+07', 'pending', null, null, null, 'Vé Mega 6/45 kỳ #1400: 01 07 19 23 38 45'),
  ('power655', 1200, '[[3,9,14,27,41,55],[1,2,3,4,5,6]]', 20000, 'manual', '2026-11-10 00:00:00+07', 'lost', null, 0, '2026-11-11 00:00:00+07', null);

insert into public.financial_lines (symbol, period_kind, period, statement, line, value, source, fetched_at) values
  ('VNM', 'quarter', '2026Q3', 'income', 'revenue', 16000000000000, 'vci', '2026-11-01 00:00:00+07'),
  ('VNM', 'year', '2025', 'balance', 'total_assets', 40000000000000, 'vci', '2026-03-01 00:00:00+07');

insert into public.news (url, title, source, credibility, published_at, fetched_at, symbols, excerpt) values
  ('https://example.com/a', 'Công ty Cổ phần Sữa Việt Nam công bố lợi nhuận', 'CafeF', 'established_outlet', '2026-11-10 00:00:00+07', '2026-11-10 08:00:00+07', '{VNM}', 'Tóm tắt: "quý 3" tăng trưởng'),
  ('https://example.com/b', 'Tin không liên kết mã', 'HOSE', 'official_disclosure', '2026-11-11 00:00:00+07', '2026-11-11 08:00:00+07', '{}', '');
-- An id above the sequence: the sequence ends up behind max(id) and the script must bump it.
insert into public.news (id, url, title, source, credibility, published_at, fetched_at) overriding system value values
  (100, 'https://example.com/c', 'Bản tin id 100', 'CafeF', 'established_outlet', '2026-11-11 12:00:00+07', '2026-11-11 12:05:00+07');

insert into public.ai_usage (provider, model, task, status, input_tokens, output_tokens, reserved_micro_usd, cost_micro_usd, settled_at, created_at) values
  ('anthropic', 'claude-test', 'summary', 'ok', 1000, 200, 5000, 3200, '2026-11-10 08:00:01+07', '2026-11-10 08:00:00+07'),
  ('google', 'gemini-test', 'summary', 'refused', 0, 0, 5000, 0, '2026-11-11 08:00:00+07', '2026-11-11 08:00:00+07');

insert into public.ai_summaries (scope, symbol, summary_date, generator, provider, model, usage_id, body, input_ids) values
  ('symbol', 'VNM', '2026-11-10', 'model', 'anthropic', 'claude-test', (select min(id) from public.ai_usage), '{"sections": [{"title": "Tổng quan", "text": "Giá đóng cửa 65.400"}]}', '{price:VNM:2026-11-10}'),
  ('portfolio', '', '2026-11-10', 'template', null, null, null, '{"sections": []}', '{}');

insert into public.ai_keys (provider, ciphertext, iv, auth_tag, key_version, last4) values
  ('anthropic', decode(repeat('ab', 24), 'hex'), decode(repeat('cd', 12), 'hex'), decode(repeat('ef', 16), 'hex'), 1, 'wxyz');

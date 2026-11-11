/**
 * Mirrors supabase/migrations; update in the same PR as any migration (until STK-083 makes db/migrations the source).
 * Type conventions: bigint -> string on read (R2: core's toSafeInt checks the range), date -> 'YYYY-MM-DD',
 * timestamptz -> ISO string, jsonb is written through jsonb() from ./upsert.
 */
import type { ColumnType, Generated } from 'kysely';

type Int8 = ColumnType<string, number | string, number | string>;
type Int8Gen = ColumnType<string, number | string | undefined, number | string>;
type TsDef = ColumnType<string, string | undefined, string>;
type Json = ColumnType<unknown, string, string>;
type JsonDef = ColumnType<unknown, string | undefined, string>;
type Def<T> = ColumnType<T, T | undefined, T>;

export interface TransactionsTable {
  id: Def<string>;
  seq: Generated<string>;
  trade_date: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  fee: Int8 | null;
  tax: Int8 | null;
  source: Def<string>;
  import_batch_id: string | null;
  external_ref: string | null;
  created_at: TsDef;
}

export interface CorporateActionsTable {
  id: Def<string>;
  symbol: string;
  type: string;
  ex_date: string;
  record_date: string | null;
  pay_date: string | null;
  listing_date: string | null;
  amount_per_share: Int8 | null;
  ratio_num: number | null;
  ratio_den: number | null;
  created_at: TsDef;
}

export interface AssetsTable {
  id: Def<string>;
  type: string;
  name: string;
  value: Int8;
  as_of: string;
  created_at: TsDef;
}

export interface WatchlistTable {
  symbol: string;
  group_name: Def<string>;
  added_at: TsDef;
}

export interface SettingsTable {
  id: Def<number>;
  fee_rate_ppm: number | null;
  sell_tax_rate_ppm: number;
  dividend_withholding_rate_ppm: number;
  settlement_days: number;
  holidays: ColumnType<string[], string[] | undefined, string[]>;
  cash_dividend_treatment: string;
  cost_method: string;
  concentration_threshold_ppm: number | null;
  rule_configs: JsonDef;
  updated_at: TsDef;
}

export interface PricesDailyTable {
  symbol: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: Int8;
  foreign_net: Int8 | null;
  source: string;
  fetched_at: string;
}

export interface DataGapsTable {
  id: Generated<string>;
  symbol: string | null;
  data_type: string;
  from_ts: string;
  to_ts: string;
  detected_at: TsDef;
  source: string;
  fetched_at: string;
  resolved_at: string | null;
  resolved_reason: string | null;
}

export interface SymbolsTable {
  symbol: string;
  exchange: string | null;
  created_at: TsDef;
  updated_at: TsDef;
  sector: string | null;
  sector_source: string | null;
  sector_fetched_at: string | null;
}

export interface FinancialsTable {
  symbol: string;
  period: string;
  eps: Int8;
  bvps: Int8;
  revenue: Int8;
  net_income: Int8;
  source: string;
  fetched_at: string;
}

export interface SignalsTable {
  id: Generated<string>;
  symbol: string;
  rule_id: string;
  horizon: string;
  signal_date: string;
  status: string;
  label: string | null;
  value: Int8 | null;
  data_fresh: boolean;
  reason_codes: ColumnType<string[], string[] | undefined, string[]>;
  inputs_snapshot: Json;
  rule_version: number;
  computed_at: string;
  created_at: TsDef;
}

export interface PricesIntradayTable {
  symbol: string;
  ts: string;
  price: number;
  volume: Int8;
  source: string;
  fetched_at: string;
}

export interface LotteryDrawsTable {
  game: string;
  draw_no: number;
  draw_date: string;
  numbers: number[];
  bonus: number | null;
  jackpot_vnd: Int8 | null;
  jackpot_winners: number | null;
  jackpot2_vnd: Int8 | null;
  jackpot2_winners: number | null;
  source: string;
  fetched_at: string;
  created_at: TsDef;
}

export interface LotteryTicketsTable {
  id: Def<string>;
  game: string;
  draw_no: number;
  lines: Json;
  cost_vnd: Int8;
  channel: string;
  purchased_at: string;
  status: Def<string>;
  prize_tier: string | null;
  gross_vnd: Int8 | null;
  checked_at: string | null;
  raw_text: string | null;
  created_at: TsDef;
}

export interface FinancialLinesTable {
  symbol: string;
  period_kind: string;
  period: string;
  statement: string;
  line: string;
  value: Int8;
  source: string;
  fetched_at: string;
}

export interface NewsTable {
  id: Generated<string>;
  url: string;
  title: string;
  source: string;
  credibility: string;
  published_at: string;
  fetched_at: string;
  symbols: ColumnType<string[], string[] | undefined, string[]>;
  excerpt: Def<string>;
}

export interface AiUsageTable {
  id: Generated<string>;
  created_at: TsDef;
  settled_at: string | null;
  provider: string;
  model: string;
  task: string;
  status: string;
  input_tokens: Def<number>;
  output_tokens: Def<number>;
  reserved_micro_usd: Int8;
  cost_micro_usd: Int8 | null;
  error_code: string | null;
}

/** Current Vault shape (secret_id); STK-082 replaces it. */
export interface AiKeysTable {
  provider: string;
  secret_id: string;
  last4: string;
  updated_at: TsDef;
}

export interface AiSummariesTable {
  id: Generated<string>;
  scope: string;
  symbol: Def<string>;
  summary_date: string;
  generator: string;
  provider: string | null;
  model: string | null;
  usage_id: Int8Gen | null;
  body_version: Def<number>;
  body: Json;
  input_ids: ColumnType<string[], string[] | undefined, string[]>;
  created_at: TsDef;
}

export interface Database {
  transactions: TransactionsTable;
  corporate_actions: CorporateActionsTable;
  assets: AssetsTable;
  watchlist: WatchlistTable;
  settings: SettingsTable;
  prices_daily: PricesDailyTable;
  data_gaps: DataGapsTable;
  symbols: SymbolsTable;
  financials: FinancialsTable;
  signals: SignalsTable;
  prices_intraday: PricesIntradayTable;
  lottery_draws: LotteryDrawsTable;
  lottery_tickets: LotteryTicketsTable;
  financial_lines: FinancialLinesTable;
  news: NewsTable;
  ai_usage: AiUsageTable;
  ai_keys: AiKeysTable;
  ai_summaries: AiSummariesTable;
}

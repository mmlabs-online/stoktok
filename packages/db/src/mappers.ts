/** Row <-> domain conversions for assets and watchlist. No financial calculation (R1); integers only (R2). */
import { EXCHANGES, RowMappingError, parseStoredSummaryBody, toSafeInt } from '@stoktok/core';
import type { AiSummaryBody, DrawResult, Exchange, GameId, IntradayQuote, PoolPrize, TierId, PriceQuote, SectorInfo, SignalLabel, SignalStatus, StoredClose, StoredSignal } from '@stoktok/core';
import type { AiSummaryRow, AssetRow, FinancialLineRow, FinancialRow, LotteryDrawInsert, LotteryDrawRow, LotteryTicketInsert, LotteryTicketRow, OpenGapRow, PriceCloseRow, PriceDailyRow, PriceIntradayRow, SignalRow, SymbolSectorRow, TradeDateRow, WatchlistRow } from './rows';

export interface Asset {
  id: string;
  type: 'cash' | 'other';
  name: string;
  /** Integer VND. */
  value: number;
  /** 'YYYY-MM-DD'. */
  asOf: string;
}

export interface WatchlistEntry {
  symbol: string;
  group: string;
  addedAt: string;
}

// core does not export isValidDate; a local format check avoids a core change (STK-006 plan).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assetFromRow(row: AssetRow): Asset {
  const t = 'assets';
  if (row.type !== 'cash' && row.type !== 'other') throw new RowMappingError(t, 'type', `invalid type: ${row.type}`);
  if (typeof row.as_of !== 'string' || !DATE_RE.test(row.as_of)) {
    throw new RowMappingError(t, 'as_of', `invalid date: ${String(row.as_of)}`);
  }
  return { id: row.id, type: row.type, name: row.name, value: toSafeInt(row.value, 'value', t), asOf: row.as_of };
}

export function assetToRow(asset: Omit<Asset, 'id'>): Omit<AssetRow, 'id'> {
  return { type: asset.type, name: asset.name, value: asset.value, as_of: asset.asOf };
}

export function watchlistFromRow(row: WatchlistRow): WatchlistEntry {
  return { symbol: row.symbol, group: row.group_name, addedAt: row.added_at };
}

/** R4: a quote without source or fetched_at is rejected, never shown as current. */
export function priceQuoteFromRow(row: PriceDailyRow): PriceQuote {
  const t = 'prices_daily';
  if (typeof row.trade_date !== 'string' || !DATE_RE.test(row.trade_date)) {
    throw new RowMappingError(t, 'trade_date', `invalid date: ${String(row.trade_date)}`);
  }
  const close = toSafeInt(row.close, 'close', t);
  if (close < 0) throw new RowMappingError(t, 'close', `negative close: ${close}`);
  if (typeof row.source !== 'string' || row.source === '') throw new RowMappingError(t, 'source', 'missing source');
  if (typeof row.fetched_at !== 'string' || row.fetched_at === '') {
    throw new RowMappingError(t, 'fetched_at', 'missing fetched_at');
  }
  return { symbol: row.symbol, close, tradeDate: row.trade_date, source: row.source, fetchedAt: row.fetched_at };
}

/** null = unknown exchange. A stored value outside EXCHANGES is a mapping error, never coerced. */
export function symbolExchangeFromRow(row: { symbol: string; exchange: string | null }): Exchange | null {
  if (row.exchange === null) return null;
  const found = EXCHANGES.find((e) => e === row.exchange);
  if (!found) throw new RowMappingError('symbols', 'exchange', `invalid exchange: ${String(row.exchange)}`);
  return found;
}

export function storedCloseFromRow(row: PriceCloseRow): StoredClose {
  const volume = toSafeInt(row.volume, 'volume', 'prices_daily');
  if (volume < 0) throw new RowMappingError('prices_daily', 'volume', `negative volume: ${volume}`);
  return { ...priceQuoteFromRow(row), volume };
}

export function intradayQuoteFromRow(row: PriceIntradayRow): IntradayQuote {
  const volume = toSafeInt(row.volume, 'volume', 'prices_intraday');
  if (volume < 0) throw new RowMappingError('prices_intraday', 'volume', `negative volume: ${volume}`);
  return {
    symbol: row.symbol,
    ts: row.ts,
    price: toSafeInt(row.price, 'price', 'prices_intraday'),
    volume,
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

export interface FinancialRecord {
  symbol: string;
  /** 'YYYYQn'. */
  period: string;
  /** Integer VND per share, as published (basis UNVERIFIED, see docs/adr/0002). */
  eps: number;
  bvps: number;
  /** Integer VND. */
  revenue: number;
  netIncome: number;
  source: string;
  fetchedAt: string;
}

const PERIOD_RE = /^\d{4}Q[1-4]$/;

/** R4: a row without source or fetched_at is rejected. */
export function financialFromRow(row: FinancialRow): FinancialRecord {
  const t = 'financials';
  if (typeof row.period !== 'string' || !PERIOD_RE.test(row.period)) {
    throw new RowMappingError(t, 'period', `invalid period: ${String(row.period)}`);
  }
  if (typeof row.source !== 'string' || row.source === '') throw new RowMappingError(t, 'source', 'missing source');
  if (typeof row.fetched_at !== 'string' || row.fetched_at === '') {
    throw new RowMappingError(t, 'fetched_at', 'missing fetched_at');
  }
  return {
    symbol: row.symbol,
    period: row.period,
    eps: toSafeInt(row.eps, 'eps', t),
    bvps: toSafeInt(row.bvps, 'bvps', t),
    revenue: toSafeInt(row.revenue, 'revenue', t),
    netIncome: toSafeInt(row.net_income, 'net_income', t),
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

export interface FinancialLineRecord {
  symbol: string;
  periodKind: 'quarter' | 'year';
  /** 'YYYYQn' for quarter rows, 'YYYY' for year rows. */
  period: string;
  statement: 'income' | 'balance' | 'cashflow';
  line: string;
  /** Integer VND. */
  value: number;
  source: string;
  fetchedAt: string;
}

const LINE_PERIOD_RE = { quarter: /^\d{4}Q[1-4]$/, year: /^\d{4}$/ } as const;

/** R4: a row without source or fetched_at is rejected. */
export function financialLineFromRow(row: FinancialLineRow): FinancialLineRecord {
  const t = 'financial_lines';
  if (row.period_kind !== 'quarter' && row.period_kind !== 'year') {
    throw new RowMappingError(t, 'period_kind', `invalid period_kind: ${String(row.period_kind)}`);
  }
  if (typeof row.period !== 'string' || !LINE_PERIOD_RE[row.period_kind].test(row.period)) {
    throw new RowMappingError(t, 'period', `invalid period: ${String(row.period)}`);
  }
  if (typeof row.source !== 'string' || row.source === '') throw new RowMappingError(t, 'source', 'missing source');
  if (typeof row.fetched_at !== 'string' || row.fetched_at === '') {
    throw new RowMappingError(t, 'fetched_at', 'missing fetched_at');
  }
  return {
    symbol: row.symbol,
    periodKind: row.period_kind,
    period: row.period,
    statement: row.statement,
    line: row.line,
    value: toSafeInt(row.value, 'value', t),
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

export interface OpenGapRecord {
  id: number;
  symbol: string | null;
  fromTs: string;
  toTs: string;
}

export function openGapFromRow(row: OpenGapRow): OpenGapRecord {
  return { id: toSafeInt(row.id, 'id', 'data_gaps'), symbol: row.symbol, fromTs: row.from_ts, toTs: row.to_ts };
}

export function tradeDateFromRow(row: TradeDateRow): string {
  if (typeof row.trade_date !== 'string' || !DATE_RE.test(row.trade_date)) {
    throw new RowMappingError('prices_daily', 'trade_date', `invalid date: ${String(row.trade_date)}`);
  }
  return row.trade_date;
}

/** R4: a sector without source or fetched_at is rejected; no sector means unknown. */
export function symbolSectorFromRow(row: SymbolSectorRow): SectorInfo {
  if (row.sector === null) return { sector: null, source: null, fetchedAt: null };
  const t = 'symbols';
  if (typeof row.sector_source !== 'string' || row.sector_source === '') throw new RowMappingError(t, 'sector_source', 'missing sector source');
  if (typeof row.sector_fetched_at !== 'string' || row.sector_fetched_at === '') {
    throw new RowMappingError(t, 'sector_fetched_at', 'missing sector fetched_at');
  }
  return { sector: row.sector, source: row.sector_source, fetchedAt: row.sector_fetched_at };
}

const SIGNAL_LABELS: readonly string[] = ['bullish', 'bearish', 'neutral'];

/**
 * Strict on what the table checks guarantee (status, label, date, integers: R2). Lenient on `reason_codes`
 * (unknown codes are kept) and `inputs_snapshot` (passed through): core parses and labels them.
 */
export function signalFromRow(row: SignalRow): StoredSignal {
  const t = 'signals';
  if (row.status !== 'ok' && row.status !== 'suppressed') throw new RowMappingError(t, 'status', `invalid status: ${String(row.status)}`);
  if (row.label !== null && !SIGNAL_LABELS.includes(row.label)) throw new RowMappingError(t, 'label', `invalid label: ${String(row.label)}`);
  if (typeof row.signal_date !== 'string' || !DATE_RE.test(row.signal_date)) {
    throw new RowMappingError(t, 'signal_date', `invalid date: ${String(row.signal_date)}`);
  }
  return {
    symbol: row.symbol,
    ruleId: row.rule_id,
    signalDate: row.signal_date,
    status: row.status as SignalStatus,
    label: row.label as SignalLabel | null,
    value: row.value === null ? null : toSafeInt(row.value, 'value', t),
    reasonCodes: Array.isArray(row.reason_codes) ? row.reason_codes.filter((c): c is string => typeof c === 'string') : [],
    inputs: row.inputs_snapshot,
    ruleVersion: toSafeInt(row.rule_version, 'rule_version', t),
    computedAt: row.computed_at,
  };
}

const GAME_IDS: readonly string[] = ['mega645', 'power655'];
const TIER_IDS: readonly string[] = ['jackpot', 'jackpot1', 'jackpot2', 'first', 'second', 'third'];
const LOTTERY_CHANNELS = ['sms', 'momo', 'manual'] as const;
const LOTTERY_STATUSES = ['pending', 'won', 'lost'] as const;
export type LotteryChannel = (typeof LOTTERY_CHANNELS)[number];
export type LotteryStatus = (typeof LOTTERY_STATUSES)[number];

/** The draw number as a plain decimal string (STK-053 A4). */
export function drawIdFromNo(drawNo: number): string {
  return String(drawNo);
}

/** Accepts leading zeros ('00123' is 123). Throws RowMappingError; callers map it to VALIDATION or MAPPING. */
export function drawNoFromId(drawId: string): number {
  if (!/^\d+$/.test(drawId) || Number(drawId) < 1 || !Number.isSafeInteger(Number(drawId))) {
    throw new RowMappingError('lottery', 'draw_no', `invalid draw id: ${drawId}`);
  }
  return Number(drawId);
}

/** Pool columns per game: the first holds `jackpot` (mega645) or `jackpot1` (power655), the second `jackpot2`. */
function poolTiers(game: GameId): { first: TierId; second: TierId | null } {
  return game === 'mega645' ? { first: 'jackpot', second: null } : { first: 'jackpot1', second: 'jackpot2' };
}

export type StoredDrawResult = DrawResult & { source: string; fetchedAt: string };

/** R4: a draw without source or fetched_at is rejected. */
export function lotteryDrawFromRow(row: LotteryDrawRow): StoredDrawResult {
  const t = 'lottery_draws';
  if (!GAME_IDS.includes(row.game)) throw new RowMappingError(t, 'game', `invalid game: ${String(row.game)}`);
  const game = row.game as GameId;
  if (typeof row.draw_date !== 'string' || !DATE_RE.test(row.draw_date)) {
    throw new RowMappingError(t, 'draw_date', `invalid date: ${String(row.draw_date)}`);
  }
  if (typeof row.source !== 'string' || row.source === '') throw new RowMappingError(t, 'source', 'missing source');
  if (typeof row.fetched_at !== 'string' || row.fetched_at === '') {
    throw new RowMappingError(t, 'fetched_at', 'missing fetched_at');
  }
  const tiers = poolTiers(game);
  const pools: Partial<Record<TierId, PoolPrize>> = {};
  const pool = (tier: TierId | null, amount: unknown, winners: number | null, col: string) => {
    if (tier === null || amount === null || winners === null) return;
    pools[tier] = { amountVnd: toSafeInt(amount as number, col, t), winnerCount: toSafeInt(winners, col, t) };
  };
  pool(tiers.first, row.jackpot_vnd, row.jackpot_winners, 'jackpot_vnd');
  pool(tiers.second, row.jackpot2_vnd, row.jackpot2_winners, 'jackpot2_vnd');
  return {
    gameId: game,
    drawId: drawIdFromNo(row.draw_no),
    drawDate: row.draw_date,
    numbers: row.numbers.map((n) => toSafeInt(n, 'numbers', t)),
    ...(row.bonus === null ? {} : { bonus: toSafeInt(row.bonus, 'bonus', t) }),
    ...(Object.keys(pools).length > 0 ? { pools } : {}),
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

export function lotteryDrawToRow(draw: StoredDrawResult): LotteryDrawInsert {
  const tiers = poolTiers(draw.gameId);
  const first = draw.pools?.[tiers.first];
  const second = tiers.second ? draw.pools?.[tiers.second] : undefined;
  return {
    game: draw.gameId,
    draw_no: drawNoFromId(draw.drawId),
    draw_date: draw.drawDate,
    numbers: draw.numbers,
    bonus: draw.bonus ?? null,
    jackpot_vnd: first?.amountVnd ?? null,
    jackpot_winners: first?.winnerCount ?? null,
    jackpot2_vnd: second?.amountVnd ?? null,
    jackpot2_winners: second?.winnerCount ?? null,
    source: draw.source,
    fetched_at: draw.fetchedAt,
  };
}

export interface StoredLotteryTicket {
  id: string;
  gameId: GameId;
  drawId: string;
  lines: number[][];
  /** Integer VND. */
  costVnd: number;
  channel: LotteryChannel;
  purchasedAt: string;
  status: LotteryStatus;
  prizeTier: TierId | null;
  /** Integer VND before tax; null while pending. */
  grossVnd: number | null;
  checkedAt: string | null;
  rawText: string | null;
  createdAt: string;
}

export interface LotteryTicketInput {
  gameId: GameId;
  drawId: string;
  lines: number[][];
  costVnd: number;
  channel: LotteryChannel;
  purchasedAt: string;
  rawText: string | null;
}

/** Strict on shape only; game rules are core's job. */
export function lotteryTicketFromRow(row: LotteryTicketRow): StoredLotteryTicket {
  const t = 'lottery_tickets';
  if (!GAME_IDS.includes(row.game)) throw new RowMappingError(t, 'game', `invalid game: ${String(row.game)}`);
  if (!(LOTTERY_STATUSES as readonly string[]).includes(row.status)) {
    throw new RowMappingError(t, 'status', `invalid status: ${String(row.status)}`);
  }
  if (!(LOTTERY_CHANNELS as readonly string[]).includes(row.channel)) {
    throw new RowMappingError(t, 'channel', `invalid channel: ${String(row.channel)}`);
  }
  if (row.prize_tier !== null && !TIER_IDS.includes(row.prize_tier)) {
    throw new RowMappingError(t, 'prize_tier', `invalid prize tier: ${String(row.prize_tier)}`);
  }
  if (
    !Array.isArray(row.lines) ||
    !row.lines.every((l: unknown) => Array.isArray(l) && l.every((n: unknown) => Number.isSafeInteger(n)))
  ) {
    throw new RowMappingError(t, 'lines', 'lines is not an array of integer arrays');
  }
  return {
    id: row.id,
    gameId: row.game as GameId,
    drawId: drawIdFromNo(row.draw_no),
    lines: row.lines as number[][],
    costVnd: toSafeInt(row.cost_vnd, 'cost_vnd', t),
    channel: row.channel as LotteryChannel,
    purchasedAt: row.purchased_at,
    status: row.status as LotteryStatus,
    prizeTier: row.prize_tier as TierId | null,
    grossVnd: row.gross_vnd === null ? null : toSafeInt(row.gross_vnd, 'gross_vnd', t),
    checkedAt: row.checked_at,
    rawText: row.raw_text,
    createdAt: row.created_at,
  };
}

export function lotteryTicketToRow(input: LotteryTicketInput): LotteryTicketInsert {
  return {
    game: input.gameId,
    draw_no: drawNoFromId(input.drawId),
    lines: input.lines,
    cost_vnd: input.costVnd,
    channel: input.channel,
    purchased_at: input.purchasedAt,
    raw_text: input.rawText,
  };
}

export interface AiSummaryRecord {
  id: number;
  scope: 'symbol' | 'portfolio';
  /** '' for the portfolio. */
  symbol: string;
  /** 'YYYY-MM-DD'. */
  summaryDate: string;
  generator: 'model' | 'template';
  provider: string | null;
  model: string | null;
  usageId: number | null;
  /** Null when the stored body fails core validation, so the job can regenerate it. */
  body: AiSummaryBody | null;
  inputIds: string[];
  createdAt: string;
}

export function aiSummaryFromRow(row: AiSummaryRow): AiSummaryRecord {
  const t = 'ai_summaries';
  if (row.scope !== 'symbol' && row.scope !== 'portfolio') throw new RowMappingError(t, 'scope', `invalid scope: ${String(row.scope)}`);
  if (row.generator !== 'model' && row.generator !== 'template') throw new RowMappingError(t, 'generator', `invalid generator: ${String(row.generator)}`);
  if (typeof row.summary_date !== 'string' || !DATE_RE.test(row.summary_date)) {
    throw new RowMappingError(t, 'summary_date', `invalid date: ${String(row.summary_date)}`);
  }
  return {
    id: toSafeInt(row.id, 'id', t),
    scope: row.scope,
    symbol: row.symbol,
    summaryDate: row.summary_date,
    generator: row.generator,
    provider: row.provider,
    model: row.model,
    usageId: row.usage_id === null ? null : toSafeInt(row.usage_id, 'usage_id', t),
    body: parseStoredSummaryBody(row.body),
    inputIds: Array.isArray(row.input_ids) ? row.input_ids.filter((x): x is string => typeof x === 'string') : [],
    createdAt: row.created_at,
  };
}

import type { CorporateAction } from '../ledger/types';
import type { StoredClose } from '../market/price-board';
import type { Exchange } from '../settings/market-rules';
import type { SignalRules } from './config';

/** Shared shapes for the medium-term signal rules (STK-015). Pure types and constants, no I/O. */

export const RULE_VERSION = 1;
export const SIGNAL_HORIZON = 'medium' as const;

export const RULE_IDS = {
  peVsSector: 'pe_vs_sector',
  pbVsSector: 'pb_vs_sector',
  earningsGrowth: 'earnings_growth_trend',
} as const;

export function maRuleId(days: number): string {
  return `price_vs_ma_${days}`;
}

/** Data reasons: the input data is stale, gapped or missing. They set dataFresh=false. */
export const DATA_REASONS = [
  'price_missing',
  'price_stale',
  'insufficient_history',
  'price_gap',
  'price_gap_recorded',
  'financials_missing',
  'financials_stale',
  'financials_gap',
  'financials_gap_recorded',
  'financials_fetch_stale',
  'sector_missing',
] as const;

/** Rule reasons: the data is fresh but the rule cannot give a meaningful value (incl. raw-price guards for the MA rules). */
export const RULE_REASONS = [
  'eps_basis_unverified',
  'eps_non_positive',
  'bvps_non_positive',
  'peers_insufficient',
  'value_out_of_range',
  'corporate_action_in_window',
  'price_jump_beyond_limit',
] as const;

export type DataReason = (typeof DATA_REASONS)[number];
export type ReasonCode = DataReason | (typeof RULE_REASONS)[number];

/** Fixed order in which reasons are reported. */
export const REASON_ORDER: readonly ReasonCode[] = [...DATA_REASONS, ...RULE_REASONS];

export type SignalStatus = 'ok' | 'suppressed';
/** A direction of a rule, never an action (R9, R10). */
export type SignalLabel = 'bullish' | 'bearish' | 'neutral';

/** What the stored EPS means. Declared by the data source; 'unverified' until confirmed (docs/adr/0002). */
export type EpsBasis = 'quarterly' | 'ttm' | 'unverified';

/** A stored quarter with provenance (R4). Integer VND (R2). */
export interface StoredFinancials {
  symbol: string;
  /** 'YYYYQn'. */
  period: string;
  eps: number;
  bvps: number;
  revenue: number;
  netIncome: number;
  source: string;
  fetchedAt: string;
}

export interface SectorInfo {
  sector: string | null;
  source: string | null;
  fetchedAt: string | null;
}

/** An open data gap; symbol null means market-wide. */
export interface GapRef {
  id: number;
  symbol: string | null;
  fromTs: string;
  toTs: string;
}

/** Everything stored about one symbol that the rules read. */
export interface SymbolData {
  /** Daily closes in any order. */
  closes: StoredClose[];
  financials: StoredFinancials[];
  sector: SectorInfo;
  /** Null when unknown; the guard then uses the widest configured limit. */
  exchange: Exchange | null;
  corporateActions: readonly CorporateAction[];
}

/** Inputs every rule shares. The caller supplies the date and the holidays; core never reads the clock. */
export interface RuleContext {
  signalDate: string;
  holidays: readonly string[];
  rules: SignalRules;
  publishLagDays: number;
  priceGaps: readonly GapRef[];
  financialsGaps: readonly GapRef[];
  /** EPS basis declared per data source name. A missing source is 'unverified'. */
  epsBasisBySource: Readonly<Record<string, EpsBasis>>;
  /** Daily price limit per exchange, from market configuration (R5). */
  priceLimitPpm: Readonly<Record<Exchange, number>>;
}

/** One cited stored input (R9): `ref` is an ID, source and fetchedAt are its provenance (R4). */
export interface SnapshotRef {
  ref: string;
  source?: string;
  fetchedAt?: string;
  fromTs?: string;
  toTs?: string;
}

export interface SignalResult {
  symbol: string;
  ruleId: string;
  ruleVersion: number;
  horizon: typeof SIGNAL_HORIZON;
  /** The data date this signal is about. */
  signalDate: string;
  status: SignalStatus;
  label: SignalLabel | null;
  /** Integer; unit depends on the rule (ppm, or quarters for the growth streak). */
  value: number | null;
  /** False when a data reason is among `reasons`. */
  dataFresh: boolean;
  reasons: ReasonCode[];
  /** Inputs snapshot for audit. */
  inputs: Record<string, unknown>;
}

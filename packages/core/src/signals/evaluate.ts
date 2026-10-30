/** Runs every enabled medium-term rule for a universe of symbols. Pure and deterministic. */
import type { CorporateAction } from '../ledger/types';
import type { StoredClose } from '../market/price-board';
import type { Exchange, MarketRules } from '../settings/market-rules';
import type { SignalRules } from './config';
import { earningsGrowthTrend } from './growth';
import { priceVsMa } from './moving-average';
import { pbVsSector, peVsSector } from './valuation';
import type { EpsBasis, GapRef, RuleContext, SectorInfo, SignalResult, StoredFinancials, SymbolData } from './types';

export interface EvaluateInput {
  signalDate: string;
  holidays: readonly string[];
  rules: SignalRules;
  publishLagDays: number;
  symbols: readonly string[];
  closes: Readonly<Record<string, readonly StoredClose[]>>;
  financials: readonly StoredFinancials[];
  sectors: Readonly<Record<string, SectorInfo>>;
  priceGaps: readonly GapRef[];
  financialsGaps: readonly GapRef[];
  epsBasisBySource: Readonly<Record<string, EpsBasis>>;
  /** A symbol missing here, or null, has an unknown exchange. */
  exchanges: Readonly<Record<string, Exchange | null>>;
  corporateActions: readonly CorporateAction[];
  marketRules: Pick<MarketRules, 'priceLimitPpm'>;
}

const NO_SECTOR: SectorInfo = { sector: null, source: null, fetchedAt: null };

export function evaluateMediumSignals(input: EvaluateInput): SignalResult[] {
  const { rules } = input;
  const ctx: RuleContext = {
    signalDate: input.signalDate,
    holidays: input.holidays,
    rules,
    publishLagDays: input.publishLagDays,
    priceGaps: input.priceGaps,
    financialsGaps: input.financialsGaps,
    epsBasisBySource: input.epsBasisBySource,
    priceLimitPpm: input.marketRules.priceLimitPpm,
  };
  const symbols = [...new Set(input.symbols)].sort();
  const universe: Record<string, SymbolData> = {};
  for (const s of symbols) {
    universe[s] = {
      closes: [...(input.closes[s] ?? [])],
      financials: input.financials.filter((f) => f.symbol === s),
      sector: input.sectors[s] ?? NO_SECTOR,
      exchange: input.exchanges[s] ?? null,
      corporateActions: input.corporateActions.filter((a) => a.symbol === s),
    };
  }

  const results: SignalResult[] = [];
  for (const s of symbols) {
    const data = universe[s] as SymbolData;
    if (rules.peVsSector.enabled) results.push(peVsSector(s, universe, ctx));
    if (rules.pbVsSector.enabled) results.push(pbVsSector(s, universe, ctx));
    if (rules.earningsGrowth.enabled) results.push(earningsGrowthTrend(s, data, ctx));
    if (rules.priceVsMa.enabled) {
      results.push(priceVsMa(s, data, rules.priceVsMa.shortDays, ctx));
      results.push(priceVsMa(s, data, rules.priceVsMa.longDays, ctx));
    }
  }
  return results.sort((a, b) => (a.symbol === b.symbol ? (a.ruleId < b.ruleId ? -1 : 1) : a.symbol < b.symbol ? -1 : 1));
}

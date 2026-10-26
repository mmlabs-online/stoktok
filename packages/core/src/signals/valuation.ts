/** P/E and P/B of a symbol against the median of its sector peers. Pure. */
import { PPM, mulDiv } from '../money';
import type { ValuationRuleParams } from './config';
import {
  checkFinancials,
  checkLatestPrice,
  finalizeResult,
  financialsRef,
  gapSnapshotRef,
  medianInt,
  priceRef,
  requiredQuarters,
  resolveEpsBasis,
  safeRatioPpm,
  ttmEps,
} from './inputs';
import { RULE_IDS } from './types';
import type { EpsBasis, ReasonCode, RuleContext, SignalLabel, SignalResult, SnapshotRef, SymbolData } from './types';

type Kind = 'pe' | 'pb';

interface Facts {
  reasons: ReasonCode[];
  ratioPpm: number | null;
  basis: EpsBasis;
  close: number | null;
  denominator: number | null;
  refs: SnapshotRef[];
  missingPeriods: string[];
}

/** Price and financials checks plus the ratio of one symbol. The ratio exists only when the data is fresh and valid. */
function factsOf(kind: Kind, symbol: string, data: SymbolData, ctx: RuleContext): Facts {
  const basis = kind === 'pe' ? resolveEpsBasis(data.financials.filter((f) => f.symbol === symbol), ctx.epsBasisBySource) : 'quarterly';
  const price = checkLatestPrice(data.closes, ctx.signalDate);
  const fin = checkFinancials({
    symbol,
    rows: data.financials,
    required: requiredQuarters(kind, basis, ctx.rules),
    signalDate: ctx.signalDate,
    publishLagDays: ctx.publishLagDays,
    gaps: ctx.financialsGaps,
    maxFetchAgeDays: ctx.rules.freshness.financialsMaxFetchAgeDays,
  });
  const reasons: ReasonCode[] = [...price.reasons, ...fin.reasons];
  const refs: SnapshotRef[] = [
    ...(price.latest ? [priceRef(price.latest)] : []),
    ...fin.rows.map(financialsRef),
    ...fin.gaps.map(gapSnapshotRef),
  ];
  let denominator: number | null = null;
  if (fin.rows.length > 0) {
    if (kind === 'pe') {
      if (basis === 'unverified') reasons.push('eps_basis_unverified');
      else denominator = ttmEps(fin.rows, basis);
      if (denominator !== null && denominator <= 0) reasons.push('eps_non_positive');
    } else {
      denominator = (fin.rows[fin.rows.length - 1] as { bvps: number }).bvps;
      if (denominator <= 0) reasons.push('bvps_non_positive');
    }
  }
  const close = price.latest?.tradeDate === ctx.signalDate ? price.latest.close : null;
  let ratioPpm: number | null = null;
  if (reasons.length === 0 && close !== null && denominator !== null) {
    ratioPpm = safeRatioPpm(close, denominator);
    if (ratioPpm === null) reasons.push('value_out_of_range');
  }
  return { reasons, ratioPpm, basis, close, denominator, refs, missingPeriods: fin.missingPeriods };
}

function valuationVsSector(
  kind: Kind,
  symbol: string,
  universe: Readonly<Record<string, SymbolData>>,
  ctx: RuleContext,
): SignalResult {
  const params: ValuationRuleParams = kind === 'pe' ? ctx.rules.peVsSector : ctx.rules.pbVsSector;
  const ruleId = kind === 'pe' ? RULE_IDS.peVsSector : RULE_IDS.pbVsSector;
  const data = universe[symbol] as SymbolData;
  const subject = factsOf(kind, symbol, data, ctx);
  const reasons: ReasonCode[] = [...subject.reasons];
  const refs: SnapshotRef[] = [...subject.refs];

  const sector = data.sector.sector;
  const peers: { symbol: string; ratioPpm: number }[] = [];
  const excluded: { symbol: string; reasons: ReasonCode[] }[] = [];
  if (sector === null) {
    reasons.push('sector_missing');
  } else {
    if (data.sector.source !== null && data.sector.fetchedAt !== null) {
      refs.push({ ref: `symbols:${symbol}:sector`, source: data.sector.source, fetchedAt: data.sector.fetchedAt });
    }
    for (const other of Object.keys(universe).sort()) {
      if (other === symbol || (universe[other] as SymbolData).sector.sector !== sector) continue;
      const f = factsOf(kind, other, universe[other] as SymbolData, ctx);
      if (f.ratioPpm === null) excluded.push({ symbol: other, reasons: f.reasons });
      else peers.push({ symbol: other, ratioPpm: f.ratioPpm });
    }
    if (peers.length < params.minPeers) reasons.push('peers_insufficient');
  }

  let label: SignalLabel | null = null;
  let value: number | null = null;
  let median: number | null = null;
  let classification: 'cheap' | 'expensive' | 'in_line' | null = null;
  if (reasons.length === 0 && subject.ratioPpm !== null) {
    median = medianInt(peers.map((p) => p.ratioPpm));
    if (median === null || median <= 0) {
      reasons.push('value_out_of_range');
    } else {
      try {
        value = mulDiv(subject.ratioPpm - median, PPM, median);
        if (value <= -params.discountPpm) [label, classification] = ['bullish', 'cheap'];
        else if (value >= params.premiumPpm) [label, classification] = ['bearish', 'expensive'];
        else [label, classification] = ['neutral', 'in_line'];
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        reasons.push('value_out_of_range');
      }
    }
  }

  return finalizeResult({
    symbol,
    ruleId,
    signalDate: ctx.signalDate,
    reasons,
    label,
    value,
    inputs: {
      refs,
      params,
      ...(kind === 'pe' ? { epsBasis: subject.basis } : {}),
      sector,
      close: subject.close,
      denominator: subject.denominator,
      ratioPpm: subject.ratioPpm,
      medianPpm: median,
      peerCount: peers.length,
      peers,
      excluded,
      missingPeriods: subject.missingPeriods,
      classification,
    },
  });
}

/** P/E (price / trailing EPS) vs the median of valid sector peers. Suppressed until the EPS basis is verified. */
export function peVsSector(symbol: string, universe: Readonly<Record<string, SymbolData>>, ctx: RuleContext): SignalResult {
  return valuationVsSector('pe', symbol, universe, ctx);
}

/** P/B (price / latest book value per share) vs the median of valid sector peers. */
export function pbVsSector(symbol: string, universe: Readonly<Record<string, SymbolData>>, ctx: RuleContext): SignalResult {
  return valuationVsSector('pb', symbol, universe, ctx);
}

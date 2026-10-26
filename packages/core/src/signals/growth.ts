/** Year-on-year trend of quarterly net income. Pure. */
import { PPM, mulDiv } from '../money';
import {
  checkFinancials,
  finalizeResult,
  financialsRef,
  gapSnapshotRef,
  requiredQuarters,
} from './inputs';
import { RULE_IDS } from './types';
import type { ReasonCode, RuleContext, SignalLabel, SignalResult, StoredFinancials, SymbolData } from './types';

type Direction = 'up' | 'down' | 'flat';
type GrowthClass = 'up' | 'down' | 'flat' | 'turnaround' | 'to_loss' | 'loss';

interface Comparison {
  period: string;
  baseNetIncome: number;
  netIncome: number;
  growthPpm: number | null;
  class: GrowthClass;
}

function directionOf(c: GrowthClass): Direction {
  if (c === 'up' || c === 'turnaround') return 'up';
  if (c === 'down' || c === 'to_loss' || c === 'loss') return 'down';
  return 'flat';
}

/** Compares a quarter with the same quarter a year earlier. A tiny or non-positive base gives a direction only, no percentage. */
function compare(cur: StoredFinancials, base: StoredFinancials, growthThresholdPpm: number, minBasePpmOfRevenue: number): Comparison {
  const baseOk = base.netIncome > 0 && base.netIncome >= mulDiv(base.revenue, minBasePpmOfRevenue, PPM);
  let growthPpm: number | null = null;
  let cls: GrowthClass;
  if (baseOk) {
    if (cur.netIncome <= 0) {
      cls = 'to_loss';
    } else {
      growthPpm = mulDiv(cur.netIncome - base.netIncome, PPM, base.netIncome);
      cls = growthPpm >= growthThresholdPpm ? 'up' : growthPpm <= -growthThresholdPpm ? 'down' : 'flat';
    }
  } else {
    cls = cur.netIncome > 0 ? 'turnaround' : 'loss';
  }
  return { period: cur.period, baseNetIncome: base.netIncome, netIncome: cur.netIncome, growthPpm, class: cls };
}

/** Earnings growth trend: the signed streak of quarters in the same direction, latest first. */
export function earningsGrowthTrend(symbol: string, data: SymbolData, ctx: RuleContext): SignalResult {
  const params = ctx.rules.earningsGrowth;
  const fin = checkFinancials({
    symbol,
    rows: data.financials,
    required: requiredQuarters('growth', 'unverified', ctx.rules),
    signalDate: ctx.signalDate,
    publishLagDays: ctx.publishLagDays,
    gaps: ctx.financialsGaps,
    maxFetchAgeDays: ctx.rules.freshness.financialsMaxFetchAgeDays,
  });
  const reasons: ReasonCode[] = [...fin.reasons];
  const comparisons: Comparison[] = [];
  let label: SignalLabel | null = null;
  let value: number | null = null;

  if (fin.rows.length > 0) {
    for (let i = fin.rows.length - params.comparisons; i < fin.rows.length; i++) {
      comparisons.push(
        compare(fin.rows[i] as StoredFinancials, fin.rows[i - 4] as StoredFinancials, params.growthThresholdPpm, params.minBasePpmOfRevenue),
      );
    }
    const dirs = comparisons.map((c) => directionOf(c.class));
    const latest = dirs[dirs.length - 1] as Direction;
    let streak = 0;
    if (latest !== 'flat') {
      for (let i = dirs.length - 1; i >= 0 && dirs[i] === latest; i--) streak += 1;
    }
    value = latest === 'down' ? -streak : streak;
    const recent = dirs.slice(-params.minConsecutive);
    label = recent.every((d) => d === 'up') ? 'bullish' : recent.every((d) => d === 'down') ? 'bearish' : 'neutral';
  }

  return finalizeResult({
    symbol,
    ruleId: RULE_IDS.earningsGrowth,
    signalDate: ctx.signalDate,
    reasons,
    label,
    value,
    inputs: {
      refs: [...fin.rows.map(financialsRef), ...fin.gaps.map(gapSnapshotRef)],
      params,
      basis: 'net_income_yoy',
      comparisons,
      streak: value,
      missingPeriods: fin.missingPeriods,
    },
  });
}

/**
 * Decides whether a stored medium-term signal may be shown (R4): stale or gapped data never shows a signal.
 * Pure: no clock, no I/O, never throws on bad stored JSON.
 */
import { isValidDate, subtractTradingDays, vnDateOf } from '../calendar';
import { addQuarters, comparePeriods, latestExpectedPeriod, parsePeriod, quarterBounds } from '../market/quarters';
import type { SignalRules } from './config';
import { SIGNAL_RULE_BOUNDS } from './config';
import { gapOverlaps, requiredQuarters, vnDayBounds } from './inputs';
import { RULE_IDS, RULE_VERSION, maRuleId, parseMaRuleId } from './types';
import type { EpsBasis, GapRef, SnapshotRef, StoredSignal } from './types';

export type VisibilityCode =
  | 'signal_outdated'
  | 'price_gap_open'
  | 'financials_gap_open'
  | 'rule_version_outdated'
  | 'snapshot_invalid';

export interface VisibilityCause {
  code: VisibilityCode;
  /** Open gaps that overlap the rule's window. */
  gapIds?: number[];
  /** VN dates ('YYYY-MM-DD') spanned by those gaps. */
  fromDate?: string;
  toDate?: string;
  /** The session the signal should have been computed for. */
  expectedDate?: string;
}

export type SignalVisibility =
  | { state: 'ok' }
  | { state: 'suppressed'; reasons: string[] }
  | { state: 'hidden'; causes: VisibilityCause[] };

export interface VisibilityContext {
  /** Newest session a signal should be about (expectedPriceDate). */
  expectedDate: string;
  holidays: readonly string[];
  publishLagDays: number;
  rules: SignalRules;
  priceGaps: readonly GapRef[];
  financialsGaps: readonly GapRef[];
}

export interface MaWindowInfo {
  fromDate: string;
  toDate: string;
  count: number;
  sources: string[];
  minFetchedAt: string | null;
  maxFetchedAt: string | null;
}

export type ParsedSnapshot =
  | {
      ok: true;
      refs: SnapshotRef[];
      /** Null when the snapshot has no usable window summary (or `fromDate` is null). */
      maWindow: MaWindowInfo | null;
      epsBasis: EpsBasis | null;
      comparisons: number | null;
      peerCount: number | null;
      sector: string | null;
    }
  | { ok: false };

/** Rule IDs to read for a symbol, in display order: valuation, growth, then the short and long MA. */
export function expectedRuleIds(rules: SignalRules): string[] {
  const ids: string[] = [];
  if (rules.peVsSector.enabled) ids.push(RULE_IDS.peVsSector);
  if (rules.pbVsSector.enabled) ids.push(RULE_IDS.pbVsSector);
  if (rules.earningsGrowth.enabled) ids.push(RULE_IDS.earningsGrowth);
  if (rules.priceVsMa.enabled) ids.push(maRuleId(rules.priceVsMa.shortDays), maRuleId(rules.priceVsMa.longDays));
  return ids;
}

const REF_PREFIXES = ['prices_daily:', 'financials:', 'symbols:', 'data_gaps:', 'corporate_actions:'] as const;
const PROVENANCE_PREFIXES = ['prices_daily:', 'financials:', 'symbols:'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInstant(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function parseRef(raw: unknown): SnapshotRef | null {
  if (!isObject(raw) || typeof raw.ref !== 'string') return null;
  const ref = raw.ref;
  if (!REF_PREFIXES.some((p) => ref.startsWith(p))) return null;
  if (PROVENANCE_PREFIXES.some((p) => ref.startsWith(p))) {
    if (typeof raw.source !== 'string' || raw.source === '' || !isInstant(raw.fetchedAt)) return null;
    return { ref, source: raw.source, fetchedAt: raw.fetchedAt };
  }
  if (ref.startsWith('data_gaps:')) {
    if (!isInstant(raw.fromTs) || !isInstant(raw.toTs)) return null;
    return { ref, fromTs: raw.fromTs, toTs: raw.toTs };
  }
  return { ref };
}

function parseMaWindow(raw: unknown): MaWindowInfo | null {
  if (!isObject(raw) || !isValidDate(raw.fromDate) || !isValidDate(raw.toDate)) return null;
  if (typeof raw.count !== 'number' || !Number.isSafeInteger(raw.count)) return null;
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string') : [];
  return {
    fromDate: raw.fromDate,
    toDate: raw.toDate,
    count: raw.count,
    sources,
    minFetchedAt: isInstant(raw.minFetchedAt) ? raw.minFetchedAt : null,
    maxFetchedAt: isInstant(raw.maxFetchedAt) ? raw.maxFetchedAt : null,
  };
}

/** Reads the audit snapshot with manual guards. A ref without provenance (R4) makes the whole snapshot invalid. */
export function parseSignalSnapshot(row: Pick<StoredSignal, 'inputs'>): ParsedSnapshot {
  const inputs = row.inputs;
  if (!isObject(inputs) || !Array.isArray(inputs.refs)) return { ok: false };
  const refs: SnapshotRef[] = [];
  for (const raw of inputs.refs) {
    const ref = parseRef(raw);
    if (ref === null) return { ok: false };
    refs.push(ref);
  }
  const params = isObject(inputs.params) ? inputs.params : {};
  const b = SIGNAL_RULE_BOUNDS.comparisons;
  const comparisons =
    typeof params.comparisons === 'number' && Number.isSafeInteger(params.comparisons) && params.comparisons >= b.min && params.comparisons <= b.max
      ? params.comparisons
      : null;
  const eps = inputs.epsBasis;
  return {
    ok: true,
    refs,
    maWindow: parseMaWindow(inputs.window),
    epsBasis: eps === 'quarterly' || eps === 'ttm' || eps === 'unverified' ? eps : null,
    comparisons,
    peerCount: typeof inputs.peerCount === 'number' && Number.isSafeInteger(inputs.peerCount) && inputs.peerCount >= 0 ? inputs.peerCount : null,
    sector: typeof inputs.sector === 'string' && inputs.sector !== '' ? inputs.sector : null,
  };
}

function relevantGaps(gaps: readonly GapRef[], symbol: string, from: string, to: string): GapRef[] {
  const bounds = vnDayBounds(from, to);
  return gaps.filter((g) => (g.symbol === symbol || g.symbol === null) && gapOverlaps(g, bounds));
}

function gapCause(code: 'price_gap_open' | 'financials_gap_open', gaps: GapRef[]): VisibilityCause {
  const from = Math.min(...gaps.map((g) => Date.parse(g.fromTs)));
  const to = Math.max(...gaps.map((g) => Date.parse(g.toTs)));
  return { code, gapIds: gaps.map((g) => g.id), fromDate: vnDateOf(new Date(from)), toDate: vnDateOf(new Date(to)) };
}

function citedPeriods(refs: readonly SnapshotRef[]): string[] {
  return refs.flatMap((r) => {
    if (!r.ref.startsWith('financials:')) return [];
    const period = r.ref.slice(r.ref.lastIndexOf(':') + 1);
    return parsePeriod(period) ? [period] : [];
  });
}

/** Financials window [oldest, newest] as periods: the required quarters ending at L, widened to the cited ones. */
function financialsWindow(row: StoredSignal, snap: Extract<ParsedSnapshot, { ok: true }>, ctx: VisibilityContext): { from: string; to: string } {
  const latest = latestExpectedPeriod(row.signalDate, ctx.publishLagDays);
  let required: number;
  if (row.ruleId === RULE_IDS.pbVsSector) required = requiredQuarters('pb', 'quarterly', ctx.rules);
  else if (row.ruleId === RULE_IDS.peVsSector) required = requiredQuarters('pe', snap.epsBasis ?? 'unverified', ctx.rules);
  else {
    const earningsGrowth = { ...ctx.rules.earningsGrowth, comparisons: snap.comparisons ?? ctx.rules.earningsGrowth.comparisons };
    required = requiredQuarters('growth', 'quarterly', { ...ctx.rules, earningsGrowth });
  }
  const cited = citedPeriods(snap.refs).sort(comparePeriods);
  const base = addQuarters(latest, -(required - 1));
  const oldest = cited[0];
  const newest = cited[cited.length - 1];
  return {
    from: oldest !== undefined && comparePeriods(oldest, base) < 0 ? oldest : base,
    to: newest !== undefined && comparePeriods(newest, latest) > 0 ? newest : latest,
  };
}

/**
 * ok / suppressed / hidden. Hidden when any cause applies (stale outranks suppressed): the signal is older
 * than the expected session, an open gap overlaps its window, its rule version is not current, or its snapshot
 * cannot be read. Causes come in a fixed order.
 */
export function signalVisibility(row: StoredSignal, ctx: VisibilityContext): SignalVisibility {
  const causes: VisibilityCause[] = [];
  if (row.signalDate < ctx.expectedDate) causes.push({ code: 'signal_outdated', expectedDate: ctx.expectedDate });

  const snap = parseSignalSnapshot(row);
  if (snap.ok && isValidDate(row.signalDate)) {
    const ma = parseMaRuleId(row.ruleId);
    const isValuation = row.ruleId === RULE_IDS.peVsSector || row.ruleId === RULE_IDS.pbVsSector;
    const isGrowth = row.ruleId === RULE_IDS.earningsGrowth;
    if (ma !== null || isValuation) {
      const from = ma !== null ? (snap.maWindow?.fromDate ?? subtractTradingDays(row.signalDate, ma - 1, ctx.holidays)) : row.signalDate;
      const gaps = relevantGaps(ctx.priceGaps, row.symbol, from, row.signalDate);
      if (gaps.length > 0) causes.push(gapCause('price_gap_open', gaps));
    }
    if (isValuation || isGrowth) {
      const w = financialsWindow(row, snap, ctx);
      const bounds = { from: Date.parse(quarterBounds(w.from).fromTs), to: Date.parse(quarterBounds(w.to).toTs) };
      const gaps = ctx.financialsGaps.filter((g) => (g.symbol === row.symbol || g.symbol === null) && gapOverlaps(g, bounds));
      if (gaps.length > 0) causes.push(gapCause('financials_gap_open', gaps));
    }
  }

  if (row.ruleVersion !== RULE_VERSION) causes.push({ code: 'rule_version_outdated' });
  if (!snap.ok || !isValidDate(row.signalDate)) causes.push({ code: 'snapshot_invalid' });

  if (causes.length > 0) return { state: 'hidden', causes };
  if (row.status === 'suppressed') return { state: 'suppressed', reasons: row.reasonCodes };
  return { state: 'ok' };
}

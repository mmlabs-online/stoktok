import type { FinancialsSanity } from './config';
import { periodOf } from './quarters';

export type FinancialUnit = 'VND' | 'BILLION_VND';

/** A quarter as a source returned it: nothing is trusted yet. */
export interface RawQuarterlyFinancials {
  year: unknown;
  quarter: unknown;
  eps: unknown;
  bvps: unknown;
  revenue: unknown;
  netIncome: unknown;
}

/** Integer VND (R2). eps and bvps are VND per share; revenue and netIncome are VND. */
export interface QuarterlyFinancials {
  symbol: string;
  period: string;
  eps: number;
  bvps: number;
  revenue: number;
  netIncome: number;
}

export type NormalizeFinancialsResult =
  | { ok: true; value: QuarterlyFinancials }
  | { ok: false; reason: string; period?: string };

/**
 * The only financial-amount conversion (R2): finite number -> integer VND, rounded half away from zero
 * (same direction as money.ts roundDiv). null when the result is not a safe integer.
 */
export function toVndAmount(value: unknown, unit: FinancialUnit): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = unit === 'BILLION_VND' ? value * 1e9 : value;
  const r = Math.sign(n) * Math.round(Math.abs(n));
  if (!Number.isSafeInteger(r)) return null;
  return r === 0 ? 0 : r;
}

/** Validates and converts one quarter. Never throws. All four values must be valid or the whole period is rejected. */
export function normalizeQuarterlyFinancials(
  symbol: string,
  raw: RawQuarterlyFinancials,
  units: { perShare: FinancialUnit; totals: FinancialUnit },
  sanity: FinancialsSanity,
): NormalizeFinancialsResult {
  const period = periodOf(raw.year, raw.quarter);
  if (period === null) return { ok: false, reason: 'invalid_period' };
  const fail = (reason: string): NormalizeFinancialsResult => ({ ok: false, reason, period });

  const fields = [
    ['eps', raw.eps, units.perShare],
    ['bvps', raw.bvps, units.perShare],
    ['revenue', raw.revenue, units.totals],
    ['net_income', raw.netIncome, units.totals],
  ] as const;
  const v: Record<string, number> = {};
  for (const [name, value, unit] of fields) {
    if (value === undefined || value === null) return fail(`missing_${name}`);
    const n = toVndAmount(value, unit);
    if (n === null) return fail(`invalid_${name}`);
    v[name] = n;
  }
  const eps = v.eps as number;
  const bvps = v.bvps as number;
  const revenue = v.revenue as number;
  const netIncome = v.net_income as number;

  if (Math.abs(eps) > sanity.maxAbsEpsVnd) return fail('eps_out_of_band');
  if (Math.abs(bvps) < sanity.minAbsBvpsVnd || Math.abs(bvps) > sanity.maxAbsBvpsVnd) return fail('bvps_out_of_band');
  if (revenue < 0) return fail('negative_revenue');
  if (revenue !== 0 && revenue < sanity.minNonZeroRevenueVnd) return fail('revenue_out_of_band');
  if (revenue > sanity.maxAbsTotalVnd) return fail('revenue_out_of_band');
  if (Math.abs(netIncome) > sanity.maxAbsTotalVnd) return fail('net_income_out_of_band');
  return { ok: true, value: { symbol, period, eps, bvps, revenue, netIncome } };
}

const SECTOR_MAX_LENGTH = 100;

/** Trims and collapses whitespace; null for non-strings, empty and over-long labels. */
export function normalizeSectorLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\s+/g, ' ');
  return s === '' || s.length > SECTOR_MAX_LENGTH ? null : s;
}

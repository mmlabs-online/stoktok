import { DEFAULT_FINANCIALS_SANITY, normalizeQuarterlyFinancials, normalizeSectorLabel, normalizeSymbol, parsePeriod, periodOf } from '@stoktok/core';
import type { FinancialUnit, FinancialsSanity } from '@stoktok/core';
import { FINANCIALS_SYNC_CONFIG, TCBS_CONFIG } from '../config';
import type { FinancialsSource, QuarterlyResult, RejectedPeriod } from './financials-source';
import { getJson } from './http';
import type { GetJsonOptions } from './http';
import { SourceError } from './price-source';

/**
 * UNVERIFIED (sandbox cannot reach VN hosts; see docs/adr/0002-financials-source.md): per-share values in VND
 * and totals in billions of VND follow a recalled response shape. If wrong, core normalizeQuarterlyFinancials
 * rejects the periods (unit guards) instead of storing them.
 */
export const TCBS_FINANCIALS_UNITS: { perShare: FinancialUnit; totals: FinancialUnit } = {
  perShare: 'VND',
  totals: 'BILLION_VND',
};

export interface TcbsFinancialsOptions {
  fetchImpl: typeof fetch;
  http: Omit<GetJsonOptions, 'userAgent'>;
  baseUrl?: string;
  userAgent?: string;
  sanity?: FinancialsSanity;
  maxPeriodsPerResponse?: number;
  /** Pause between the two quarterly requests. */
  requestDelayMs?: number;
}

type Row = Record<string, unknown>;

export class TcbsFinancialsSource implements FinancialsSource {
  readonly name = 'tcbs-public';

  constructor(private readonly o: TcbsFinancialsOptions) {}

  url(symbol: string, endpoint: 'financialratio' | 'incomestatement' | 'overview'): string {
    const base = `${this.o.baseUrl ?? TCBS_CONFIG.baseUrl}/tcanalysis/v1`;
    const s = encodeURIComponent(symbol);
    return endpoint === 'overview' ? `${base}/ticker/${s}/overview` : `${base}/finance/${s}/${endpoint}?yearly=0&isAll=true`;
  }

  private get(url: string): Promise<unknown> {
    return getJson(this.o.fetchImpl, url, { ...this.o.http, userAgent: this.o.userAgent ?? TCBS_CONFIG.financialsUserAgent });
  }

  /** A 404 means no data (ETFs, fund certificates), not a failure. */
  private async getOrNotFound(url: string): Promise<unknown> {
    try {
      return await this.get(url);
    } catch (e) {
      if (e instanceof SourceError && e.status === 404) return null;
      throw e;
    }
  }

  async fetchQuarterly(symbol: string): Promise<QuarterlyResult> {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new SourceError('invalid symbol', false);
    const ratio = this.parse(sym, await this.getOrNotFound(this.url(sym, 'financialratio')));
    await this.o.http.sleep(this.o.requestDelayMs ?? FINANCIALS_SYNC_CONFIG.requestDelayMs);
    const income = this.parse(sym, await this.getOrNotFound(this.url(sym, 'incomestatement')));

    const rejected: RejectedPeriod[] = [...ratio.rejected, ...income.rejected];
    const dupes = new Set([...ratio.dupes, ...income.dupes]);
    const keys = new Set([...ratio.rows.keys(), ...income.rows.keys()]);
    const periods: QuarterlyResult['periods'] = [];
    const sanity = this.o.sanity ?? DEFAULT_FINANCIALS_SANITY;
    for (const period of [...keys].filter((k) => !dupes.has(k)).sort()) {
      const { year, quarter } = parsePeriod(period) as { year: number; quarter: number };
      const r = ratio.rows.get(period);
      const i = income.rows.get(period);
      const res = normalizeQuarterlyFinancials(
        sym,
        { year, quarter, eps: r?.earningPerShare, bvps: r?.bookValuePerShare, revenue: i?.revenue, netIncome: i?.shareHolderIncome },
        TCBS_FINANCIALS_UNITS,
        sanity,
      );
      if (res.ok) periods.push(res.value);
      else rejected.push({ ...(res.period !== undefined ? { period: res.period } : {}), reason: res.reason });
    }
    return { periods, rejected };
  }

  /** Rows by period for one endpoint. A duplicated period is dropped and reported (ambiguous, never picked). */
  private parse(symbol: string, body: unknown) {
    const rows = new Map<string, Row>();
    const dupes = new Set<string>();
    const rejected: RejectedPeriod[] = [];
    if (body === null || body === undefined) return { rows, dupes, rejected };
    if (!Array.isArray(body)) throw new SourceError('unexpected response shape: body is not an array', false);
    if (body.length > (this.o.maxPeriodsPerResponse ?? FINANCIALS_SYNC_CONFIG.maxPeriodsPerResponse)) {
      throw new SourceError('response has too many periods', false);
    }
    for (const item of body as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        rejected.push({ reason: 'invalid_row' });
        continue;
      }
      const row = item as Row;
      if (row.ticker !== undefined && row.ticker !== symbol) {
        rejected.push({ reason: 'ticker_mismatch' });
        continue;
      }
      const period = periodOf(row.year, row.quarter);
      if (period === null) {
        rejected.push({ reason: 'invalid_period' });
        continue;
      }
      if (dupes.has(period)) continue;
      if (rows.has(period)) {
        rows.delete(period);
        dupes.add(period);
        rejected.push({ period, reason: 'duplicate_period' });
        continue;
      }
      rows.set(period, row);
    }
    return { rows, dupes, rejected };
  }

  async fetchSector(symbol: string): Promise<string | null> {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new SourceError('invalid symbol', false);
    const body = await this.getOrNotFound(this.url(sym, 'overview'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return normalizeSectorLabel((body as Row).industry);
  }
}

import {
  addQuarters,
  DEFAULT_FINANCIALS_SANITY,
  deriveVciIqQuarter,
  normalizeQuarterlyFinancials,
  normalizeSectorLabel,
  normalizeSymbol,
  periodOf,
  toVndAmount,
} from '@stoktok/core';
import type { EpsBasis, FinancialUnit, FinancialsSanity } from '@stoktok/core';
import { FINANCIALS_SYNC_CONFIG, VCI_IQ_CONFIG } from '../config';
import type { FinancialsSource, QuarterlyResult, RejectedPeriod } from './financials-source';
import { getJson } from './http';
import type { GetJsonOptions } from './http';
import { SourceError } from './price-source';

/**
 * Recorded 2026-11-01 (work/tickets/STK-039/live-samples): statement amounts are full VND. EPS and BVPS are derived
 * in core (ADR 0005) in VND per share. A wrong unit is rejected by the core unit guards, never stored.
 */
export const VCI_IQ_FINANCIALS_UNITS: { perShare: FinancialUnit; totals: FinancialUnit } = {
  perShare: 'VND',
  totals: 'VND',
};

export const VCI_IQ_FINANCIALS_SOURCE_NAME = 'vci-iq';

/** ADR 0005 decision 2: stays 'unverified' (P/E suppressed) until the live dry-run shows derived EPS within 3% of VietCap's own. */
export const VCI_IQ_FINANCIALS_EPS_BASIS: EpsBasis = 'unverified';

/** Per-type statement line codes. A renamed code makes periods rejected, never wrong. `minorityInterests: null` means the layout has no such line (treated as 0). */
export interface VciIqTypeFields {
  revenue: string;
  parentNetIncome: string;
  ownersEquity: string;
  minorityInterests: string | null;
}

/**
 * Field codes per `comTypeCode` (from /financial-statement/metrics, recorded 2026-11-04, work/tickets/STK-042/live-samples).
 * The only place these codes live; ADR 0005 carries the same table.
 */
export const VCI_IQ_FIELDS_BY_COMPANY_TYPE: Readonly<Record<string, VciIqTypeFields>> = {
  // Industrial/commercial (STK-039). isa3 "Doanh thu thuần", isa22 parent net income, bsa78 equity incl. minority, bsa210 minority.
  CT: { revenue: 'isa3', parentNetIncome: 'isa22', ownersEquity: 'bsa78', minorityInterests: 'bsa210' },
  // Banks. isb38 "Tổng thu nhập hoạt động", isa22 "Cổ đông của Công ty mẹ", bsa78 "VỐN CHỦ SỞ HỮU" (includes minority), bsa210 "Lợi ích của cổ đông thiểu số".
  NH: { revenue: 'isb38', parentNetIncome: 'isa22', ownersEquity: 'bsa78', minorityInterests: 'bsa210' },
  // Securities firms. isa1 "DOANH THU HOẠT ĐỘNG", isa22 "Lợi nhuận sau thuế phân bổ cho chủ sở hữu", bsa78 "Vốn chủ sở hữu", bsa210 "Lợi ích cổ đông không kiểm soát" (0 in samples).
  CK: { revenue: 'isa1', parentNetIncome: 'isa22', ownersEquity: 'bsa78', minorityInterests: 'bsa210' },
  // Insurers. isi64 "Doanh thu thuần từ hoạt động kinh doanh bảo hiểm", isa22 "Lợi nhuận sau thuế của chủ sở hữu, tập đoàn", bsa78 "Vốn chủ sở hữu", bsa210 "Lợi ích cổ đông thiểu số" (0 in samples).
  BH: { revenue: 'isi64', parentNetIncome: 'isa22', ownersEquity: 'bsa78', minorityInterests: 'bsa210' },
};

/** Codes shared by every company type. */
export const VCI_IQ_COMMON_FIELDS = {
  shares: 'numberOfSharesMktCap',
  companyType: 'comTypeCode',
  sector: 'sectorVn',
} as const;

/** The field set for a company type, or null when the type is unknown, not mapped, or not in `supported` (R5). */
export function resolveVciIqFields(comTypeCode: unknown, supported: readonly string[]): VciIqTypeFields | null {
  if (typeof comTypeCode !== 'string' || !supported.includes(comTypeCode)) return null;
  return Object.hasOwn(VCI_IQ_FIELDS_BY_COMPANY_TYPE, comTypeCode) ? (VCI_IQ_FIELDS_BY_COMPANY_TYPE[comTypeCode] ?? null) : null;
}

export interface VciIqFinancialsOptions {
  fetchImpl: typeof fetch;
  http: Omit<GetJsonOptions, 'userAgent'>;
  baseUrl?: string;
  userAgent?: string;
  sanity?: FinancialsSanity;
  /** Overrides `VCI_IQ_CONFIG.supportedCompanyTypes`. */
  supportedCompanyTypes?: readonly string[];
  maxPeriodsPerResponse?: number;
  /** Latest quarters emitted (older history is dropped silently). */
  maxQuarters?: number;
  /** Pause between requests. */
  requestDelayMs?: number;
}

type Row = Record<string, unknown>;
interface Parsed {
  rows: Map<string, Row>;
  dupes: Set<string>;
  rejected: RejectedPeriod[];
}

export class VciIqFinancialsSource implements FinancialsSource {
  readonly name = VCI_IQ_FINANCIALS_SOURCE_NAME;
  private details = new Map<string, Promise<Row | null>>();

  constructor(private readonly o: VciIqFinancialsOptions) {}

  url(symbol: string, endpoint: 'statistics' | 'income' | 'balance' | 'details'): string {
    const base = this.o.baseUrl ?? VCI_IQ_CONFIG.baseUrl;
    const s = encodeURIComponent(symbol);
    switch (endpoint) {
      case 'statistics':
        return `${base}/${s}/statistics-financial`;
      case 'income':
        return `${base}/${s}/financial-statement?section=INCOME_STATEMENT`;
      case 'balance':
        return `${base}/${s}/financial-statement?section=BALANCE_SHEET`;
      case 'details':
        return `${base}/details?ticker=${s}`;
    }
  }

  /** A 404 means no data (ETFs, fund certificates), not a failure. A 403 is never bypassed. */
  private async get(url: string): Promise<unknown> {
    try {
      return await getJson(this.o.fetchImpl, url, { ...this.o.http, userAgent: this.o.userAgent ?? VCI_IQ_CONFIG.userAgent });
    } catch (e) {
      if (e instanceof SourceError && e.status === 404) return null;
      if (e instanceof SourceError && e.status === 403) {
        throw new SourceError('blocked by source (HTTP 403); no bypass, see ADR 0005', false, 403);
      }
      throw e;
    }
  }

  private pause(): Promise<void> {
    return this.o.http.sleep(this.o.requestDelayMs ?? FINANCIALS_SYNC_CONFIG.requestDelayMs);
  }

  private unwrap(body: unknown): unknown {
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Row).data : undefined;
  }

  /** Company details, fetched at most once per symbol per instance. */
  private loadDetails(symbol: string): Promise<Row | null> {
    let p = this.details.get(symbol);
    if (!p) {
      p = this.get(this.url(symbol, 'details')).then((body) => {
        const data = this.unwrap(body);
        return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Row) : null;
      });
      p.catch(() => this.details.delete(symbol));
      this.details.set(symbol, p);
    }
    return p;
  }

  async fetchQuarterly(symbol: string): Promise<QuarterlyResult> {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new SourceError('invalid symbol', false);
    const stats = this.parse(sym, this.unwrap(await this.get(this.url(sym, 'statistics'))), 'stats');
    await this.pause();
    const income = this.parse(sym, this.statementQuarters(await this.get(this.url(sym, 'income'))), 'statement');
    await this.pause();
    const balance = this.parse(sym, this.statementQuarters(await this.get(this.url(sym, 'balance'))), 'statement');

    const rejected: RejectedPeriod[] = [...stats.rejected, ...income.rejected, ...balance.rejected];
    const dupes = new Set([...stats.dupes, ...income.dupes, ...balance.dupes]);
    const allKeys = [...new Set([...stats.rows.keys(), ...income.rows.keys(), ...balance.rows.keys()])].filter((k) => !dupes.has(k)).sort();
    const latest = allKeys[allKeys.length - 1];
    const oldest = latest === undefined ? '' : addQuarters(latest, -((this.o.maxQuarters ?? FINANCIALS_SYNC_CONFIG.vciIqMaxQuarters) - 1));
    const keys = allKeys.filter((k) => k >= oldest);
    const periods: QuarterlyResult['periods'] = [];
    if (keys.length === 0) return { periods, rejected };

    await this.pause();
    const details = await this.loadDetails(sym);
    const f = resolveVciIqFields(details?.[VCI_IQ_COMMON_FIELDS.companyType], this.o.supportedCompanyTypes ?? VCI_IQ_CONFIG.supportedCompanyTypes);
    if (f === null) {
      for (const period of keys) rejected.push({ period, reason: 'unsupported_company_type' });
      return { periods, rejected };
    }

    const netIncomeByPeriod = new Map<string, number>();
    for (const [period, row] of income.rows) {
      const n = toVndAmount(row[f.parentNetIncome], VCI_IQ_FINANCIALS_UNITS.totals);
      if (n !== null) netIncomeByPeriod.set(period, n);
    }
    const amount = (row: Row | undefined, field: string): number | undefined => {
      const n = toVndAmount(row?.[field], VCI_IQ_FINANCIALS_UNITS.totals);
      return n === null ? undefined : n;
    };
    const sanity = { ...(this.o.sanity ?? DEFAULT_FINANCIALS_SANITY), rejectZeroRevenue: true };
    for (const period of keys) {
      const year = Number(period.slice(0, 4));
      const quarter = Number(period.slice(5));
      const i = income.rows.get(period);
      const b = balance.rows.get(period);
      const d = deriveVciIqQuarter({
        period,
        netIncomeByPeriod,
        equity: amount(b, f.ownersEquity),
        minority: f.minorityInterests === null ? 0 : amount(b, f.minorityInterests),
        shares: stats.rows.get(period)?.[VCI_IQ_COMMON_FIELDS.shares],
      });
      if (d.reason !== undefined) {
        rejected.push({ period, reason: d.reason });
        continue;
      }
      const res = normalizeQuarterlyFinancials(
        sym,
        { year, quarter, eps: d.eps, bvps: d.bvps, revenue: i?.[f.revenue], netIncome: i?.[f.parentNetIncome] },
        VCI_IQ_FINANCIALS_UNITS,
        sanity,
      );
      if (res.ok) periods.push(res.value);
      else rejected.push({ ...(res.period !== undefined ? { period: res.period } : {}), reason: res.reason });
    }
    return { periods, rejected };
  }

  /** The quarterly rows of a financial-statement response; `data.years` is ignored. */
  private statementQuarters(body: unknown): unknown {
    const data = this.unwrap(body);
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object' || Array.isArray(data)) throw new SourceError('unexpected response shape: data is not an object', false);
    return (data as Row).quarters;
  }

  /**
   * Rows by period for one endpoint. Year rows (quarter or lengthReport 5) are skipped silently. A duplicated
   * period is dropped and reported (ambiguous, never picked).
   */
  private parse(symbol: string, list: unknown, kind: 'stats' | 'statement'): Parsed {
    const rows = new Map<string, Row>();
    const dupes = new Set<string>();
    const rejected: RejectedPeriod[] = [];
    if (list === null || list === undefined) return { rows, dupes, rejected };
    if (!Array.isArray(list)) throw new SourceError('unexpected response shape: rows are not an array', false);
    if (list.length > (this.o.maxPeriodsPerResponse ?? FINANCIALS_SYNC_CONFIG.maxPeriodsPerResponse)) {
      throw new SourceError('response has too many periods', false);
    }
    for (const item of list as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        rejected.push({ reason: 'invalid_row' });
        continue;
      }
      const row = item as Row;
      if (row.ticker !== undefined && row.ticker !== null && row.ticker !== symbol) {
        rejected.push({ reason: 'ticker_mismatch' });
        continue;
      }
      const q = kind === 'stats' ? row.quarter : row.lengthReport;
      if (q === 5) continue;
      const period = periodOf(row.yearReport, q);
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
    const details = await this.loadDetails(sym);
    return normalizeSectorLabel(details?.[VCI_IQ_COMMON_FIELDS.sector]);
  }
}

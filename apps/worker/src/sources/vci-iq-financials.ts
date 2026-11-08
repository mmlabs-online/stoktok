import {
  addQuarters,
  assertFieldMap,
  DEFAULT_FINANCIALS_SANITY,
  DEFAULT_STATEMENT_LINES_SANITY,
  deriveVciIqQuarter,
  normalizeQuarterlyFinancials,
  normalizeSectorLabel,
  normalizeStatementLines,
  normalizeSymbol,
  periodOf,
  STATEMENT_LINES,
  toVndAmount,
} from '@stoktok/core';
import type { EpsBasis, FinancialUnit, FinancialsSanity, StatementFieldMap, StatementLine, StatementLinesSanity } from '@stoktok/core';
import { FINANCIAL_STATEMENTS_SYNC_CONFIG, FINANCIALS_SYNC_CONFIG, VCI_IQ_CONFIG } from '../config';
import type { FinancialsSource, FinancialStatementsSource, QuarterlyResult, RejectedPeriod, StatementPeriod, StatementsResult } from './financials-source';
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

/**
 * Statement line codes per `comTypeCode` (ADR 0007), checked against the recorded /metrics dictionaries
 * (work/tickets/STK-039|042/live-samples). `null` = the line does not apply to the type: no row and no gap.
 * Not guessed: VND (CK) `isa16` is listed twice in its dictionary (profit before tax and tax expense), so it stays null.
 */
export const VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE: Readonly<Record<'CT' | 'NH' | 'CK' | 'BH', StatementFieldMap>> = {
  CT: {
    revenue: 'isa3', gross_profit: 'isa5', operating_profit: 'isa11', profit_before_tax: 'isa16', net_income_parent: 'isa22',
    total_assets: 'bsa53', total_liabilities: 'bsa54', equity_total: 'bsa78', minority_interests: 'bsa210',
    cash_and_equivalents: 'bsa2', short_term_borrowings: 'bsa56', long_term_borrowings: 'bsa71',
  },
  // bsa2 is "Cash and precious metals" for banks, not comparable: not applicable.
  NH: {
    revenue: 'isb38', gross_profit: null, operating_profit: null, profit_before_tax: 'isa16', net_income_parent: 'isa22',
    total_assets: 'bsa53', total_liabilities: 'bsa54', equity_total: 'bsa78', minority_interests: 'bsa210',
    cash_and_equivalents: null, short_term_borrowings: null, long_term_borrowings: null,
  },
  CK: {
    revenue: 'isa1', gross_profit: null, operating_profit: null, profit_before_tax: null, net_income_parent: 'isa22',
    total_assets: 'bsa53', total_liabilities: 'bsa54', equity_total: 'bsa78', minority_interests: 'bsa210',
    cash_and_equivalents: 'bsa2', short_term_borrowings: null, long_term_borrowings: null,
  },
  BH: {
    revenue: 'isi64', gross_profit: null, operating_profit: null, profit_before_tax: 'isa16', net_income_parent: 'isa22',
    total_assets: 'bsa53', total_liabilities: 'bsa54', equity_total: 'bsa78', minority_interests: 'bsa210',
    cash_and_equivalents: 'bsa2', short_term_borrowings: null, long_term_borrowings: null,
  },
};
for (const map of Object.values(VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE)) assertFieldMap(map);

/** The statement field map for a company type, or null when the type is unknown, not mapped, or not in `supported` (R5). */
export function resolveVciIqStatementFields(comTypeCode: unknown, supported: readonly string[]): StatementFieldMap | null {
  if (typeof comTypeCode !== 'string' || !supported.includes(comTypeCode)) return null;
  return Object.hasOwn(VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE, comTypeCode)
    ? ((VCI_IQ_STATEMENT_FIELDS_BY_COMPANY_TYPE as Record<string, StatementFieldMap>)[comTypeCode] ?? null)
    : null;
}

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
  /** Latest years emitted by `fetchStatements`. */
  maxYears?: number;
  statementSanity?: StatementLinesSanity;
  /** Pause between requests. */
  requestDelayMs?: number;
}

type Row = Record<string, unknown>;
interface Parsed {
  rows: Map<string, Row>;
  dupes: Set<string>;
  rejected: RejectedPeriod[];
}

export class VciIqFinancialsSource implements FinancialsSource, FinancialStatementsSource {
  readonly name = VCI_IQ_FINANCIALS_SOURCE_NAME;
  /** Response bodies by symbol and endpoint, so `fetchQuarterly` and `fetchStatements` share one GET each. */
  private bodies = new Map<string, Promise<unknown>>();

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

  /** Income, balance and details responses, fetched at most once per symbol per instance. A failure is not cached. */
  private load(symbol: string, endpoint: 'income' | 'balance' | 'details'): Promise<unknown> {
    const key = `${symbol}|${endpoint}`;
    let p = this.bodies.get(key);
    if (!p) {
      p = this.get(this.url(symbol, endpoint));
      p.catch(() => this.bodies.delete(key));
      this.bodies.set(key, p);
    }
    return p;
  }

  private async loadDetails(symbol: string): Promise<Row | null> {
    const data = this.unwrap(await this.load(symbol, 'details'));
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Row) : null;
  }

  async fetchQuarterly(symbol: string): Promise<QuarterlyResult> {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new SourceError('invalid symbol', false);
    const stats = this.parse(sym, this.unwrap(await this.get(this.url(sym, 'statistics'))), 'stats');
    await this.pause();
    const income = this.parse(sym, this.statementRows(await this.load(sym, 'income'), 'quarters'), 'statement');
    await this.pause();
    const balance = this.parse(sym, this.statementRows(await this.load(sym, 'balance'), 'quarters'), 'statement');

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

  /** The `quarters` or `years` rows of a financial-statement response. */
  private statementRows(body: unknown, key: 'quarters' | 'years'): unknown {
    const data = this.unwrap(body);
    if (data === null || data === undefined) return data;
    if (typeof data !== 'object' || Array.isArray(data)) throw new SourceError('unexpected response shape: data is not an object', false);
    return (data as Row)[key];
  }

  /** Income and balance lines for the latest quarters and years (ADR 0007). Annual rows are taken as published, never summed. */
  async fetchStatements(symbol: string): Promise<StatementsResult> {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new SourceError('invalid symbol', false);
    let gets = 0;
    // Pause only before a real GET that follows another one; a shared, already-loaded response costs nothing.
    const body = async (endpoint: 'income' | 'balance' | 'details') => {
      if (!this.bodies.has(`${sym}|${endpoint}`) && gets++ > 0) await this.pause();
      return this.load(sym, endpoint);
    };
    const incomeBody = await body('income');
    const balanceBody = await body('balance');
    const iq = this.parse(sym, this.statementRows(incomeBody, 'quarters'), 'statement');
    const bq = this.parse(sym, this.statementRows(balanceBody, 'quarters'), 'statement');
    const iy = this.parse(sym, this.statementRows(incomeBody, 'years'), 'years');
    const by = this.parse(sym, this.statementRows(balanceBody, 'years'), 'years');
    const rejected: RejectedPeriod[] = [...iq.rejected, ...bq.rejected, ...iy.rejected, ...by.rejected];

    const labels = (a: Parsed, b: Parsed) => {
      const dupes = new Set([...a.dupes, ...b.dupes]);
      return [...new Set([...a.rows.keys(), ...b.rows.keys()])].filter((k) => !dupes.has(k)).sort();
    };
    const allQuarters = labels(iq, bq);
    const latest = allQuarters[allQuarters.length - 1];
    const oldest = latest === undefined ? '' : addQuarters(latest, -((this.o.maxQuarters ?? FINANCIAL_STATEMENTS_SYNC_CONFIG.maxQuarters) - 1));
    const quarters = allQuarters.filter((k) => k >= oldest);
    const years = labels(iy, by).slice(-(this.o.maxYears ?? FINANCIAL_STATEMENTS_SYNC_CONFIG.maxYears));
    if (quarters.length === 0 && years.length === 0) return { companyType: null, expectedLines: [], periods: [], rejected };

    await body('details');
    const details = await this.loadDetails(sym);
    const comType = details?.[VCI_IQ_COMMON_FIELDS.companyType];
    const companyType = typeof comType === 'string' ? comType : null;
    const map = resolveVciIqStatementFields(comType, this.o.supportedCompanyTypes ?? VCI_IQ_CONFIG.supportedCompanyTypes);
    if (map === null) {
      for (const period of [...quarters, ...years]) rejected.push({ period, reason: 'unsupported_company_type' });
      return { companyType, expectedLines: [], periods: [], rejected };
    }

    const sanity = this.o.statementSanity ?? DEFAULT_STATEMENT_LINES_SANITY;
    const periods: StatementPeriod[] = [];
    const build = (periodKind: 'quarter' | 'year', list: string[], i: Parsed, b: Parsed) => {
      for (const period of list) {
        const n = normalizeStatementLines({ ...i.rows.get(period), ...b.rows.get(period) }, map, VCI_IQ_FINANCIALS_UNITS.totals, sanity);
        for (const r of n.rejected) rejected.push({ period, reason: `${r.line}_${r.reason}` });
        periods.push({ periodKind, period, values: n.values, missing: n.missing });
      }
    };
    build('quarter', quarters, iq, bq);
    build('year', years, iy, by);
    const expectedLines = (Object.keys(STATEMENT_LINES) as StatementLine[]).filter((l) => map[l] !== null);
    return { companyType, expectedLines, periods, rejected };
  }

  /**
   * Rows by period for one endpoint. In quarter mode, year rows (quarter or lengthReport 5) are skipped silently. A duplicated
   * period is dropped and reported (ambiguous, never picked).
   */
  private parse(symbol: string, list: unknown, kind: 'stats' | 'statement' | 'years'): Parsed {
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
      let period: string | null;
      if (kind === 'years') {
        // Annual rows only (lengthReport 5); the label is the year, validated like a quarter label's year.
        period = q === 5 && periodOf(row.yearReport, 1) !== null ? String(row.yearReport) : null;
      } else {
        if (q === 5) continue;
        period = periodOf(row.yearReport, q);
      }
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

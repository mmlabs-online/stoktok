import { isValidDate } from '../calendar';
import type { StatementLinesSanity } from './config';
import { toVndAmount } from './financials';
import type { FinancialUnit } from './financials';
import type { OpenGap } from './quarters';

export type StatementName = 'income' | 'balance' | 'cashflow';

interface LineDef {
  statement: StatementName;
  /** A negative value is a unit or mapping error (assets, liabilities, cash, borrowings, minority). */
  nonNegative: boolean;
  /** The source publishes a placeholder 0 for "no data" on this line (R4: never stored as 0). */
  zeroIsMissing: boolean;
}

const def = (statement: StatementName, nonNegative: boolean, zeroIsMissing: boolean): LineDef => ({ statement, nonNegative, zeroIsMissing });

/**
 * The only registry of stored statement lines (ADR 0007). `operating_profit` is the VAS operating result, not EBIT.
 * Names match the database check `^[a-z][a-z0-9_]{1,63}$`.
 */
export const STATEMENT_LINES = {
  revenue: def('income', false, true),
  gross_profit: def('income', false, false),
  operating_profit: def('income', false, false),
  profit_before_tax: def('income', false, false),
  net_income_parent: def('income', false, false),
  total_assets: def('balance', true, true),
  total_liabilities: def('balance', true, false),
  equity_total: def('balance', false, true),
  minority_interests: def('balance', true, false),
  cash_and_equivalents: def('balance', true, false),
  short_term_borrowings: def('balance', true, false),
  long_term_borrowings: def('balance', true, false),
} as const satisfies Record<string, LineDef>;

export type StatementLine = keyof typeof STATEMENT_LINES;

/** Source field code per line for one company type; null = the line does not apply to that type (not a gap). */
export type StatementFieldMap = Readonly<Record<StatementLine, string | null>>;

/** `data_gaps.data_type` of a quarter missing any mapped line; separate from 'financials' so signals are unaffected. */
export const FINANCIAL_LINES_GAP_TYPE = 'financial_lines';
/** `data_gaps.data_type` of a year missing any mapped line. */
export const FINANCIAL_LINES_ANNUAL_GAP_TYPE = 'financial_lines_annual';

const isLine = (name: string): name is StatementLine => Object.hasOwn(STATEMENT_LINES, name);

/** Throws when the map has a name outside the registry or lacks a registry line. Run once per map at definition time. */
export function assertFieldMap(map: Readonly<Record<string, string | null>>): void {
  for (const name of Object.keys(map)) {
    if (!isLine(name)) throw new RangeError(`unknown statement line: ${name}`);
  }
  for (const name of Object.keys(STATEMENT_LINES)) {
    if (!Object.hasOwn(map, name)) throw new RangeError(`field map lacks line: ${name}`);
  }
}

export interface NormalizedStatementLines {
  /** Integer VND (R2), only valid lines. */
  values: { line: StatementLine; statement: StatementName; value: number }[];
  /** Mapped lines with no usable value in the row (R4: no row, a gap). */
  missing: StatementLine[];
  rejected: { line: StatementLine; reason: 'out_of_band' }[];
}

/** One period of one symbol. Pure, never throws. The only conversion is `toVndAmount` (R2). */
export function normalizeStatementLines(
  row: Readonly<Record<string, unknown>>,
  fieldMap: StatementFieldMap,
  unit: FinancialUnit,
  sanity: StatementLinesSanity,
): NormalizedStatementLines {
  const out: NormalizedStatementLines = { values: [], missing: [], rejected: [] };
  for (const line of Object.keys(STATEMENT_LINES) as StatementLine[]) {
    const code = fieldMap[line];
    if (code === null) continue;
    const raw = row[code];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      out.missing.push(line);
      continue;
    }
    const d = STATEMENT_LINES[line];
    const value = toVndAmount(raw, unit);
    if (value === null || Math.abs(value) > sanity.maxAbsTotalVnd || (d.nonNegative && value < 0)) {
      out.rejected.push({ line, reason: 'out_of_band' });
    } else if (value === 0 && d.zeroIsMissing) {
      out.missing.push(line);
    } else {
      out.values.push({ line, statement: d.statement, value });
    }
  }
  return out;
}

const YEAR_RE = /^\d{4}$/;
const DAY_MS = 86_400_000;

function mustYear(period: string): number {
  if (!YEAR_RE.test(period)) throw new RangeError(`invalid year: ${period}`);
  return Number(period);
}

/** First instant and last whole second of the year in Asia/Ho_Chi_Minh (+07:00, no DST), as ISO UTC strings. */
export function yearBounds(period: string): { fromTs: string; toTs: string } {
  const y = mustYear(period);
  return {
    fromTs: new Date(`${y}-01-01T00:00:00+07:00`).toISOString(),
    toTs: new Date(`${y}-12-31T23:59:59+07:00`).toISOString(),
  };
}

/** Newest year whose last day plus `annualPublishLagDays` is on or before `todayVn` ('YYYY-MM-DD'). */
export function latestExpectedYear(todayVn: string, annualPublishLagDays: number): string {
  if (!isValidDate(todayVn)) throw new RangeError(`invalid date: ${todayVn}`);
  const today = Date.parse(`${todayVn}T00:00:00Z`);
  let y = Number(todayVn.slice(0, 4));
  for (let i = 0; i < 3; i++, y--) {
    if (Date.parse(`${y}-12-31T00:00:00Z`) + annualPublishLagDays * DAY_MS <= today) return String(y);
  }
  return String(y);
}

export interface AnnualGapPlan {
  /** Years to insert as new gaps. */
  toRecord: string[];
  /** Ids of open gaps whose year is now present. */
  toResolve: number[];
}

/** Missing years from the symbol's first known year (or windowStart) to windowEnd; a symbol with no known year expects nothing. */
export function planAnnualGaps(input: {
  windowStart: string;
  windowEnd: string;
  knownPeriods: readonly string[];
  presentPeriods: readonly string[];
  openGaps: readonly OpenGap[];
}): AnnualGapPlan {
  const present = new Set(input.presentPeriods);
  const matches = (g: OpenGap, year: string) => {
    const b = yearBounds(year);
    return Date.parse(g.fromTs) === Date.parse(b.fromTs) && Date.parse(g.toTs) === Date.parse(b.toTs);
  };
  const toResolve = input.openGaps.filter((g) => [...present].some((y) => matches(g, y))).map((g) => g.id);

  const toRecord: string[] = [];
  if (input.knownPeriods.length > 0) {
    const first = Math.min(...input.knownPeriods.map(mustYear));
    for (let y = Math.max(first, mustYear(input.windowStart)); y <= mustYear(input.windowEnd); y++) {
      const year = String(y);
      if (!present.has(year) && !input.openGaps.some((g) => matches(g, year))) toRecord.push(year);
    }
  }
  return { toRecord, toResolve };
}

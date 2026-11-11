/** Per-pool type parsers (never the global pg.types). Server-only (R3). */
import pg from 'pg';

const TS_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)([+-]\d{2})(:\d{2})?$/;

/** '2026-11-10 08:00:00+00' -> '2026-11-10T08:00:00+00:00' (PostgREST shape under TimeZone=UTC). Anything else is returned unchanged. */
export function normalizeTimestamptz(raw: string): string {
  const m = TS_RE.exec(raw);
  if (!m) return raw;
  return `${m[1]}T${m[2]}${m[3]}${m[4] ?? ':00'}`;
}

/** Parses a one-dimensional Postgres text array literal. NULL elements become null. */
export function parseArray(raw: string, elem: (s: string) => string): (string | null)[] {
  if (raw === '{}') return [];
  if (!raw.startsWith('{') || !raw.endsWith('}')) return [raw];
  const out: (string | null)[] = [];
  const body = raw.slice(1, -1);
  let i = 0;
  while (i <= body.length) {
    if (body[i] === '"') {
      let s = '';
      i++;
      while (i < body.length && body[i] !== '"') {
        if (body[i] === '\\') i++;
        s += body[i];
        i++;
      }
      i++; // closing quote
      out.push(elem(s));
    } else {
      let j = body.indexOf(',', i);
      if (j === -1) j = body.length;
      const s = body.slice(i, j);
      out.push(s === 'NULL' ? null : elem(s));
      i = j;
    }
    if (body[i] !== ',') break;
    i++;
  }
  return out;
}

const DATE = 1082;
const DATE_ARRAY = 1182;
const TIMESTAMPTZ = 1184;
const TIMESTAMPTZ_ARRAY = 1185;

/**
 * DATE and DATE[] stay raw 'YYYY-MM-DD' strings; timestamptz becomes an ISO string. int8 (20) is deliberately not
 * overridden: it stays a digit string so core's toSafeInt does the safe-range check (R2).
 */
export function buildTypeParsers(): pg.CustomTypesConfig {
  return {
    getTypeParser(oid: number, format?: 'text' | 'binary') {
      if (format !== 'binary') {
        if (oid === DATE) return (s: string) => s;
        if (oid === DATE_ARRAY) return (s: string) => parseArray(s, (x) => x);
        if (oid === TIMESTAMPTZ) return normalizeTimestamptz;
        if (oid === TIMESTAMPTZ_ARRAY) return (s: string) => parseArray(s, normalizeTimestamptz);
      }
      return pg.types.getTypeParser(oid, format as 'text');
    },
  } as pg.CustomTypesConfig;
}

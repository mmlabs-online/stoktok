const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const RFC822 =
  /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|GMT|UTC|UT|[+-]\d{2}:?\d{2})$/;

/**
 * RFC 822 / 2822 date (2- or 4-digit year) to UTC ISO. Null when it cannot be read exactly: there is no fallback to
 * "now". The weekday is ignored; a zone is required.
 */
export function parseRssDate(raw: string): string | null {
  const m = RFC822.exec(raw.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf((m[2] as string).slice(0, 3).toLowerCase());
  const yearRaw = m[3] as string;
  const year = yearRaw.length === 2 ? (Number(yearRaw) < 70 ? 2000 : 1900) + Number(yearRaw) : Number(yearRaw);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 0 || day < 1 || hour > 23 || minute > 59 || second > 59 || year < 2000 || year > 2100) return null;
  const zone = m[7] as string;
  let offsetMin = 0;
  if (zone[0] === '+' || zone[0] === '-') {
    const digits = zone.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2));
    if (oh > 14 || om > 59) return null;
    offsetMin = (zone[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const local = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (local.getUTCDate() !== day || local.getUTCMonth() !== month) return null;
  return new Date(local.getTime() - offsetMin * 60_000).toISOString();
}

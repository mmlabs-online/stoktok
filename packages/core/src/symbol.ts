/** Trim + uppercase; returns null unless 3-10 alphanumerics. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9]{3,10}$/.test(s) ? s : null;
}

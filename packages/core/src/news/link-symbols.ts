import type { NewsLinkConfig } from './config';

export interface LinkSymbolsOptions {
  /** Only these tickers can link. */
  candidates: ReadonlySet<string>;
  /** ticker -> company names. An alias links only if its ticker is a candidate. */
  aliases: Readonly<Record<string, readonly string[]>>;
  config: NewsLinkConfig;
}

const TICKER = /(?<![\p{L}\p{N}_\-./])[A-Z0-9]{3,10}(?![\p{L}\p{N}_\-/])/gu;
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Maps each code point to one of equal UTF-16 length, so match offsets stay aligned across the variants. */
function mapSameLength(text: string, fn: (cp: string) => string): string {
  let out = '';
  for (const cp of text) {
    const r = fn(cp);
    out += r.length === cp.length ? r : cp;
  }
  return out;
}
const lower = (s: string) => mapSameLength(s.normalize('NFC'), (cp) => cp.toLowerCase());
const fold = (s: string) =>
  mapSameLength(lower(s), (cp) => (cp === 'đ' ? 'd' : cp.normalize('NFD').replace(/\p{M}/gu, '')));

function hasContext(text: string, start: number, end: number, cfg: NewsLinkConfig): boolean {
  if (text[start - 1] === '(' && text[end] === ')') return true;
  const before = text.slice(Math.max(0, start - 24), start).toLowerCase();
  return cfg.contextPrefixes.some((p) => before.endsWith(p) && !isWordChar(before[before.length - p.length - 1]));
}

interface Hit {
  pos: number;
  symbol: string;
}

function tickerHits(text: string, o: LinkSymbolsOptions): Hit[] {
  const stop = new Set(o.config.stopTokens);
  const ambiguous = new Set(o.config.ambiguousTickers);
  const allCaps = !/\p{Ll}/u.test(text);
  const hits: Hit[] = [];
  for (const m of text.matchAll(TICKER)) {
    const token = m[0];
    if (!o.candidates.has(token) || stop.has(token)) continue;
    const ctx = hasContext(text, m.index, m.index + token.length, o.config);
    if (!ctx && (allCaps || ambiguous.has(token))) continue;
    hits.push({ pos: m.index, symbol: token });
  }
  return hits;
}

function aliasHits(text: string, o: LinkSymbolsOptions): Hit[] {
  const exact = lower(text);
  const folded = fold(text);
  const entries: { alias: string; symbol: string; foldable: boolean }[] = [];
  for (const [symbol, names] of Object.entries(o.aliases)) {
    if (!o.candidates.has(symbol)) continue;
    for (const n of names) entries.push({ alias: lower(n), symbol, foldable: n.length >= o.config.minFoldAliasChars });
  }
  entries.sort((a, b) => b.alias.length - a.alias.length || (a.alias < b.alias ? -1 : 1));
  const claimed: [number, number][] = [];
  const hits: Hit[] = [];
  const scan = (haystack: string, needle: string, symbol: string) => {
    for (let from = haystack.indexOf(needle); from >= 0; from = haystack.indexOf(needle, from + 1)) {
      const end = from + needle.length;
      if (isWordChar(haystack[from - 1]) || isWordChar(haystack[end])) continue;
      if (claimed.some(([a, b]) => from < b && end > a)) continue;
      claimed.push([from, end]);
      hits.push({ pos: from, symbol });
    }
  };
  for (const e of entries) {
    scan(exact, e.alias, e.symbol);
    if (e.foldable) scan(folded, fold(e.alias), e.symbol);
  }
  return hits;
}

/**
 * Tickers named in the texts (title, excerpt, ...), by deterministic rules. Same input, same output: sorted, unique,
 * capped at `config.maxSymbols` (first appearances are kept, then sorted). Never throws; no match is an empty list.
 */
export function linkSymbols(texts: string | readonly string[], o: LinkSymbolsOptions): string[] {
  const list = (typeof texts === 'string' ? [texts] : texts).map((t) => t.normalize('NFC'));
  const ordered: string[] = [];
  for (const text of list) {
    const hits = [...tickerHits(text, o), ...aliasHits(text, o)].sort((a, b) => a.pos - b.pos || (a.symbol < b.symbol ? -1 : 1));
    for (const h of hits) if (!ordered.includes(h.symbol)) ordered.push(h.symbol);
  }
  return ordered.slice(0, o.config.maxSymbols).sort();
}

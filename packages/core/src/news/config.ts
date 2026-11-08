/** R5: symbol-linking rules are configuration. Deterministic matching, no LLM. */
export const NEWS_LINK_CONFIG = {
  /** Upper-case tokens that look like tickers but never are in news text. */
  stopTokens: ['USD', 'EUR', 'GDP', 'CPI', 'PMI', 'IPO', 'ETF', 'FDI', 'ODA', 'EPS', 'ROE', 'ROA', 'VAT', 'WTO', 'FED', 'OPEC', 'VNINDEX', 'VN30', 'HNX30', 'HNX', 'HOSE', 'UPCOM'] as readonly string[],
  /** Real tickers that are also common words: they link only with a context prefix, parentheses or an alias. */
  ambiguousTickers: ['VND', 'GAS', 'CEO', 'TOP'] as readonly string[],
  /** Lower-case text that may precede a ticker as context. */
  contextPrefixes: ['mã ', 'mã cp ', 'mã chứng khoán ', 'cổ phiếu ', 'cp ', 'hose: ', 'hnx: ', 'upcom: ', 'hose:', 'hnx:', 'upcom:'] as readonly string[],
  /** One article never links more symbols than this (the database allows 50). */
  maxSymbols: 30,
  /** Diacritic-folded alias matching applies only to aliases at least this long. */
  minFoldAliasChars: 6,
};
export type NewsLinkConfig = typeof NEWS_LINK_CONFIG;

/**
 * Seed of company names that identify a ticker (large caps only). Keys are tickers. Each alias is at least 4
 * characters and unique across tickers. Extend by reviewed edits, not by guessing.
 */
export const NEWS_SYMBOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  VCB: ['Vietcombank'],
  VIC: ['Vingroup'],
  VHM: ['Vinhomes'],
  VNM: ['Vinamilk'],
  HPG: ['Hòa Phát'],
  MWG: ['Thế Giới Di Động'],
  TCB: ['Techcombank'],
  BID: ['BIDV'],
  CTG: ['VietinBank'],
  VPB: ['VPBank'],
  MSN: ['Masan'],
  STB: ['Sacombank'],
};

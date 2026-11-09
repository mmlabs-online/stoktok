/** Case-sensitive: `&Agrave;` and `&agrave;` are different characters. Latin-1 letters used by Vietnamese CMS output, plus typographic marks. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', egrave: 'è', eacute: 'é', ecirc: 'ê', igrave: 'ì', iacute: 'í',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ugrave: 'ù', uacute: 'ú', yacute: 'ý',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Igrave: 'Ì', Iacute: 'Í',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ugrave: 'Ù', Uacute: 'Ú', Yacute: 'Ý',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', laquo: '«', raquo: '»',
};

/** Index just past the `>` that closes the tag starting at `from`, honouring quoted attribute values. -1 if unclosed. */
function tagEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i] as string;
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  return -1;
}

/** Drops tags, comments and script/style blocks. A tag with no closing `>` drops the rest of the input. */
function stripTags(input: string): string {
  const s = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const lower = s.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    const next = s[i + 1] ?? '';
    if (c !== '<' || !/[A-Za-z/!?]/.test(next)) {
      out += c;
      i += 1;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) break;
      i = end + 3;
    } else {
      const block = /^<(script|style)(?![A-Za-z0-9])/.exec(lower.slice(i, i + 8));
      const end = tagEnd(s, i);
      if (end < 0) break;
      i = end;
      if (block) {
        const close = lower.indexOf(`</${block[1] as string}`, i);
        if (close < 0) break;
        const closeEnd = tagEnd(s, close);
        if (closeEnd < 0) break;
        i = closeEnd;
      }
    }
    out += ' ';
  }
  return out;
}

/** One pass only: `&amp;lt;` becomes the text `&lt;`, never `<`. */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,6}));/g, (m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return Object.hasOwn(NAMED_ENTITIES, name) ? (NAMED_ENTITIES[name] as string) : m;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
    return String.fromCodePoint(cp);
  });
}

/**
 * Untrusted feed markup to plain text (R9). Order: tags, entities (once), NFC, control and zero-width characters,
 * whitespace. The result is never HTML and must never be rendered as HTML.
 */
export function toPlainText(html: string): string {
  return decodeEntities(stripTags(html))
    .normalize('NFC')
    .replace(/[\s\u0085]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Cuts on a code point, so a surrogate pair is never split. */
export function capText(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join('');
}

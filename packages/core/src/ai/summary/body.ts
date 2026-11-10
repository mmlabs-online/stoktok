import { utf8ByteLength } from '../cost';
import { AI_SUMMARY_CONFIG, SUMMARY_TOPICS } from './config';
import type { AiSummaryConfig, SummaryTopic } from './config';
import { formatInputId, parseInputId } from './input-ids';

export type SummaryScope = 'symbol' | 'portfolio';
export type { SummaryTopic };

export const SYMBOL_SUMMARY_TOPICS: readonly SummaryTopic[] = ['price', 'signals', 'news', 'financials'];

export interface AiSummarySentence {
  text: string;
  inputIds: string[];
}

export interface AiSummarySection {
  topic: SummaryTopic;
  /** True when the section is the no-data sentence citing its missing: marker. */
  missing: boolean;
  sentences: AiSummarySentence[];
}

/** The stored body (ai_summaries.body). Plain text only. */
export interface AiSummaryBody {
  version: 1;
  sections: AiSummarySection[];
  /** Sentences the validator dropped (all reasons). */
  strippedCount: number;
}

/** A section holding only the no-data sentence, citing the missing: marker of its topic. Throws on an invalid subject. */
export function noDataSection(subject: string, topic: SummaryTopic, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): AiSummarySection {
  const marker = formatInputId({ kind: 'missing', subject, topic });
  if (marker === null) throw new RangeError('invalid summary subject or topic');
  return { topic, missing: true, sentences: [{ text: cfg.noDataText, inputIds: [marker] }] };
}

export function noDataBody(subject: string, topics: readonly SummaryTopic[], cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): AiSummaryBody {
  return { version: cfg.bodyVersion, sections: topics.map((t) => noDataSection(subject, t, cfg)), strippedCount: 0 };
}

const MARKUP_RE = /[<>`*#|[\]{}\\]|https?:\/\/|www\./i;

/** Allow-list: Latin letters (Vietnamese included), marks, numbers, spaces, basic punctuation, the dong sign. */
const ALLOWED_TEXT_RE = /^[\p{Script=Latin}\p{M}\p{N}\p{Zs}.,;:!?%()'"/+\-–—‘’“”₫]+$/u;
const IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/u;

/**
 * True when `text` is usable plain text: non-empty, within the length cap, already NFKC-normalised, made only of
 * allowed characters (no other scripts, control, bidi or invisible characters), no markup or URL.
 */
export function isPlainSummaryText(text: string, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): boolean {
  return (
    text.length > 0 &&
    text.length <= cfg.maxSentenceChars &&
    text === text.normalize('NFKC') &&
    ALLOWED_TEXT_RE.test(text) &&
    !IGNORABLE_RE.test(text) &&
    !MARKUP_RE.test(text)
  );
}

/** Lower-cases and removes diacritics (NFD, strip marks, đ to d). */
const stripDiacritics = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

/** True when `text` matches a deny pattern, either as written or with diacritics removed. Same check on write and read. */
export function isDenyListed(text: string, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): boolean {
  const lower = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const plain = stripDiacritics(lower);
  return cfg.denyPatterns.some((p) => new RegExp(p, 'u').test(lower) || new RegExp(stripDiacritics(p), 'u').test(plain));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface StoredBodyContext {
  /** The row's input_ids: every cited id must be one of them. */
  inputIds?: readonly string[];
  /** 'PORTFOLIO' or the row's symbol: missing markers must name it, and for a symbol every symbol-scoped id must match it. */
  subject?: string;
}

/**
 * Re-validates a stored body: format, plain text, deny-list, and (with `ctx`) consistency with its row.
 * Returns a rebuilt body (unknown keys dropped), or null when anything is off.
 */
export function parseStoredSummaryBody(raw: unknown, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG, ctx: StoredBodyContext = {}): AiSummaryBody | null {
  const allowed = ctx.inputIds === undefined ? null : new Set(ctx.inputIds);
  try {
    if (utf8ByteLength(JSON.stringify(raw)) > cfg.maxBodyBytes) return null;
  } catch {
    return null; // cyclic or too deep
  }
  if (!isRecord(raw) || raw.version !== cfg.bodyVersion) return null;
  const { sections, strippedCount } = raw;
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > cfg.maxSections) return null;
  if (typeof strippedCount !== 'number' || !Number.isSafeInteger(strippedCount) || strippedCount < 0) return null;
  const out: AiSummarySection[] = [];
  for (const s of sections) {
    if (!isRecord(s) || typeof s.missing !== 'boolean' || !Array.isArray(s.sentences)) return null;
    const topic = s.topic;
    if (!SUMMARY_TOPICS.includes(topic as SummaryTopic) || out.some((o) => o.topic === topic)) return null;
    if (s.sentences.length < 1 || s.sentences.length > cfg.maxSentencesPerSection) return null;
    const sentences: AiSummarySentence[] = [];
    for (const x of s.sentences) {
      if (!isRecord(x) || typeof x.text !== 'string' || !isPlainSummaryText(x.text, cfg) || !Array.isArray(x.inputIds)) return null;
      const ids = x.inputIds;
      if (ids.length < 1 || ids.length > cfg.maxIdsPerSentence) return null;
      if (isDenyListed(x.text, cfg)) return null;
      for (const id of ids) {
        const ref = typeof id === 'string' ? parseInputId(id) : null;
        if (ref === null) return null;
        if (allowed !== null && !allowed.has(id as string)) return null;
        if ((ref.kind === 'missing') !== (s.missing === true)) return null;
        if (ref.kind === 'missing') {
          if (ref.topic !== topic || (ctx.subject !== undefined && ref.subject !== ctx.subject)) return null;
        } else if (ctx.subject !== undefined && ctx.subject !== 'PORTFOLIO' && 'symbol' in ref && ref.symbol !== ctx.subject) {
          return null;
        }
      }
      sentences.push({ text: x.text, inputIds: ids as string[] });
    }
    if (s.missing && (sentences.length !== 1 || sentences[0]?.text !== cfg.noDataText || sentences[0].inputIds.length !== 1)) return null;
    out.push({ topic: topic as SummaryTopic, missing: s.missing, sentences });
  }
  return { version: cfg.bodyVersion, sections: out, strippedCount };
}

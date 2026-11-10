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

function hasControlOrBidi(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      c < 0x20 ||
      (c >= 0x7f && c <= 0x9f) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2064) ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

/** True when `text` is usable plain text: non-empty, within the length cap, no markup, URL, control or bidi characters. */
export function isPlainSummaryText(text: string, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): boolean {
  return text.length > 0 && text.length <= cfg.maxSentenceChars && !MARKUP_RE.test(text) && !hasControlOrBidi(text);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Re-validates a stored body. Returns a rebuilt body (unknown keys dropped), or null when anything is off. */
export function parseStoredSummaryBody(raw: unknown, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): AiSummaryBody | null {
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
      if (!ids.every((id) => typeof id === 'string' && parseInputId(id) !== null)) return null;
      sentences.push({ text: x.text, inputIds: ids as string[] });
    }
    out.push({ topic: topic as SummaryTopic, missing: s.missing, sentences });
  }
  return { version: cfg.bodyVersion, sections: out, strippedCount };
}

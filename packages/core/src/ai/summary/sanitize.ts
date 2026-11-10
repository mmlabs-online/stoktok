import { utf8ByteLength } from '../cost';
import { noDataSection, isPlainSummaryText } from './body';
import type { AiSummaryBody, AiSummarySection, AiSummarySentence } from './body';
import { AI_SUMMARY_CONFIG, SUMMARY_TOPICS } from './config';
import type { AiSummaryConfig, SummaryTopic } from './config';
import { formatInputId } from './input-ids';

export type StripReason =
  | 'invalid_text'
  | 'deny_listed'
  | 'no_ids'
  | 'unknown_id'
  | 'missing_marker'
  | 'missing_topic_claim'
  | 'over_limit'
  | 'bad_topic';

export interface SanitizeContext {
  /** 'PORTFOLIO' or an uppercase symbol. */
  subject: string;
  topics: readonly SummaryTopic[];
  /** Input ids that were given to the model; the only ids a sentence may cite. */
  providedIds: readonly string[];
  /** Topics whose inputs were missing or stale: the output says so instead of filling the gap. */
  missingTopics: readonly SummaryTopic[];
}

export type SanitizeResult =
  | {
      ok: true;
      body: AiSummaryBody;
      /** Sorted unique union of the ids of surviving sentences. */
      citedIds: string[];
      /** Sorted unique: providedIds plus the missing: markers in the body. For ai_summaries.input_ids. */
      inputIds: string[];
      /** Counts per reason: sentences, except bad_topic which counts sections. */
      stripped: Record<StripReason, number>;
    }
  | { ok: false; code: 'malformed' | 'bad_context' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

/**
 * Post-call validator for the model's summary output (R9). Pure. Expected raw shape:
 * { sections: [{ topic, sentences: [{ text, inputIds }] }] }; extra keys are ignored.
 * Sentences without a provided input id, with deny-listed or non-plain text are dropped; missing topics become the no-data sentence.
 */
export function sanitizeSummaryOutput(raw: unknown, ctx: SanitizeContext, cfg: AiSummaryConfig = AI_SUMMARY_CONFIG): SanitizeResult {
  if (!isRecord(raw) || !Array.isArray(raw.sections)) return { ok: false, code: 'malformed' };
  for (const s of raw.sections) {
    if (!isRecord(s) || (s.sentences !== undefined && !Array.isArray(s.sentences))) return { ok: false, code: 'malformed' };
    if (Array.isArray(s.sentences) && s.sentences.some((x) => !isRecord(x))) return { ok: false, code: 'malformed' };
  }
  const topics = SUMMARY_TOPICS.filter((t) => ctx.topics.includes(t));
  if (topics.some((t) => formatInputId({ kind: 'missing', subject: ctx.subject, topic: t }) === null)) {
    return { ok: false, code: 'bad_context' };
  }

  const stripped: Record<StripReason, number> = {
    invalid_text: 0,
    deny_listed: 0,
    no_ids: 0,
    unknown_id: 0,
    missing_marker: 0,
    missing_topic_claim: 0,
    over_limit: 0,
    bad_topic: 0,
  };
  const provided = new Set(ctx.providedIds);
  const deny = cfg.denyPatterns.map((p) => new RegExp(p, 'u'));

  const check = (s: Record<string, unknown>): AiSummarySentence | StripReason => {
    const text = typeof s.text === 'string' ? s.text.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
    if (!isPlainSummaryText(text, cfg)) return 'invalid_text';
    const lower = text.toLowerCase();
    if (deny.some((re) => re.test(lower))) return 'deny_listed';
    if (!Array.isArray(s.inputIds) || s.inputIds.length === 0) return 'no_ids';
    const ids = [...new Set(s.inputIds)];
    if (ids.length > cfg.maxIdsPerSentence) return 'over_limit';
    for (const id of ids) {
      if (typeof id !== 'string') return 'unknown_id';
      if (id.startsWith('missing:')) return 'missing_marker';
      if (!provided.has(id)) return 'unknown_id';
    }
    return { text, inputIds: ids as string[] };
  };

  const byTopic = new Map<SummaryTopic, AiSummarySentence[]>();
  const claimed = new Set<string>();
  for (const sec of raw.sections as Record<string, unknown>[]) {
    const topic = sec.topic;
    const sentences = (sec.sentences ?? []) as Record<string, unknown>[];
    if (typeof topic !== 'string' || !topics.includes(topic as SummaryTopic) || claimed.has(topic)) {
      stripped.bad_topic += 1;
      continue;
    }
    claimed.add(topic);
    if (ctx.missingTopics.includes(topic as SummaryTopic)) {
      stripped.missing_topic_claim += sentences.length;
      continue;
    }
    const kept: AiSummarySentence[] = [];
    for (const s of sentences) {
      const r = check(s);
      if (typeof r === 'string') stripped[r] += 1;
      else if (kept.length >= cfg.maxSentencesPerSection) stripped.over_limit += 1;
      else kept.push(r);
    }
    byTopic.set(topic as SummaryTopic, kept);
  }

  const sections: AiSummarySection[] = topics.map((t) => {
    const kept = byTopic.get(t);
    return kept && kept.length > 0 ? { topic: t, missing: false, sentences: kept } : noDataSection(ctx.subject, t, cfg);
  });

  const total = () => Object.values(stripped).reduce((a, b) => a + b, 0);
  const build = (): AiSummaryBody => ({ version: cfg.bodyVersion, sections, strippedCount: total() });
  while (utf8ByteLength(JSON.stringify(build())) > cfg.maxBodyBytes) {
    let i = sections.length - 1;
    while (i >= 0 && sections[i]?.missing) i -= 1;
    const sec = sections[i];
    if (!sec) break;
    sec.sentences.pop();
    stripped.over_limit += 1;
    if (sec.sentences.length === 0) sections[i] = noDataSection(ctx.subject, sec.topic, cfg);
  }

  const body = build();
  const citedIds = sortedUnique(sections.filter((s) => !s.missing).flatMap((s) => s.sentences.flatMap((x) => x.inputIds)));
  const markers = sections.filter((s) => s.missing).flatMap((s) => s.sentences.flatMap((x) => x.inputIds));
  return { ok: true, body, citedIds, inputIds: sortedUnique([...ctx.providedIds, ...markers]), stripped };
}

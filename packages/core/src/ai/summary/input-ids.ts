import { isValidDate } from '../../calendar';
import { SUMMARY_TOPICS } from './config';
import type { SummaryTopic } from './config';

/**
 * Input IDs are the block ids the model sees and cites. They always match ^[A-Za-z0-9_.:-]{1,64}$.
 * Natural keys are used where the stored row has no id (signals, financials).
 */
export type InputRef =
  | { kind: 'px'; symbol: string; date: string }
  | { kind: 'sig'; symbol: string; ruleId: string; date: string }
  | { kind: 'news'; id: number }
  | { kind: 'fin'; symbol: string; period: string }
  | { kind: 'hold'; symbol: string; date: string }
  | { kind: 'sum'; symbol: string; date: string }
  | { kind: 'missing'; subject: string; topic: SummaryTopic };

export const MAX_INPUT_ID_CHARS = 64;

const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;
const RULE_RE = /^[a-z0-9_]{1,60}$/;
const PERIOD_RE = /^\d{4}(Q[1-4])?$/;
const NEWS_RE = /^[1-9]\d{0,15}$/;

const validSymbol = (s: string) => SYMBOL_RE.test(s);
const validDate = (d: string) => isValidDate(d);

export function formatInputId(ref: InputRef): string | null {
  let id: string | null = null;
  switch (ref.kind) {
    case 'px':
    case 'hold':
    case 'sum':
      if (validSymbol(ref.symbol) && validDate(ref.date)) id = `${ref.kind}:${ref.symbol}:${ref.date}`;
      break;
    case 'sig':
      if (validSymbol(ref.symbol) && RULE_RE.test(ref.ruleId) && validDate(ref.date)) id = `sig:${ref.symbol}:${ref.ruleId}:${ref.date}`;
      break;
    case 'news':
      if (Number.isSafeInteger(ref.id) && ref.id > 0) id = `news:${ref.id}`;
      break;
    case 'fin':
      if (validSymbol(ref.symbol) && PERIOD_RE.test(ref.period)) id = `fin:${ref.symbol}:${ref.period}`;
      break;
    case 'missing':
      if ((validSymbol(ref.subject) || ref.subject === 'PORTFOLIO') && SUMMARY_TOPICS.includes(ref.topic)) {
        id = `missing:${ref.subject}:${ref.topic}`;
      }
      break;
  }
  return id !== null && id.length <= MAX_INPUT_ID_CHARS ? id : null;
}

/** Inverse of formatInputId; null for anything that formatInputId could not have produced. */
export function parseInputId(id: string): InputRef | null {
  if (typeof id !== 'string' || id.length > MAX_INPUT_ID_CHARS) return null;
  const p = id.split(':');
  let ref: InputRef | null = null;
  if ((p[0] === 'px' || p[0] === 'hold' || p[0] === 'sum') && p.length === 3) {
    ref = { kind: p[0], symbol: p[1] as string, date: p[2] as string };
  } else if (p[0] === 'sig' && p.length === 4) {
    ref = { kind: 'sig', symbol: p[1] as string, ruleId: p[2] as string, date: p[3] as string };
  } else if (p[0] === 'news' && p.length === 2 && NEWS_RE.test(p[1] as string)) {
    ref = { kind: 'news', id: Number(p[1]) };
  } else if (p[0] === 'fin' && p.length === 3) {
    ref = { kind: 'fin', symbol: p[1] as string, period: p[2] as string };
  } else if (p[0] === 'missing' && p.length === 3) {
    ref = { kind: 'missing', subject: p[1] as string, topic: p[2] as SummaryTopic };
  }
  return ref !== null && formatInputId(ref) === id ? ref : null;
}

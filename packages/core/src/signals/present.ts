/**
 * View model of the medium-term signals section (R1): every decision and every string is built here,
 * the component only renders. Nothing is recomputed; only stored `value`, `peerCount` and refs are read.
 */
import { vnDateOf } from '../calendar';
import { formatDate, formatDateTime, formatPercent } from '../format';
import { parsePeriod } from '../market/quarters';
import { DIRECTION_LABELS, VISIBILITY_LABELS, reasonLabel, ruleName } from './labels-vi';
import { DATA_REASONS, REASON_ORDER, RULE_IDS, parseMaRuleId } from './types';
import type { SignalLabel, SnapshotRef, StoredSignal } from './types';
import { parseSignalSnapshot, signalVisibility } from './visibility';
import type { ParsedSnapshot, VisibilityCause, VisibilityContext } from './visibility';

export interface InputVM {
  kindLabel: string;
  refText: string;
  /** "Nguồn: …", null when the input has no source line. */
  sourceText: string | null;
  /** "Cập nhật: …", null when the input has no fetched_at. */
  fetchedAtText: string | null;
}

export interface ReasonVM {
  text: string;
  kind: 'data' | 'rule';
}

export type SignalRowVM =
  | {
      state: 'ok';
      ruleId: string;
      ruleName: string;
      signalDateText: string;
      directionText: string;
      directionGlyph: string;
      valueText: string;
      inputs: InputVM[];
    }
  | { state: 'suppressed'; ruleId: string; ruleName: string; signalDateText: string; reasons: ReasonVM[]; inputs: InputVM[] }
  | { state: 'hidden'; ruleId: string; ruleName: string; lastSignalDateText: string; causes: string[] }
  | { state: 'no_signal'; ruleId: string; ruleName: string; text: string };

export type SignalsSectionVM =
  | { kind: 'empty' }
  | { kind: 'hidden'; lastSignalDateText: string; causes: string[] }
  | { kind: 'list'; lastSignalDateText: string; summaryText: string; rows: SignalRowVM[] };

export const NO_SIGNAL_TEXT = 'Chưa có tín hiệu';
const MANUAL_SOURCE_TEXT = 'Nhập tay (sổ giao dịch)';
const GLYPHS: Record<SignalLabel, string> = { bullish: '▲', bearish: '▼', neutral: '■' };

function dateText(date: string): string {
  try {
    return formatDate(date);
  } catch {
    return date;
  }
}

function instantText(iso: string): string {
  try {
    return formatDateTime(iso);
  } catch {
    return iso;
  }
}

function vnDateText(iso: string): string {
  return dateText(vnDateOf(new Date(iso)));
}

function causeText(c: VisibilityCause): string {
  const base = VISIBILITY_LABELS[c.code];
  if (c.code === 'signal_outdated') return base.replace('{date}', dateText(c.expectedDate ?? ''));
  if (c.fromDate !== undefined && c.toDate !== undefined) return `${base}: từ ${dateText(c.fromDate)} đến ${dateText(c.toDate)}`;
  return base;
}

function lastSegment(ref: string): string {
  return ref.slice(ref.lastIndexOf(':') + 1);
}

function inputOf(r: SnapshotRef, sector: string | null): InputVM {
  const sourceText = r.source === undefined ? null : `Nguồn: ${r.source}`;
  const fetchedAtText = r.fetchedAt === undefined ? null : `Cập nhật: ${instantText(r.fetchedAt)}`;
  if (r.ref.startsWith('prices_daily:')) {
    return { kindLabel: 'Giá đóng cửa', refText: `phiên ${dateText(lastSegment(r.ref))}`, sourceText, fetchedAtText };
  }
  if (r.ref.startsWith('financials:')) {
    const p = parsePeriod(lastSegment(r.ref));
    return { kindLabel: 'Báo cáo tài chính', refText: p ? `Quý ${p.quarter}/${p.year}` : r.ref, sourceText, fetchedAtText };
  }
  if (r.ref.startsWith('symbols:')) return { kindLabel: 'Ngành', refText: sector ?? r.ref, sourceText, fetchedAtText };
  if (r.ref.startsWith('data_gaps:') && r.fromTs !== undefined && r.toTs !== undefined) {
    return { kindLabel: 'Khoảng thiếu dữ liệu', refText: `Từ ${vnDateText(r.fromTs)} đến ${vnDateText(r.toTs)}`, sourceText: null, fetchedAtText: null };
  }
  return { kindLabel: 'Sự kiện quyền', refText: `#${lastSegment(r.ref)}`, sourceText: `Nguồn: ${MANUAL_SOURCE_TEXT}`, fetchedAtText: null };
}

function inputsOf(snap: Extract<ParsedSnapshot, { ok: true }>): InputVM[] {
  const inputs = snap.refs.map((r) => inputOf(r, snap.sector));
  const w = snap.maWindow;
  if (w !== null) {
    inputs.push({
      kindLabel: `Cửa sổ giá ${w.count} phiên`,
      refText: `từ ${dateText(w.fromDate)} đến ${dateText(w.toDate)}`,
      sourceText: w.sources.length > 0 ? `Nguồn: ${w.sources.join(', ')}` : null,
      fetchedAtText:
        w.minFetchedAt !== null && w.maxFetchedAt !== null ? `Cập nhật: ${instantText(w.minFetchedAt)} – ${instantText(w.maxFetchedAt)}` : null,
    });
  }
  return inputs;
}

function side(value: number, below: string, above: string, equal: string): string {
  return value < 0 ? below : value > 0 ? above : equal;
}

/** Wording of the stored value. The sign comes from `value`, not from the label. */
function valueTextOf(row: StoredSignal, snap: Extract<ParsedSnapshot, { ok: true }>): string {
  const v = row.value;
  if (v === null) return '';
  const abs = v < 0 ? -v : v;
  if (row.ruleId === RULE_IDS.peVsSector || row.ruleId === RULE_IDS.pbVsSector) {
    const name = row.ruleId === RULE_IDS.peVsSector ? 'P/E' : 'P/B';
    const peers = snap.peerCount === null ? '' : ` (${snap.peerCount} mã cùng ngành)`;
    return `${name} ${side(v, 'thấp hơn', 'cao hơn', 'bằng')} trung vị ngành ${formatPercent(abs)}${peers}`;
  }
  const days = parseMaRuleId(row.ruleId);
  if (days !== null) return `Giá ${side(v, 'dưới', 'trên', 'bằng')} MA${days} ${formatPercent(abs)}`;
  if (row.ruleId === RULE_IDS.earningsGrowth) {
    if (v === 0) return 'Lợi nhuận quý gần nhất đi ngang so cùng kỳ';
    return `Lợi nhuận ${v < 0 ? 'giảm' : 'tăng'} ${abs} quý liên tiếp (so cùng kỳ)`;
  }
  return '';
}

function reasonsOf(codes: readonly string[]): ReasonVM[] {
  const rank = (c: string) => {
    const i = (REASON_ORDER as readonly string[]).indexOf(c);
    return i === -1 ? REASON_ORDER.length : i;
  };
  return [...codes]
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => ({ text: reasonLabel(c), kind: (DATA_REASONS as readonly string[]).includes(c) ? 'data' : 'rule' }));
}

const STATE_ORDER = { ok: 0, suppressed: 1, hidden: 2, no_signal: 3 } as const;

/**
 * One row per expected rule (ruleIds order inside each state group: ok, suppressed, hidden, no signal).
 * The section is `empty` without any stored row and `hidden` when every stored row is hidden.
 */
export function presentMediumSignals(input: {
  ruleIds: readonly string[];
  rows: readonly StoredSignal[];
  ctx: VisibilityContext;
}): SignalsSectionVM {
  const { ctx } = input;
  const stored = input.ruleIds.flatMap((id) => input.rows.filter((r) => r.ruleId === id).slice(0, 1));
  if (stored.length === 0) return { kind: 'empty' };

  const lastSignalDate = stored.reduce((max, r) => (r.signalDate > max ? r.signalDate : max), '');
  const lastSignalDateText = dateText(lastSignalDate);

  const rows: SignalRowVM[] = input.ruleIds.map((ruleId) => {
    const row = stored.find((r) => r.ruleId === ruleId);
    const name = ruleName(ruleId);
    if (row === undefined) return { state: 'no_signal', ruleId, ruleName: name, text: NO_SIGNAL_TEXT };
    const vis = signalVisibility(row, ctx);
    if (vis.state === 'hidden') {
      return { state: 'hidden', ruleId, ruleName: name, lastSignalDateText: dateText(row.signalDate), causes: vis.causes.map(causeText) };
    }
    const snap = parseSignalSnapshot(row);
    if (!snap.ok) {
      return { state: 'hidden', ruleId, ruleName: name, lastSignalDateText: dateText(row.signalDate), causes: [VISIBILITY_LABELS.snapshot_invalid] };
    }
    if (vis.state === 'suppressed') {
      return { state: 'suppressed', ruleId, ruleName: name, signalDateText: dateText(row.signalDate), reasons: reasonsOf(vis.reasons), inputs: inputsOf(snap) };
    }
    return {
      state: 'ok',
      ruleId,
      ruleName: name,
      signalDateText: dateText(row.signalDate),
      directionText: row.label === null ? '' : DIRECTION_LABELS[row.label],
      directionGlyph: row.label === null ? '' : GLYPHS[row.label],
      valueText: valueTextOf(row, snap),
      inputs: inputsOf(snap),
    };
  });

  if (rows.every((r) => r.state === 'hidden' || r.state === 'no_signal')) {
    const hiddenRows = rows.filter((r) => r.state === 'hidden');
    return { kind: 'hidden', lastSignalDateText, causes: [...new Set(hiddenRows.flatMap((r) => (r.state === 'hidden' ? r.causes : [])))] };
  }

  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => STATE_ORDER[a.r.state] - STATE_ORDER[b.r.state] || a.i - b.i)
    .map((x) => x.r);
  const shown = rows.filter((r) => r.state === 'ok').length;
  const tempHidden = rows.filter((r) => r.state === 'suppressed' || r.state === 'hidden').length;
  return { kind: 'list', lastSignalDateText, summaryText: `${shown} tín hiệu, ${tempHidden} tạm ẩn`, rows: ordered };
}

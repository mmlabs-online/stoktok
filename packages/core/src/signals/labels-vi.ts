/** Vietnamese copy for stored signals. Maps are exhaustive (typecheck fails when a code is added without a label). */
import { RULE_IDS, isReasonCode, parseMaRuleId } from './types';
import type { ReasonCode, SignalLabel } from './types';
import type { VisibilityCode } from './visibility';

/** Wording describes a direction only, never an action (R9, R10). */
export const DIRECTION_LABELS = {
  bullish: 'Tích cực',
  bearish: 'Tiêu cực',
  neutral: 'Trung tính',
} as const satisfies Record<SignalLabel, string>;

export const REASON_LABELS = {
  price_missing: 'Chưa có dữ liệu giá',
  price_stale: 'Giá chưa cập nhật phiên gần nhất',
  insufficient_history: 'Chưa đủ số phiên giá để tính',
  price_gap: 'Thiếu giá một số phiên trong khoảng tính',
  price_gap_recorded: 'Có khoảng mất dữ liệu giá đã ghi nhận',
  financials_missing: 'Chưa có báo cáo tài chính',
  financials_stale: 'Chưa có BCTC quý gần nhất',
  financials_gap: 'Thiếu BCTC một số quý cần thiết',
  financials_gap_recorded: 'Có khoảng mất dữ liệu BCTC đã ghi nhận',
  financials_fetch_stale: 'Dữ liệu BCTC lâu chưa được làm mới',
  sector_missing: 'Chưa rõ ngành',
  eps_basis_unverified: 'Chưa xác minh cách tính EPS của nguồn dữ liệu',
  eps_non_positive: 'EPS 4 quý ≤ 0 — P/E không có ý nghĩa',
  bvps_non_positive: 'Giá trị sổ sách/CP ≤ 0 — P/B không có ý nghĩa',
  peers_insufficient: 'Không đủ mã cùng ngành để so sánh',
  value_out_of_range: 'Giá trị vượt ngưỡng tính toán',
  corporate_action_in_window: 'Có sự kiện quyền (cổ tức cổ phiếu/phát hành thêm) trong khoảng tính — giá chưa điều chỉnh',
  price_jump_beyond_limit: 'Có phiên biến động vượt biên độ sàn — giá có thể chưa được điều chỉnh',
} as const satisfies Record<ReasonCode, string>;

/** `{date}` is filled in with the expected session by the presenter. */
export const VISIBILITY_LABELS = {
  signal_outdated: 'Tín hiệu chưa được tính lại cho phiên {date}',
  price_gap_open: 'Đang có khoảng mất dữ liệu giá trong khoảng tính',
  financials_gap_open: 'Đang có khoảng mất dữ liệu BCTC trong khoảng tính',
  rule_version_outdated: 'Quy tắc đã thay đổi, chờ tính lại',
  snapshot_invalid: 'Dữ liệu tín hiệu không đọc được',
} as const satisfies Record<VisibilityCode, string>;

export const RULE_LABELS = {
  [RULE_IDS.peVsSector]: 'P/E so với trung vị ngành',
  [RULE_IDS.pbVsSector]: 'P/B so với trung vị ngành',
  [RULE_IDS.earningsGrowth]: 'Xu hướng lợi nhuận so cùng kỳ',
} as const satisfies Record<(typeof RULE_IDS)[keyof typeof RULE_IDS], string>;

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/** Display name of a rule; an unknown ID is returned as is. */
export function ruleName(id: string): string {
  if (has(RULE_LABELS, id)) return RULE_LABELS[id as keyof typeof RULE_LABELS];
  const days = parseMaRuleId(id);
  return days === null ? id : `Giá so với MA${days}`;
}

/** Label of a stored reason code; a code this version does not know is shown with its raw value. */
export function reasonLabel(code: string): string {
  return isReasonCode(code) ? REASON_LABELS[code] : `Lý do khác (${code})`;
}

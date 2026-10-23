import { formatVnd } from '../format';
import type { CorporateAction } from '../ledger/types';

/** One-line Vietnamese description for the corporate action list. */
export function describeCorporateAction(action: CorporateAction): string {
  if (action.type === 'cash_dividend') return `Cổ tức tiền ${formatVnd(action.amountPerShare)}/cp`;
  return `Cổ tức cổ phiếu ${action.ratio.held}:${action.ratio.received}`;
}

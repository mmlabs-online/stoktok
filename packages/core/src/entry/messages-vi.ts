import { formatDate, formatQuantity } from '../format';

export type EntryErrorCode =
  | 'REQUIRED'
  | 'NOT_INTEGER'
  | 'TOO_LARGE'
  | 'SYMBOL_INVALID'
  | 'DATE_INVALID'
  | 'DATE_IN_FUTURE'
  | 'SIDE_INVALID'
  | 'PRICE_NOT_POSITIVE'
  | 'PRICE_LOW_UNCONFIRMED'
  | 'QTY_NOT_POSITIVE'
  | 'QTY_NOT_LOT'
  | 'FEE_REQUIRED_NO_RATE'
  | 'TAX_REQUIRED_NO_RATE'
  | 'OVERSELL_SELF'
  | 'OVERSELL_OTHER'
  | 'LEDGER_INVALID'
  | 'CA_TYPE_UNSUPPORTED'
  | 'AMOUNT_NOT_POSITIVE'
  | 'RATIO_NOT_POSITIVE'
  | 'DATE_BEFORE_EX'
  | 'CA_DUPLICATE'
  | 'NOT_FOUND'
  | 'SAVE_FAILED';

export type EntryParams = Record<string, string | number>;

export interface EntryError {
  code: EntryErrorCode;
  params?: EntryParams;
}

/** Vietnamese message for an entry error code. Codes are stable; text is defined once, here. */
export function entryMessage(code: EntryErrorCode, params: EntryParams = {}): string {
  const p = (k: string) => String(params[k] ?? '');
  const qty = (k: string) => (typeof params[k] === 'number' ? formatQuantity(params[k]) : p(k));
  const day = () => (typeof params.date === 'string' ? formatDate(params.date) : '');
  switch (code) {
    case 'REQUIRED':
      return 'Bắt buộc nhập.';
    case 'NOT_INTEGER':
      return 'Nhập số nguyên đồng, ví dụ 125400 hoặc 125.400.';
    case 'TOO_LARGE':
      return 'Giá trị quá lớn.';
    case 'SYMBOL_INVALID':
      return 'Mã chứng khoán gồm 3-10 chữ cái hoặc chữ số.';
    case 'DATE_INVALID':
      return 'Ngày không hợp lệ.';
    case 'DATE_IN_FUTURE':
      return 'Ngày giao dịch không được ở tương lai.';
    case 'SIDE_INVALID':
      return 'Chọn Mua hoặc Bán.';
    case 'PRICE_NOT_POSITIVE':
      return 'Giá phải lớn hơn 0.';
    case 'PRICE_LOW_UNCONFIRMED':
      return 'Giá nhập bằng đồng (VND), ví dụ 125400 cho 125,4 nghìn. Nếu giá thực sự dưới 1.000 ₫, đánh dấu xác nhận.';
    case 'QTY_NOT_POSITIVE':
      return 'Khối lượng phải lớn hơn 0.';
    case 'QTY_NOT_LOT':
      return `Khối lượng phải là bội số của ${p('lotSize')} (lô chẵn). Chọn "Lô lẻ" nếu đây là giao dịch lô lẻ.`;
    case 'FEE_REQUIRED_NO_RATE':
      return 'Chưa cài đặt tỷ lệ phí giao dịch, hãy nhập phí.';
    case 'TAX_REQUIRED_NO_RATE':
      return 'Chưa cài đặt tỷ lệ phí giao dịch, hãy nhập thuế cho lệnh bán.';
    case 'OVERSELL_SELF':
      return `Vượt số lượng có thể bán: chỉ có ${qty('sellable')} cổ phiếu ${p('symbol')} khả dụng ngày ${day()} (bạn nhập ${qty('requested')}). Cổ phiếu mua về sau T+2 mới bán được.`;
    case 'OVERSELL_OTHER':
      return `Không thể lưu: thay đổi này làm lệnh bán ${p('symbol')} ngày ${day()} vượt số lượng có thể bán (cần ${qty('requested')}, khả dụng ${qty('sellable')}).`;
    case 'LEDGER_INVALID':
      return 'Không thể lưu: dữ liệu sổ giao dịch không hợp lệ sau thay đổi này.';
    case 'CA_TYPE_UNSUPPORTED':
      return 'Loại sự kiện chưa được hỗ trợ.';
    case 'AMOUNT_NOT_POSITIVE':
      return 'Số tiền phải lớn hơn 0.';
    case 'RATIO_NOT_POSITIVE':
      return 'Tỷ lệ phải là số nguyên lớn hơn 0.';
    case 'DATE_BEFORE_EX':
      return 'Ngày phải bằng hoặc sau ngày GDKHQ.';
    case 'CA_DUPLICATE':
      return 'Đã có sự kiện này cho mã và ngày GDKHQ.';
    case 'NOT_FOUND':
      return 'Không tìm thấy giao dịch.';
    case 'SAVE_FAILED':
      return 'Không lưu được, vui lòng thử lại.';
  }
}

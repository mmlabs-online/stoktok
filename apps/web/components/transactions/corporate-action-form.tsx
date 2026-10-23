'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { CorporateActionFormState } from '../../server/transactions/handlers';
import { Field, FormBanner, TextField, describedBy, inputClass, primaryButtonClass, secondaryLinkClass } from './form-fields';

export type CorporateActionAction = (
  prev: CorporateActionFormState,
  formData: FormData,
) => Promise<CorporateActionFormState>;

export function CorporateActionForm({
  action,
  initial,
}: {
  action: CorporateActionAction;
  initial: CorporateActionFormState;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  if (state.ok) return null;
  const { fieldErrors: errors, values } = state;
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <p className="text-fg-muted text-sm">
        Quyền mua chưa được hỗ trợ. Tạm thời nhập cổ phiếu mua quyền như một lệnh Mua với giá phát hành, phí 0.
      </p>
      <FormBanner error={state.formError} />
      <Field name="type" label="Loại" error={errors.type}>
        <select
          id="type"
          name="type"
          defaultValue={values.type}
          aria-invalid={errors.type ? true : undefined}
          aria-describedby={describedBy('type', errors.type)}
          className={inputClass}
        >
          <option value="cash_dividend">Cổ tức tiền</option>
          <option value="stock_dividend">Cổ tức cổ phiếu</option>
        </select>
      </Field>
      <TextField name="symbol" label="Mã" defaultValue={values.symbol} error={errors.symbol} />
      <TextField name="exDate" label="Ngày GDKHQ" type="date" defaultValue={values.exDate} error={errors.exDate} />
      <TextField
        name="amountPerShare"
        label="Số tiền/cp (₫)"
        inputMode="numeric"
        defaultValue={values.amountPerShare}
        error={errors.amountPerShare}
        help="Dùng cho cổ tức tiền."
      />
      <TextField name="payDate" label="Ngày thanh toán" type="date" defaultValue={values.payDate} error={errors.payDate} help="Tùy chọn, cổ tức tiền." />
      <TextField name="held" label="Tỷ lệ: sở hữu" inputMode="numeric" defaultValue={values.held} error={errors.held} help="Dùng cho cổ tức cổ phiếu." />
      <TextField name="received" label="Tỷ lệ: nhận" inputMode="numeric" defaultValue={values.received} error={errors.received} />
      <TextField name="listingDate" label="Ngày niêm yết" type="date" defaultValue={values.listingDate} error={errors.listingDate} help="Tùy chọn, cổ tức cổ phiếu." />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          Lưu sự kiện
        </button>
        <Link href="/transactions" className={secondaryLinkClass}>
          Hủy
        </Link>
      </div>
    </form>
  );
}

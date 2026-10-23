'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { TransactionFormState } from '../../server/transactions/handlers';
import { CheckField, Field, FormBanner, TextField, describedBy, inputClass, primaryButtonClass, secondaryLinkClass } from './form-fields';

export type TransactionAction = (prev: TransactionFormState, formData: FormData) => Promise<TransactionFormState>;

export function TransactionForm({
  action,
  initial,
  today,
  feeRateConfigured,
  submitLabel,
}: {
  action: TransactionAction;
  initial: TransactionFormState;
  today: string;
  feeRateConfigured: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  if (state.ok) return null;
  const { fieldErrors: errors, values } = state;
  const sideError = errors.side;
  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {!feeRateConfigured && (
        <p className="border-warn text-warn rounded-lg border p-3 text-sm">
          Chưa cài đặt phí giao dịch: nhập phí/thuế thủ công.{' '}
          <Link href="/settings" className="underline">
            Cài đặt
          </Link>
        </p>
      )}
      <FormBanner error={state.formError} />
      <TextField name="tradeDate" label="Ngày giao dịch" type="date" max={today} defaultValue={values.tradeDate} error={errors.tradeDate} />
      <TextField name="symbol" label="Mã" defaultValue={values.symbol} error={errors.symbol} />
      <Field name="side" label="Loại" error={sideError}>
        <select
          id="side"
          name="side"
          defaultValue={values.side}
          aria-invalid={sideError ? true : undefined}
          aria-describedby={describedBy('side', sideError)}
          className={inputClass}
        >
          <option value="buy">Mua</option>
          <option value="sell">Bán</option>
        </select>
      </Field>
      <TextField name="quantity" label="Khối lượng" inputMode="numeric" defaultValue={values.quantity} error={errors.quantity} />
      <CheckField name="oddLot" label="Lô lẻ" defaultChecked={values.oddLot} />
      <TextField
        name="price"
        label="Giá (₫)"
        inputMode="numeric"
        defaultValue={values.price}
        error={errors.price}
        help="Nhập bằng đồng, ví dụ 125400 hoặc 125.400 (= 125,40 nghìn)"
      />
      {(errors.price?.code === 'PRICE_LOW_UNCONFIRMED' || values.confirmLowPrice) && (
        <CheckField name="confirmLowPrice" label="Tôi xác nhận giá dưới 1.000 ₫" defaultChecked={values.confirmLowPrice} />
      )}
      <TextField
        name="fee"
        label="Phí (₫)"
        inputMode="numeric"
        defaultValue={values.fee}
        error={errors.fee}
        help={feeRateConfigured ? 'Để trống để dùng mức phí ước tính từ cài đặt.' : undefined}
      />
      <TextField
        name="tax"
        label="Thuế (₫)"
        inputMode="numeric"
        defaultValue={values.tax}
        error={errors.tax}
        help={feeRateConfigured ? 'Để trống để dùng mức thuế ước tính (chỉ lệnh bán).' : undefined}
      />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {submitLabel}
        </button>
        <Link href="/transactions" className={secondaryLinkClass}>
          Hủy
        </Link>
      </div>
    </form>
  );
}

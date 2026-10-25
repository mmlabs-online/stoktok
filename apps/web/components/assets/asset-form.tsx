'use client';

import Link from 'next/link';
import { startTransition, useActionState, useState } from 'react';
import type { AssetFormState } from '../../server/assets/handlers';
import { Field, FormBanner, TextField, describedBy, inputClass, primaryButtonClass, secondaryLinkClass } from '../transactions/form-fields';

export type AssetAction = (prev: AssetFormState, formData: FormData) => Promise<AssetFormState>;

export function AssetForm({
  action,
  initial,
  today,
  submitLabel,
}: {
  action: AssetAction;
  initial: AssetFormState;
  today: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  // Controlled: React resets uncontrolled fields after the action, and a select would fall back to its first option.
  const [type, setType] = useState(initial.ok ? 'cash' : initial.values.type);
  if (state.ok) return null;
  const { fieldErrors: errors, values } = state;
  return (
    <form
      onSubmit={(e) => {
        // Not <form action>: React 19 would reset the form after the action.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="max-w-xl space-y-4"
    >
      <FormBanner error={state.formError} />
      <Field name="type" label="Loại" error={errors.type}>
        <select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-invalid={errors.type ? true : undefined}
          aria-describedby={describedBy('type', errors.type)}
          className={inputClass}
        >
          <option value="cash">Tiền mặt</option>
          <option value="other">Khác</option>
        </select>
      </Field>
      <TextField name="name" label="Tên" defaultValue={values.name} error={errors.name} />
      <TextField
        name="value"
        label="Giá trị (₫)"
        inputMode="numeric"
        defaultValue={values.value}
        error={errors.value}
        help="Số nguyên đồng, có thể dùng dấu chấm, ví dụ 50.000.000"
      />
      <TextField name="asOf" type="date" label="Ngày cập nhật" max={today} defaultValue={values.asOf} error={errors.asOf} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {submitLabel}
        </button>
        <Link href="/assets" className={secondaryLinkClass}>
          Hủy
        </Link>
      </div>
    </form>
  );
}

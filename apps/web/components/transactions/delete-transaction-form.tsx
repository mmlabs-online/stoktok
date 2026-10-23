'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { FormState } from '../../server/transactions/handlers';
import { FormBanner, secondaryLinkClass } from './form-fields';

export type DeleteState = FormState<Record<string, never>>;
export type DeleteAction = (prev: DeleteState, formData: FormData) => Promise<DeleteState>;

export function DeleteTransactionForm({ action }: { action: DeleteAction }) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(action, {
    ok: false,
    fieldErrors: {},
    values: {},
  });
  return (
    <form action={formAction} className="space-y-4">
      {!state.ok && <FormBanner error={state.formError} />}
      <div className="flex gap-3">
        <Link href="/transactions" className={secondaryLinkClass}>
          Hủy
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="bg-price-down text-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-medium disabled:opacity-60"
        >
          Xóa
        </button>
      </div>
    </form>
  );
}

'use client';

import { startTransition, useActionState, useState } from 'react';
import { EXCHANGES, EXCHANGE_LABELS } from '@stoktok/core';
import type { WatchFormState } from '../../server/watchlist/handlers';
import { Field, FormBanner, describedBy, inputClass, primaryButtonClass } from '../transactions/form-fields';

export type AddWatchAction = (prev: WatchFormState, formData: FormData) => Promise<WatchFormState>;

const INITIAL: WatchFormState = { ok: false, fieldErrors: {}, values: { symbol: '', exchange: '' } };

export function AddSymbolForm({ action, initial = INITIAL }: { action: AddWatchAction; initial?: WatchFormState }) {
  // Controlled inputs: React resets uncontrolled fields after the action, and a select would fall back to its first option.
  const [symbol, setSymbol] = useState(initial.ok ? '' : initial.values.symbol);
  const [exchange, setExchange] = useState(initial.ok ? '' : initial.values.exchange);
  const [state, formAction, pending] = useActionState<WatchFormState, FormData>(async (prev, fd) => {
    const next = await action(prev, fd);
    if (next.ok) setSymbol('');
    return next;
  }, initial);
  const errors = state.ok ? {} : state.fieldErrors;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="max-w-xl space-y-3"
    >
      {!state.ok && <FormBanner error={state.formError} />}
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-40">
          <Field name="symbol" label="Mã" error={errors.symbol}>
            <input
              id="symbol"
              name="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              aria-invalid={errors.symbol ? true : undefined}
              aria-describedby={describedBy('symbol', errors.symbol)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="w-40">
          <Field name="exchange" label="Sàn GD" error={errors.exchange}>
            <select
              id="exchange"
              name="exchange"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              aria-invalid={errors.exchange ? true : undefined}
              aria-describedby={describedBy('exchange', errors.exchange)}
              className={inputClass}
            >
              <option value="">Chưa rõ</option>
              {EXCHANGES.map((x) => (
                <option key={x} value={x}>
                  {EXCHANGE_LABELS[x]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="pt-6">
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            Thêm theo dõi
          </button>
        </div>
      </div>
    </form>
  );
}

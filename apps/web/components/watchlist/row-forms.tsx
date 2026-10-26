'use client';

import { startTransition, useActionState, useState } from 'react';
import { EXCHANGES, EXCHANGE_LABELS } from '@stoktok/core';
import type { Exchange } from '@stoktok/core';
import type { ExchangeFormState, RemoveWatchState } from '../../server/watchlist/handlers';
import { FormBanner, inputClass } from '../transactions/form-fields';

export type RemoveWatchAction = () => Promise<RemoveWatchState>;
export type SetExchangeAction = (prev: ExchangeFormState, formData: FormData) => Promise<ExchangeFormState>;

export function RemoveWatchButton({ symbol, action }: { symbol: string; action: RemoveWatchAction }) {
  const [state, run, pending] = useActionState<RemoveWatchState>(() => action(), { ok: true });
  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        aria-label={`Bỏ theo dõi ${symbol}`}
        onClick={() => startTransition(() => run())}
        className="text-fg-muted min-h-11 text-xs underline disabled:opacity-60 md:min-h-0"
      >
        Bỏ theo dõi
      </button>
      {!state.ok && <FormBanner error={state.formError} />}
    </span>
  );
}

export function ExchangeForm({
  symbol,
  exchange,
  action,
}: {
  symbol: string;
  exchange: Exchange | null;
  action: SetExchangeAction;
}) {
  const [value, setValue] = useState<string>(exchange ?? '');
  const [state, formAction, pending] = useActionState<ExchangeFormState, FormData>(action, {
    ok: false,
    fieldErrors: {},
    values: { exchange: exchange ?? '' },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="flex flex-col gap-1"
    >
      <span className="flex items-center gap-2">
        <select
          name="exchange"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`Sàn của ${symbol}`}
          className={`${inputClass} w-28`}
        >
          <option value="">Chưa rõ</option>
          {EXCHANGES.map((x) => (
            <option key={x} value={x}>
              {EXCHANGE_LABELS[x]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className="min-h-11 text-sm underline disabled:opacity-60 md:min-h-0">
          Lưu
        </button>
      </span>
      {!state.ok && (
        <>
          <FormBanner error={state.formError} />
          {state.fieldErrors.exchange && <FormBanner error={state.fieldErrors.exchange} />}
        </>
      )}
    </form>
  );
}

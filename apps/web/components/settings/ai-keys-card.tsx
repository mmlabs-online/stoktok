'use client';

import { aiKeyMessage, aiKeySuccessMessage } from '@stoktok/core';
import type { AiKeyActionState, AiKeyRow } from '@stoktok/core';
import { AlertTriangle, Ban, Check } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { inputClass, primaryButtonClass } from '../transactions/form-fields';

export type AiKeyAction = (prev: AiKeyActionState | null, fd: FormData) => Promise<AiKeyActionState>;
export type AiKeyRowsRead = { ok: true; rows: AiKeyRow[] } | { ok: false };

const cardClass = 'bg-surface border-border space-y-4 rounded-lg border p-4';
const ghostButtonClass = 'border-border inline-flex min-h-11 items-center justify-center rounded-lg border px-4 font-medium';

/** Plain props only: the card never sees a key, only last4, the date and booleans. */
export function AiKeysCard({ read, saveAction, deleteAction }: { read: AiKeyRowsRead; saveAction: AiKeyAction; deleteAction: AiKeyAction }) {
  return (
    <section className={`${cardClass} max-w-2xl`} aria-labelledby="ai-keys-title">
      <div>
        <h2 id="ai-keys-title" className="text-base font-semibold">
          Khóa AI
        </h2>
        <p className="text-fg-muted text-sm">
          Khóa được mã hóa trên máy chủ và không bao giờ hiển thị lại. Khóa lưu ở đây được ưu tiên hơn khóa trên máy chủ.
        </p>
      </div>
      {read.ok ? (
        <ul className="space-y-4">
          {read.rows.map((row) => (
            <li key={row.provider}>
              <AiKeyRowForm row={row} saveAction={saveAction} deleteAction={deleteAction} />
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="text-warn flex items-center gap-2 text-sm">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          Không đọc được trạng thái khóa AI. Thử tải lại trang.
        </p>
      )}
    </section>
  );
}

function AiKeyRowForm({ row, saveAction, deleteAction }: { row: AiKeyRow; saveAction: AiKeyAction; deleteAction: AiKeyAction }) {
  const [saveState, onSaveAction, savePending] = useActionState(saveAction, null);
  const [confirming, setConfirming] = useState(false);
  const [deleteState, onDeleteAction, deletePending] = useActionState(async (prev: AiKeyActionState | null, fd: FormData) => {
    const result = await deleteAction(prev, fd);
    setConfirming(false);
    return result;
  }, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the key input after every result, success or error.
  useEffect(() => {
    formRef.current?.reset();
  }, [saveState]);

  return (
    <AiKeyRowView
      row={row}
      saveState={saveState}
      deleteState={deleteState}
      confirming={confirming}
      savePending={savePending}
      deletePending={deletePending}
      formRef={formRef}
      onSaveAction={onSaveAction}
      onDeleteAction={onDeleteAction}
      onAskDelete={() => setConfirming(true)}
      onCancelDelete={() => setConfirming(false)}
    />
  );
}

export function AiKeyRowView({
  row,
  saveState,
  deleteState,
  confirming,
  savePending,
  deletePending,
  formRef,
  onSaveAction,
  onDeleteAction,
  onAskDelete,
  onCancelDelete,
}: {
  row: AiKeyRow;
  saveState: AiKeyActionState | null;
  deleteState: AiKeyActionState | null;
  confirming: boolean;
  savePending: boolean;
  deletePending: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  onSaveAction: (fd: FormData) => void;
  onDeleteAction: (fd: FormData) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { provider, label } = row;
  const inputId = `ai-key-${provider}`;
  const msgId = `ai-key-msg-${provider}`;
  const saveError = saveState && !saveState.ok;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <Status row={row} />
      <form ref={formRef} action={onSaveAction} className="space-y-2">
        <input type="hidden" name="provider" value={provider} />
        <label htmlFor={inputId} className="block text-sm font-medium">
          Khóa API {label}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            name="key"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
            placeholder="Dán khóa API"
            aria-invalid={saveError ? true : undefined}
            aria-describedby={msgId}
            className={`${inputClass} flex-1`}
          />
          <button type="submit" disabled={savePending} aria-busy={savePending} className={`${primaryButtonClass} min-h-11`}>
            {savePending ? 'Đang lưu…' : row.state === 'ui' ? 'Thay khóa' : 'Lưu khóa'}
          </button>
        </div>
      </form>
      <div id={msgId}>
        <Result state={saveState} op="save" />
        <Result state={deleteState} op="delete" />
      </div>
      {row.state === 'ui' &&
        (confirming ? (
          <form action={onDeleteAction} data-testid={`ai-key-delete-form-${provider}`} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="provider" value={provider} />
            <p className="text-sm">
              Xóa khóa {label}? {row.envFallback ? 'AI sẽ quay về khóa trên máy chủ.' : `AI dùng ${label} sẽ tắt.`}
            </p>
            <button type="submit" disabled={deletePending} autoFocus aria-label={`Xác nhận xóa khóa ${label}`} className={ghostButtonClass}>
              Xóa
            </button>
            <button type="button" onClick={onCancelDelete} className={ghostButtonClass}>
              Hủy
            </button>
          </form>
        ) : (
          <button type="button" onClick={onAskDelete} aria-label={`Xóa khóa ${label}`} className={ghostButtonClass}>
            Xóa
          </button>
        ))}
    </div>
  );
}

function Status({ row }: { row: AiKeyRow }) {
  if (row.state === 'none') {
    return (
      <p className="text-fg-muted flex items-center gap-2 text-sm">
        <Ban aria-hidden="true" className="size-4 shrink-0" />
        Chưa có khóa — AI tắt
      </p>
    );
  }
  if (row.state === 'env') {
    return (
      <p className="text-fg-muted flex items-center gap-2 text-sm">
        <Check aria-hidden="true" className="size-4 shrink-0" />
        <span>Đang dùng khóa trên máy chủ. Khóa từ biến môi trường máy chủ, không xóa tại đây.</span>
      </p>
    );
  }
  return (
    <p className="text-fg-muted flex items-center gap-2 text-sm">
      <Check aria-hidden="true" className="size-4 shrink-0" />
      <span>
        Đã lưu — kết thúc bằng <span aria-hidden="true">••••</span>
        {row.last4} · lưu ngày {row.savedOn}
        {row.envFallback && ' · Khóa này được ưu tiên hơn khóa trên máy chủ.'}
      </span>
    </p>
  );
}

function Result({ state, op }: { state: AiKeyActionState | null; op: 'save' | 'delete' }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p role="alert" className="text-price-down text-sm">
        {aiKeyMessage(state.code, op)}
      </p>
    );
  }
  if (state.provider && ('deleted' in state ? op === 'delete' : op === 'save')) {
    return (
      <p role="status" className="text-sm">
        {aiKeySuccessMessage(state.provider, op)}
      </p>
    );
  }
  return null;
}

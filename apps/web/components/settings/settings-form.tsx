'use client';

import {
  CASH_DIVIDEND_TREATMENTS,
  EXCHANGES,
  EXCHANGE_LABELS,
  SIGNAL_RULE_CARD_NOTE,
  SIGNAL_RULE_CARD_TITLE,
  SIGNAL_RULE_SECTIONS,
} from '@stoktok/core';
import type { SettingsField } from '@stoktok/core';
import type { ReactNode } from 'react';
import { startTransition, useActionState, useState } from 'react';
import type { SettingsFormState } from '../../server/settings/handlers';
import type { FormMessage } from '../../server/transactions/handlers';
import { HolidayCalendarCard } from './holiday-calendar-card';
import { Field, FormBanner, describedBy, inputClass, primaryButtonClass } from '../transactions/form-fields';

export type SettingsAction = (prev: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

const cardClass = 'bg-surface border-border space-y-4 rounded-lg border p-4';

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={cardClass}>
      <div>
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="text-fg-muted text-xs">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function ValueField({
  name,
  label,
  defaultValue,
  error,
  help,
  mode,
  placeholder,
}: {
  name: SettingsField;
  label: string;
  defaultValue: string;
  error?: FormMessage;
  help?: string;
  mode: 'decimal' | 'numeric';
  placeholder?: string;
}) {
  return (
    <Field name={name} label={label} error={error} help={help}>
      <input
        id={name}
        name={name}
        type="text"
        inputMode={mode}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, help)}
        className={inputClass}
      />
    </Field>
  );
}

export function SettingsForm({
  action,
  initial,
  feeConfigured,
  isDefault,
  saved,
  concentrationDefault,
  savedHolidays,
  currentYear,
}: {
  action: SettingsAction;
  initial: SettingsFormState;
  feeConfigured: boolean;
  isDefault: boolean;
  saved: boolean;
  concentrationDefault: string;
  savedHolidays: string[];
  currentYear: number;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const [resetKey, setResetKey] = useState(0);
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
      // Native reset restores the inputs; the keyed card remounts to drop unsaved holiday edits.
      onReset={() => setResetKey((k) => k + 1)}
      className="max-w-2xl space-y-4 pb-24"
    >
      {saved && (
        <p role="status" className="border-price-up text-price-up rounded-lg border p-3 text-sm">
          Đã lưu cài đặt.
        </p>
      )}
      {isDefault && (
        <p role="status" className="border-border text-fg-muted rounded-lg border p-3 text-sm">
          Đang dùng giá trị mặc định — chưa lưu
        </p>
      )}
      <FormBanner error={state.formError} />

      <Card title="Phí & thuế">
        <ValueField
          name="feeRate"
          label="Phí giao dịch (%)"
          mode="decimal"
          defaultValue={values.feeRate}
          error={errors.feeRate}
          help={feeConfigured ? 'Kiểm tra lại biểu phí TCBS hiện tại' : 'Chưa cấu hình. Kiểm tra lại biểu phí TCBS hiện tại'}
        />
        <ValueField name="sellTaxRate" label="Thuế bán (%)" mode="decimal" defaultValue={values.sellTaxRate} error={errors.sellTaxRate} />
      </Card>

      <Card title="Quy tắc thị trường" note="Cấu hình — xác minh với quy định sàn hiện hành">
        <div className="grid gap-4 sm:grid-cols-3">
          {EXCHANGES.map((x) => {
            const name = `priceLimit${x}` as const;
            return (
              <ValueField
                key={x}
                name={name}
                label={`Biên độ ${EXCHANGE_LABELS[x]} (%)`}
                mode="decimal"
                defaultValue={values[name]}
                error={errors[name]}
              />
            );
          })}
        </div>
        <ValueField
          name="settlementDays"
          label="Số ngày thanh toán (T+)"
          mode="numeric"
          defaultValue={values.settlementDays}
          error={errors.settlementDays}
          help="Cổ phiếu mua được bán từ T+N; thay đổi áp dụng cho toàn bộ sổ giao dịch"
        />
        <ValueField name="lotSize" label="Lô giao dịch (cổ phiếu)" mode="numeric" defaultValue={values.lotSize} error={errors.lotSize} />
      </Card>

      <HolidayCalendarCard
        key={`${resetKey}:${values.holidays}`}
        savedHolidays={savedHolidays}
        initialHolidays={values.holidays}
        currentYear={currentYear}
        error={errors.holidays}
      />

      <Card title="Danh mục">
        <ValueField
          name="concentrationThreshold"
          label="Ngưỡng cảnh báo tỷ trọng (%)"
          mode="decimal"
          placeholder={concentrationDefault}
          defaultValue={values.concentrationThreshold}
          error={errors.concentrationThreshold}
          help={`Để trống = mặc định ${concentrationDefault}%`}
        />
        <fieldset
          className="space-y-2"
          aria-invalid={errors.cashDividendTreatment ? true : undefined}
          aria-describedby={describedBy('cashDividendTreatment', errors.cashDividendTreatment, 'warn')}
        >
          <legend className="text-sm font-medium">Cổ tức tiền mặt</legend>
          {CASH_DIVIDEND_TREATMENTS.map((t) => (
            <label key={t.value} className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="radio"
                name="cashDividendTreatment"
                value={t.value}
                defaultChecked={values.cashDividendTreatment === t.value}
                className="mt-1 size-5"
              />
              <span>
                <span className="block font-medium">{t.label}</span>
                <span className="text-fg-muted block text-xs">{t.explanation}</span>
              </span>
            </label>
          ))}
          <p id="cashDividendTreatment-warn" className="text-fg-muted text-xs">
            Thay đổi cách xử lý sẽ tính lại lãi/lỗ cho toàn bộ lịch sử.
          </p>
          {errors.cashDividendTreatment && (
            <p id="cashDividendTreatment-error" role="alert" className="text-price-down text-sm">
              {errors.cashDividendTreatment.message}
            </p>
          )}
        </fieldset>
      </Card>

      <Card title={SIGNAL_RULE_CARD_TITLE} note={SIGNAL_RULE_CARD_NOTE}>
        {SIGNAL_RULE_SECTIONS.map((section) => (
          <fieldset key={section.key} className="border-border space-y-4 border-t pt-4 first:border-t-0 first:pt-0">
            <legend className="text-sm font-semibold">{section.legend}</legend>
            {section.enabledField && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={section.enabledField}
                  defaultChecked={values[section.enabledField] === 'on'}
                  className="size-5"
                />
                Bật
              </label>
            )}
            {section.note && <p className="text-fg-muted text-xs">{section.note}</p>}
            {section.rows.map((row) => (
              <div key={row.map((f) => f.name).join()} className={row.length > 1 ? 'grid gap-4 sm:grid-cols-2' : undefined}>
                {row.map((f) => (
                  <ValueField
                    key={f.name}
                    name={f.name}
                    label={f.label}
                    help={f.help}
                    mode={f.mode}
                    defaultValue={values[f.name]}
                    error={errors[f.name]}
                  />
                ))}
              </div>
            ))}
          </fieldset>
        ))}
      </Card>

      <div className="bg-bg border-border sticky bottom-0 flex gap-3 border-t p-3 pb-[env(safe-area-inset-bottom)]">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          Lưu thay đổi
        </button>
        <button
          type="reset"
          className="border-border inline-flex min-h-11 items-center justify-center rounded-lg border px-4 font-medium"
        >
          Hủy
        </button>
      </div>
    </form>
  );
}

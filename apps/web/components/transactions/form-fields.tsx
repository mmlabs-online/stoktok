import type { ReactNode } from 'react';
import type { FormMessage } from '../../server/transactions/handlers';

export const inputClass =
  'bg-surface border-border text-fg min-h-11 w-full rounded-lg border px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-accent';
export const primaryButtonClass =
  'bg-accent text-bg inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-medium disabled:opacity-60';
export const secondaryLinkClass =
  'border-border inline-flex min-h-11 items-center justify-center rounded-lg border px-4 font-medium hover:underline';

/** Space-separated ids for aria-describedby. */
export function describedBy(name: string, error?: FormMessage, help?: string): string | undefined {
  const ids = [help ? `${name}-help` : '', error ? `${name}-error` : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function Field({
  name,
  label,
  error,
  help,
  children,
}: {
  name: string;
  label: string;
  error?: FormMessage;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {help && (
        <p id={`${name}-help`} className="text-fg-muted text-xs">
          {help}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-price-down text-sm">
          {error.message}
        </p>
      )}
    </div>
  );
}

export function TextField({
  name,
  label,
  defaultValue,
  error,
  help,
  type = 'text',
  inputMode,
  max,
}: {
  name: string;
  label: string;
  defaultValue: string;
  error?: FormMessage;
  help?: string;
  type?: 'text' | 'date';
  inputMode?: 'numeric';
  max?: string;
}) {
  return (
    <Field name={name} label={label} error={error} help={help}>
      <input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        max={max}
        defaultValue={defaultValue}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, help)}
        className={inputClass}
      />
    </Field>
  );
}

export function CheckField({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-5" />
      {label}
    </label>
  );
}

export function FormBanner({ error }: { error?: FormMessage }) {
  if (!error) return null;
  return (
    <p role="alert" className="border-price-down text-price-down rounded-lg border p-3 text-sm">
      {error.message}
    </p>
  );
}

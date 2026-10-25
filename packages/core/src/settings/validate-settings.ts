import type { LedgerSettings } from '../ledger/types';
import { formatQuantity } from '../format';
import type { EntryError } from '../entry/messages-vi';
import { formatRatePercentInput, parseIntegerInput, parseRatePercentInput } from '../entry/parse-input';
import { DEFAULT_CONCENTRATION_THRESHOLD_PPM } from '../portfolio/config';
import { EXCHANGES } from './market-rules';
import type { Exchange, MarketRules } from './market-rules';

export interface SettingsFormRaw {
  feeRate: string;
  sellTaxRate: string;
  priceLimitHOSE: string;
  priceLimitHNX: string;
  priceLimitUPCOM: string;
  settlementDays: string;
  lotSize: string;
  concentrationThreshold: string;
  cashDividendTreatment: string;
}

export type SettingsField = keyof SettingsFormRaw;

export interface SettingsInput {
  feeRatePpm: number | null;
  sellTaxRatePpm: number;
  settlementDays: number;
  lotSize: number;
  priceLimitPpm: Record<Exchange, number>;
  concentrationThresholdPpm: number | null;
  cashDividendTreatment: 'reduceCost' | 'income';
}

/** Stored settings as the settings screen sees them (fee and concentration may be unset). */
export interface AppSettings extends Omit<LedgerSettings, 'feeRatePpm'> {
  feeRatePpm: number | null;
  concentrationThresholdPpm: number | null;
  marketRules: MarketRules;
}

/** Validation bounds for the form (sanity limits, not market rules). Rates in ppm. */
export const SETTINGS_BOUNDS = {
  feeRatePpm: { min: 0, max: 50_000 },
  sellTaxRatePpm: { min: 0, max: 50_000 },
  priceLimitPpm: { min: 10_000, max: 300_000 },
  concentrationThresholdPpm: { min: 10_000, max: 1_000_000 },
  settlementDays: { min: 0, max: 5 },
  lotSize: { min: 1, max: 10_000 },
} as const;

export const CASH_DIVIDEND_TREATMENTS = [
  { value: 'reduceCost', label: 'Giảm giá vốn', explanation: 'Cổ tức tiền mặt (sau thuế) được trừ vào giá vốn cổ phiếu đang giữ.' },
  { value: 'income', label: 'Ghi nhận thu nhập', explanation: 'Cổ tức tiền mặt (sau thuế) được ghi nhận là thu nhập, giá vốn không đổi.' },
] as const;

type Bounds = { min: number; max: number };

const percentRange = (b: Bounds): EntryError => ({
  code: 'OUT_OF_RANGE',
  params: { min: `${formatRatePercentInput(b.min)}%`, max: `${formatRatePercentInput(b.max)}%` },
});

const intRange = (b: Bounds): EntryError => ({
  code: 'OUT_OF_RANGE',
  params: { min: formatQuantity(b.min), max: formatQuantity(b.max) },
});

function readPercent(text: string, b: Bounds, blank: 'null' | 'required'): { value: number | null } | { error: EntryError } {
  if (blank === 'null' && text.trim() === '') return { value: null };
  const r = parseRatePercentInput(text, { maxPpm: b.max });
  if (r.ok) return r.ppm < b.min ? { error: percentRange(b) } : { value: r.ppm };
  switch (r.code) {
    case 'NEGATIVE':
    case 'TOO_LARGE':
      return { error: percentRange(b) };
    case 'INVALID':
      return { error: { code: 'PERCENT_INVALID' } };
    case 'TOO_PRECISE':
      return { error: { code: 'PERCENT_TOO_PRECISE' } };
    case 'REQUIRED':
      return { error: { code: 'REQUIRED' } };
  }
}

function readInteger(text: string, b: Bounds): { value: number } | { error: EntryError } {
  const r = parseIntegerInput(text, { max: b.max });
  if (!r.ok) {
    if (r.code === 'NOT_INTEGER') {
      return { error: text.trim().startsWith('-') ? intRange(b) : { code: 'WHOLE_NUMBER_INVALID' } };
    }
    return { error: r.code === 'TOO_LARGE' ? intRange(b) : { code: r.code } };
  }
  return r.value < b.min ? { error: intRange(b) } : { value: r.value };
}

export type ValidateSettingsResult =
  | { ok: true; value: SettingsInput }
  | { ok: false; errors: Partial<Record<SettingsField, EntryError>> };

/** Validates the settings form and converts it to ppm/integers. All errors are reported together. */
export function validateSettingsInput(raw: SettingsFormRaw): ValidateSettingsResult {
  const errors: Partial<Record<SettingsField, EntryError>> = {};
  const B = SETTINGS_BOUNDS;

  const fee = readPercent(raw.feeRate, B.feeRatePpm, 'null');
  if ('error' in fee) errors.feeRate = fee.error;
  const tax = readPercent(raw.sellTaxRate, B.sellTaxRatePpm, 'required');
  if ('error' in tax) errors.sellTaxRate = tax.error;
  const concentration = readPercent(raw.concentrationThreshold, B.concentrationThresholdPpm, 'null');
  if ('error' in concentration) errors.concentrationThreshold = concentration.error;

  const limits = {} as Record<Exchange, number>;
  for (const x of EXCHANGES) {
    const field = `priceLimit${x}` as const;
    const r = readPercent(raw[field], B.priceLimitPpm, 'required');
    if ('error' in r) errors[field] = r.error;
    else limits[x] = r.value as number;
  }

  const days = readInteger(raw.settlementDays, B.settlementDays);
  if ('error' in days) errors.settlementDays = days.error;
  const lot = readInteger(raw.lotSize, B.lotSize);
  if ('error' in lot) errors.lotSize = lot.error;

  const treatment = CASH_DIVIDEND_TREATMENTS.find((t) => t.value === raw.cashDividendTreatment);
  if (!treatment) errors.cashDividendTreatment = { code: 'TREATMENT_INVALID' };

  if (Object.keys(errors).length > 0 || 'error' in fee || 'error' in tax || 'error' in concentration || 'error' in days || 'error' in lot || !treatment) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      feeRatePpm: fee.value,
      sellTaxRatePpm: tax.value as number,
      settlementDays: days.value,
      lotSize: lot.value,
      priceLimitPpm: limits,
      concentrationThresholdPpm: concentration.value,
      cashDividendTreatment: treatment.value,
    },
  };
}

export function settingsToFormValues(s: AppSettings): SettingsFormRaw {
  const pct = (ppm: number | null) => (ppm === null ? '' : formatRatePercentInput(ppm));
  return {
    feeRate: pct(s.feeRatePpm),
    sellTaxRate: pct(s.sellTaxRatePpm),
    priceLimitHOSE: pct(s.marketRules.priceLimitPpm.HOSE),
    priceLimitHNX: pct(s.marketRules.priceLimitPpm.HNX),
    priceLimitUPCOM: pct(s.marketRules.priceLimitPpm.UPCOM),
    settlementDays: String(s.settlementDays),
    lotSize: String(s.marketRules.lotSize),
    concentrationThreshold: pct(s.concentrationThresholdPpm),
    cashDividendTreatment: s.cashDividendTreatment,
  };
}

/** Default concentration threshold as percent text ("20"), for the placeholder. */
export function concentrationDefaultText(): string {
  return formatRatePercentInput(DEFAULT_CONCENTRATION_THRESHOLD_PPM);
}

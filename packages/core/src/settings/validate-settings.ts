import type { LedgerSettings } from '../ledger/types';
import type { EntryError } from '../entry/messages-vi';
import { formatRatePercentInput } from '../entry/parse-input';
import { DEFAULT_CONCENTRATION_THRESHOLD_PPM } from '../portfolio/config';
import type { SignalRules } from '../signals/config';
import { parseHolidayList, userHolidayDates } from '../market/holiday-editor';
import { readInteger, readPercent } from './read-fields';
import { EXCHANGES } from './market-rules';
import type { Exchange, MarketRules } from './market-rules';
import { signalRulesToFormValues, validateSignalRulesInput } from './signal-rules-form';
import type { SignalRulesFormRaw } from './signal-rules-form';

export interface SettingsFormRaw extends SignalRulesFormRaw {
  feeRate: string;
  sellTaxRate: string;
  priceLimitHOSE: string;
  priceLimitHNX: string;
  priceLimitUPCOM: string;
  settlementDays: string;
  lotSize: string;
  concentrationThreshold: string;
  cashDividendTreatment: string;
  /** Comma-separated 'YYYY-MM-DD' dates the user added (never the seeded calendar). */
  holidays: string;
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
  signalRules: SignalRules;
  holidays: string[];
}

/** Stored settings as the settings screen sees them (fee and concentration may be unset). */
export interface AppSettings extends Omit<LedgerSettings, 'feeRatePpm'> {
  feeRatePpm: number | null;
  concentrationThresholdPpm: number | null;
  marketRules: MarketRules;
  signalRules: SignalRules;
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

  const holidays = parseHolidayList(raw.holidays);
  if (!holidays.ok) errors.holidays = holidays.error;

  const signals = validateSignalRulesInput(raw);
  if (!signals.ok) Object.assign(errors, signals.errors);

  if (!signals.ok || !holidays.ok || Object.keys(errors).length > 0 || 'error' in fee || 'error' in tax || 'error' in concentration || 'error' in days || 'error' in lot || !treatment) {
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
      signalRules: signals.value,
      holidays: holidays.value,
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
    holidays: userHolidayDates(s.holidays).join(','),
    ...signalRulesToFormValues(s.signalRules),
  };
}

/** Default concentration threshold as percent text ("20"), for the placeholder. */
export function concentrationDefaultText(): string {
  return formatRatePercentInput(DEFAULT_CONCENTRATION_THRESHOLD_PPM);
}

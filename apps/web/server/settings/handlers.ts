import { validateSettingsInput } from '@stoktok/core';
import type { SettingsFormRaw } from '@stoktok/core';
import { DataError, saveAppSettings } from '../db';
import type { Db } from '../db';
import { failForm, fieldErrors } from '../transactions/handlers';
import type { FormState } from '../transactions/handlers';

/**
 * FormData -> raw strings -> core validation -> repo.
 * R6 is suspended: when it is restored, call requireUser() before getDb() in the caller.
 */

export type SettingsFormState = FormState<SettingsFormRaw>;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '');

export function readSettingsForm(fd: FormData): SettingsFormRaw {
  return {
    feeRate: str(fd, 'feeRate'),
    sellTaxRate: str(fd, 'sellTaxRate'),
    priceLimitHOSE: str(fd, 'priceLimitHOSE'),
    priceLimitHNX: str(fd, 'priceLimitHNX'),
    priceLimitUPCOM: str(fd, 'priceLimitUPCOM'),
    settlementDays: str(fd, 'settlementDays'),
    lotSize: str(fd, 'lotSize'),
    concentrationThreshold: str(fd, 'concentrationThreshold'),
    cashDividendTreatment: str(fd, 'cashDividendTreatment'),
    peEnabled: str(fd, 'peEnabled'),
    peMinPeers: str(fd, 'peMinPeers'),
    peDiscount: str(fd, 'peDiscount'),
    pePremium: str(fd, 'pePremium'),
    pbEnabled: str(fd, 'pbEnabled'),
    pbMinPeers: str(fd, 'pbMinPeers'),
    pbDiscount: str(fd, 'pbDiscount'),
    pbPremium: str(fd, 'pbPremium'),
    growthEnabled: str(fd, 'growthEnabled'),
    growthComparisons: str(fd, 'growthComparisons'),
    growthMinConsecutive: str(fd, 'growthMinConsecutive'),
    growthThreshold: str(fd, 'growthThreshold'),
    growthMinBase: str(fd, 'growthMinBase'),
    maEnabled: str(fd, 'maEnabled'),
    maShortDays: str(fd, 'maShortDays'),
    maLongDays: str(fd, 'maLongDays'),
    maNeutralBand: str(fd, 'maNeutralBand'),
    financialsMaxFetchAgeDays: str(fd, 'financialsMaxFetchAgeDays'),
  };
}

export async function handleSaveSettings(db: Db, formData: FormData): Promise<SettingsFormState> {
  const values = readSettingsForm(formData);
  const v = validateSettingsInput(values);
  if (!v.ok) return { ok: false, fieldErrors: fieldErrors(v.errors), values };
  try {
    await saveAppSettings(db, v.value);
    return { ok: true };
  } catch (e) {
    if (!(e instanceof DataError)) throw e;
    return failForm(values, 'SAVE_FAILED');
  }
}

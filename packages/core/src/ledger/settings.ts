import { applyRatePpm, mulDiv } from '../money';
import type { LedgerSettings } from './types';

/** Market defaults (verify before go-live). The fee rate is a user setting and has no default. */
export const DEFAULT_MARKET_SETTINGS: Omit<LedgerSettings, 'feeRatePpm'> = {
  settlementDays: 2,
  sellTaxRatePpm: 1000,
  dividendWithholdingRatePpm: 50000,
  cashDividendTreatment: 'reduceCost',
  costMethod: 'WAC',
  holidays: [],
};

export function estimateFees(
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  settings: Pick<LedgerSettings, 'feeRatePpm' | 'sellTaxRatePpm'>,
): { fee: number; tax: number } {
  const value = mulDiv(quantity, price, 1);
  return {
    fee: applyRatePpm(value, settings.feeRatePpm),
    tax: side === 'sell' ? applyRatePpm(value, settings.sellTaxRatePpm) : 0,
  };
}

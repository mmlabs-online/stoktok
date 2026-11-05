import { applyRatePpm } from '../money';
import type { TaxRule } from './types';

/** Latest schedule entry in force on drawDate ('YYYY-MM-DD'). Schedule sorted, earliest first. */
export function taxRuleFor(schedule: TaxRule[], drawDate: string): TaxRule {
  let found: TaxRule | undefined;
  for (const rule of schedule) {
    if (rule.effectiveFrom === null || rule.effectiveFrom <= drawDate) found = rule;
  }
  if (!found) throw new RangeError(`no tax rule in force on ${drawDate}`);
  return found;
}

export function prizeTax(grossVnd: number, rule: TaxRule): number {
  return applyRatePpm(Math.max(0, grossVnd - rule.thresholdVnd), rule.ratePpm);
}

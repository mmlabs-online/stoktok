import { vnDateOf } from '../calendar';
import { AI_CONFIG, type AiConfig } from './config';

export type BudgetLevel = 'ok' | 'warn' | 'exhausted';

export interface BudgetWindow {
  fromTs: string;
  toTs: string;
}

export interface BudgetStatus {
  spentMicroUsd: number;
  capMicroUsd: number;
  remainingMicroUsd: number;
  percent: number;
  level: BudgetLevel;
}

/** Calendar month in Asia/Ho_Chi_Minh (fixed +07:00, no DST) as [fromTs, toTs) UTC instants. */
export function aiBudgetWindow(now: Date): BudgetWindow {
  const [y, m] = vnDateOf(now).split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = (year: number, month: number) => new Date(`${year}-${pad(month)}-01T00:00:00+07:00`).toISOString();
  return { fromTs: start(y, m), toTs: m === 12 ? start(y + 1, 1) : start(y, m + 1) };
}

export function budgetLevel(spentMicroUsd: number, cfg: AiConfig = AI_CONFIG): BudgetLevel {
  const { capMicroUsd, warnPpm } = cfg.budget;
  if (spentMicroUsd >= capMicroUsd) return 'exhausted';
  if (BigInt(spentMicroUsd) * 1_000_000n >= BigInt(capMicroUsd) * BigInt(warnPpm)) return 'warn';
  return 'ok';
}

/** Mirrors the SQL gate in ai_reserve: refuse when spent >= cap or spent + reserve > cap. */
export function fitsBudget(spentMicroUsd: number, reserveMicroUsd: number, capMicroUsd: number): boolean {
  return spentMicroUsd < capMicroUsd && spentMicroUsd + reserveMicroUsd <= capMicroUsd;
}

export function budgetStatus(spentMicroUsd: number, cfg: AiConfig = AI_CONFIG): BudgetStatus {
  const cap = cfg.budget.capMicroUsd;
  return {
    spentMicroUsd,
    capMicroUsd: cap,
    remainingMicroUsd: Math.max(0, cap - spentMicroUsd),
    percent: Math.floor((spentMicroUsd * 100) / cap),
    level: budgetLevel(spentMicroUsd, cfg),
  };
}

export interface AiBudgetMeter {
  /** 0-100, clamped. */
  fillPercent: number;
  /** Position of the warn mark on the 0-100 scale. */
  warnPercent: number;
  /** "MM/YYYY" in Vietnam time. */
  monthLabel: string;
}

/** Display geometry for the usage meter; the warn mark comes from config (R5). */
export function aiBudgetMeter(status: BudgetStatus, now: Date, cfg: AiConfig = AI_CONFIG): AiBudgetMeter {
  const [y, m] = vnDateOf(now).split('-') as [string, string];
  return {
    fillPercent: Math.min(Math.max(status.percent, 0), 100),
    warnPercent: cfg.budget.warnPpm / 10_000,
    monthLabel: `${m}/${y}`,
  };
}

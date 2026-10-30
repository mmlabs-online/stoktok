/** Distance of the latest close from its N-day simple moving average. Pure. */
import { PPM, mulDiv, roundDiv } from '../money';
import { checkLatestPrice, checkPriceWindow, finalizeResult, gapSnapshotRef, priceRef } from './inputs';
import { checkRawPriceWindow } from './raw-price-guard';
import { maRuleId } from './types';
import type { ReasonCode, RuleContext, SignalLabel, SignalResult, SymbolData } from './types';

export function priceVsMa(symbol: string, data: SymbolData, days: number, ctx: RuleContext): SignalResult {
  const params = ctx.rules.priceVsMa;
  const latest = checkLatestPrice(data.closes, ctx.signalDate);
  const win = checkPriceWindow({
    symbol,
    closes: data.closes,
    days,
    signalDate: ctx.signalDate,
    holidays: ctx.holidays,
    gaps: ctx.priceGaps,
  });
  const reasons: ReasonCode[] = [...latest.reasons, ...win.reasons];
  const bars = win.window;
  let guard: ReturnType<typeof checkRawPriceWindow> | null = null;
  if (bars.length > 0) {
    guard = checkRawPriceWindow({
      symbol,
      window: bars,
      exchange: data.exchange,
      priceLimitPpm: ctx.priceLimitPpm,
      actions: data.corporateActions,
      holidays: ctx.holidays,
    });
    reasons.push(...guard.reasons);
  }
  let label: SignalLabel | null = null;
  let value: number | null = null;
  let ma: number | null = null;

  if (reasons.length === 0) {
    const close = (bars[bars.length - 1] as { close: number }).close;
    const sum = bars.reduce((s, b) => s + BigInt(b.close), 0n);
    ma = Number(roundDiv(sum, BigInt(days)));
    value = mulDiv(close - ma, PPM, ma);
    label = value >= params.neutralBandPpm ? 'bullish' : value <= -params.neutralBandPpm ? 'bearish' : 'neutral';
  }

  const fetched = bars.map((b) => b.fetchedAt).sort();
  return finalizeResult({
    symbol,
    ruleId: maRuleId(days),
    signalDate: ctx.signalDate,
    reasons,
    label,
    value,
    inputs: {
      refs: [...(latest.latest ? [priceRef(latest.latest)] : []), ...win.gaps.map(gapSnapshotRef), ...(guard?.actionRefs ?? [])],
      params: { days, neutralBandPpm: params.neutralBandPpm },
      window: {
        table: 'prices_daily',
        symbol,
        fromDate: bars[0]?.tradeDate ?? null,
        toDate: bars[bars.length - 1]?.tradeDate ?? null,
        count: bars.length,
        closes: bars.map((b) => b.close),
        sources: [...new Set(bars.map((b) => b.source))].sort(),
        minFetchedAt: fetched[0] ?? null,
        maxFetchedAt: fetched[fetched.length - 1] ?? null,
      },
      guard: guard === null ? null : { exchange: guard.exchange, exchangeUnknown: guard.exchangeUnknown, limitPpmUsed: guard.limitPpmUsed, jumps: guard.jumps },
      ma,
      missingDates: win.missingDates,
    },
  });
}

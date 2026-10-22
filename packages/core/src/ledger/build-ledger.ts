import { addTradingDays, isValidDate } from '../calendar';
import { applyRatePpm, isVnd, mulDiv, roundDiv } from '../money';
import { estimateFees } from './settings';
import type {
  CorporateAction,
  Holding,
  Ledger,
  LedgerError,
  LedgerSettings,
  Lot,
  Realization,
  Result,
  Transaction,
} from './types';

type OpenLot = Omit<Lot, 'status'>;

interface SymbolState {
  lots: OpenLot[];
  quantity: number;
  totalCost: number;
  realizedPnl: number;
  dividendCashNet: number;
}

type Event =
  | { kind: 'action'; date: string; seq: 0; id: string; action: CorporateAction }
  | { kind: 'trade'; date: string; seq: number; id: string; tx: Transaction };

function validate(
  transactions: readonly Transaction[],
  actions: readonly CorporateAction[],
  settings: LedgerSettings,
  asOf: string,
): LedgerError | null {
  const bad = (id: string, field: string, message: string): LedgerError => ({
    code: 'INVALID_INPUT',
    id,
    field,
    message,
  });
  if (!isValidDate(asOf)) return bad('asOf', 'asOf', 'invalid date');
  for (const f of [
    'feeRatePpm',
    'sellTaxRatePpm',
    'settlementDays',
    'dividendWithholdingRatePpm',
  ] as const) {
    if (!isVnd(settings[f]) || settings[f] < 0) return bad('settings', f, 'must be integer >= 0');
  }
  for (const h of settings.holidays) {
    if (!isValidDate(h)) return bad('settings', 'holidays', 'invalid date');
  }
  for (const t of transactions) {
    if (!t.id) return bad(String(t.id), 'id', 'required');
    if (!t.symbol) return bad(t.id, 'symbol', 'required');
    if (!Number.isInteger(t.seq)) return bad(t.id, 'seq', 'must be integer');
    if (!isValidDate(t.tradeDate)) return bad(t.id, 'tradeDate', 'invalid date');
    if (t.side !== 'buy' && t.side !== 'sell') return bad(t.id, 'side', 'must be buy or sell');
    if (!isVnd(t.quantity) || t.quantity <= 0) return bad(t.id, 'quantity', 'must be integer > 0');
    if (!isVnd(t.price) || t.price < 0) return bad(t.id, 'price', 'must be integer >= 0');
    if (t.fee !== undefined && (!isVnd(t.fee) || t.fee < 0)) return bad(t.id, 'fee', 'must be integer >= 0');
    if (t.tax !== undefined && (!isVnd(t.tax) || t.tax < 0)) return bad(t.id, 'tax', 'must be integer >= 0');
  }
  for (const a of actions) {
    if (!a.id) return bad(String(a.id), 'id', 'required');
    if (!a.symbol) return bad(a.id, 'symbol', 'required');
    if (!isValidDate(a.exDate)) return bad(a.id, 'exDate', 'invalid date');
    if (a.type === 'cash_dividend') {
      if (!isVnd(a.amountPerShare) || a.amountPerShare < 0) {
        return bad(a.id, 'amountPerShare', 'must be integer >= 0');
      }
      if (a.payDate !== undefined && !isValidDate(a.payDate)) return bad(a.id, 'payDate', 'invalid date');
    } else {
      const { held, received } = a.ratio;
      if (!isVnd(held) || held <= 0) return bad(a.id, 'ratio.held', 'must be integer > 0');
      if (!isVnd(received) || received <= 0) return bad(a.id, 'ratio.received', 'must be integer > 0');
      if (a.listingDate !== undefined && !isValidDate(a.listingDate)) {
        return bad(a.id, 'listingDate', 'invalid date');
      }
    }
  }
  return null;
}

function compareEvents(a: Event, b: Event): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'action' ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function replay(
  transactions: readonly Transaction[],
  corporateActions: readonly CorporateAction[],
  settings: LedgerSettings,
  asOf: string,
): Result<Ledger> {
  const err = validate(transactions, corporateActions, settings, asOf);
  if (err) return { ok: false, error: err };

  const events: Event[] = [
    ...transactions
      .filter((tx) => tx.tradeDate <= asOf)
      .map((tx): Event => ({ kind: 'trade', date: tx.tradeDate, seq: tx.seq, id: tx.id, tx })),
    ...corporateActions
      .filter((action) => action.exDate <= asOf)
      .map((action): Event => ({ kind: 'action', date: action.exDate, seq: 0, id: action.id, action })),
  ].sort(compareEvents);

  const states = new Map<string, SymbolState>();
  for (const t of transactions) states.set(t.symbol, emptyState());
  for (const a of corporateActions) states.set(a.symbol, states.get(a.symbol) ?? emptyState());
  const realizations: Realization[] = [];
  const settle = (date: string) => addTradingDays(date, settings.settlementDays, settings.holidays);

  for (const ev of events) {
    if (ev.kind === 'trade') {
      const { tx } = ev;
      const state = states.get(tx.symbol) as SymbolState;
      const est = estimateFees(tx.side, tx.quantity, tx.price, settings);
      const fee = tx.fee ?? est.fee;
      const value = mulDiv(tx.quantity, tx.price, 1);
      if (tx.side === 'buy') {
        const cost = value + fee;
        state.lots.push({
          id: `lot:${tx.id}`,
          symbol: tx.symbol,
          source: 'buy',
          sourceId: tx.id,
          acquiredOn: tx.tradeDate,
          quantityOriginal: tx.quantity,
          quantityRemaining: tx.quantity,
          costPerShare: mulDiv(cost, 1, tx.quantity),
          sellableFrom: settle(tx.tradeDate),
        });
        state.quantity += tx.quantity;
        state.totalCost += cost;
      } else {
        const tax = tx.tax ?? est.tax;
        const sellable = state.lots
          .filter((l) => l.sellableFrom <= tx.tradeDate)
          .reduce((sum, l) => sum + l.quantityRemaining, 0);
        if (tx.quantity > sellable) {
          return {
            ok: false,
            error: {
              code: 'OVERSELL',
              transactionId: tx.id,
              symbol: tx.symbol,
              date: tx.tradeDate,
              requested: tx.quantity,
              sellable,
            },
          };
        }
        const costRemoved =
          tx.quantity === state.quantity
            ? state.totalCost
            : mulDiv(state.totalCost, tx.quantity, state.quantity);
        const proceedsNet = value - fee - tax;
        const realizedPnl = proceedsNet - costRemoved;
        let left = tx.quantity;
        for (const lot of state.lots) {
          if (left === 0) break;
          if (lot.sellableFrom > tx.tradeDate) continue;
          const take = Math.min(left, lot.quantityRemaining);
          lot.quantityRemaining -= take;
          left -= take;
        }
        state.lots = state.lots.filter((l) => l.quantityRemaining > 0);
        state.quantity -= tx.quantity;
        state.totalCost -= costRemoved;
        state.realizedPnl += realizedPnl;
        realizations.push({
          sellTransactionId: tx.id,
          symbol: tx.symbol,
          quantity: tx.quantity,
          proceedsNet,
          costRemoved,
          realizedPnl,
        });
      }
    } else {
      const { action } = ev;
      const state = states.get(action.symbol) as SymbolState;
      if (state.quantity === 0) continue;
      if (action.type === 'cash_dividend') {
        const gross = mulDiv(state.quantity, action.amountPerShare, 1);
        const net = gross - applyRatePpm(gross, settings.dividendWithholdingRatePpm);
        state.dividendCashNet += net;
        if (settings.cashDividendTreatment === 'reduceCost') {
          const excess = Math.max(0, net - state.totalCost);
          state.totalCost -= net - excess;
          state.realizedPnl += excess;
        } else {
          state.realizedPnl += net;
        }
      } else {
        const newShares = Number(
          (BigInt(state.quantity) * BigInt(action.ratio.received)) / BigInt(action.ratio.held),
        );
        if (newShares > 0) {
          state.lots.push({
            id: `lot:${action.id}`,
            symbol: action.symbol,
            source: 'stock_dividend',
            sourceId: action.id,
            acquiredOn: action.exDate,
            quantityOriginal: newShares,
            quantityRemaining: newShares,
            costPerShare: 0,
            sellableFrom: action.listingDate ?? settle(action.exDate),
          });
          state.quantity += newShares;
        }
      }
    }
  }

  const lots: Lot[] = [];
  const holdings: Holding[] = [];
  for (const symbol of [...states.keys()].sort()) {
    const s = states.get(symbol) as SymbolState;
    let sellableQuantity = 0;
    for (const l of s.lots) {
      const status = l.sellableFrom <= asOf ? 'sellable' : 'pending';
      if (status === 'sellable') sellableQuantity += l.quantityRemaining;
      lots.push({ ...l, status });
    }
    holdings.push({
      symbol,
      quantity: s.quantity,
      sellableQuantity,
      totalCost: s.totalCost,
      averageCost:
        s.quantity > 0 ? Number(roundDiv(BigInt(s.totalCost), BigInt(s.quantity))) : null,
      realizedPnl: s.realizedPnl,
      dividendCashNet: s.dividendCashNet,
    });
  }
  return { ok: true, value: { lots, holdings, realizations } };
}

/**
 * Replays transactions and corporate actions (dated <= asOf) into lots, holdings and realizations.
 * Pure: inputs are not mutated.
 *
 * Method:
 * - Cost is a moving weighted-average (WAC) per symbol; the buy fee is part of cost.
 *   A sell removes cost proportionally (its full cost when the position is closed), so the
 *   average cost is unchanged by a sell.
 * - Sells consume lot quantities oldest-first (FIFO), but only from lots whose sellableFrom
 *   (trade date + settlementDays trading days) is on or before the sell date. Selling more than
 *   that returns an OVERSELL error.
 * - Cash dividend (on exDate, entitled = whole quantity incl. pending lots): net = gross minus
 *   withholding. 'reduceCost' lowers totalCost (excess over cost goes to realized P&L);
 *   'income' leaves cost alone and adds net to realized P&L.
 * - Stock dividend (on exDate): floor(quantity * received / held) new shares as a zero-cost lot,
 *   sellable from listingDate (or exDate + settlementDays); totalCost is unchanged.
 * - Corporate actions on a date are applied before trades of that date.
 */
export function buildLedger(
  transactions: readonly Transaction[],
  corporateActions: readonly CorporateAction[],
  settings: LedgerSettings,
  asOf: string,
): Result<Ledger> {
  try {
    return replay(transactions, corporateActions, settings, asOf);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return { ok: false, error: { code: 'INVALID_INPUT', id: 'ledger', field: 'amount', message: e.message } };
  }
}

function emptyState(): SymbolState {
  return { lots: [], quantity: 0, totalCost: 0, realizedPnl: 0, dividendCashNet: 0 };
}

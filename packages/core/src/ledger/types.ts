export interface Transaction {
  id: string;
  /** Tie-break for transactions on the same date. */
  seq: number;
  tradeDate: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  /** Integer VND per share. */
  price: number;
  /** Entered fee (VND). Falls back to the settings estimate when absent. */
  fee?: number;
  /** Entered tax (VND). Falls back to the settings estimate when absent. */
  tax?: number;
}

export type CorporateAction =
  | {
      type: 'cash_dividend';
      id: string;
      symbol: string;
      exDate: string;
      payDate?: string;
      /** Gross VND per share. */
      amountPerShare: number;
    }
  | {
      type: 'stock_dividend';
      id: string;
      symbol: string;
      exDate: string;
      /** 100:20 means held 100, received 20. */
      ratio: { held: number; received: number };
      listingDate?: string;
    };

export interface LedgerSettings {
  /** User setting (TCBS rate), parts per million. */
  feeRatePpm: number;
  sellTaxRatePpm: number;
  settlementDays: number;
  holidays: readonly string[];
  dividendWithholdingRatePpm: number;
  cashDividendTreatment: 'reduceCost' | 'income';
  costMethod: 'WAC';
}

export interface Lot {
  id: string;
  symbol: string;
  source: 'buy' | 'stock_dividend';
  sourceId: string;
  acquiredOn: string;
  quantityOriginal: number;
  quantityRemaining: number;
  /** Informational, rounded. Cost is tracked per symbol (WAC). */
  costPerShare: number;
  sellableFrom: string;
  status: 'pending' | 'sellable';
}

export interface Holding {
  symbol: string;
  quantity: number;
  sellableQuantity: number;
  totalCost: number;
  averageCost: number | null;
  realizedPnl: number;
  dividendCashNet: number;
}

export interface Realization {
  sellTransactionId: string;
  symbol: string;
  quantity: number;
  proceedsNet: number;
  costRemoved: number;
  realizedPnl: number;
}

export type LedgerError =
  | {
      code: 'OVERSELL';
      transactionId: string;
      symbol: string;
      date: string;
      requested: number;
      sellable: number;
    }
  | { code: 'INVALID_INPUT'; id: string; field: string; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: LedgerError };

export interface Ledger {
  lots: Lot[];
  holdings: Holding[];
  realizations: Realization[];
}

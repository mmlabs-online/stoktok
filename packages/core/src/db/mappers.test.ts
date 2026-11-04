import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_SETTINGS } from '../ledger/settings';
import { DEFAULT_MARKET_RULES } from '../settings/market-rules';
import { DEFAULT_SIGNAL_RULES } from '../signals/config';
import type { SettingsInput } from '../settings/validate-settings';
import type { SettingsFullRow } from './rows';
import {
  RowMappingError,
  appSettingsFromRow,
  corporateActionFromRow,
  corporateActionToRow,
  settingsFromRow,
  settingsInputToRow,
  settingsToRow,
  toSafeInt,
  transactionFromRow,
  transactionToInsert,
} from './mappers';
import type { CorporateActionRow, SettingsRow, TransactionRow } from './rows';

const txRow: TransactionRow = {
  id: 't1',
  seq: '7',
  trade_date: '2026-01-05',
  symbol: 'VNM',
  side: 'buy',
  quantity: 100,
  price: 125400,
  fee: null,
  tax: null,
  source: 'manual',
  import_batch_id: null,
  external_ref: null,
};

const caRow: CorporateActionRow = {
  id: 'c1',
  symbol: 'VNM',
  type: 'cash_dividend',
  ex_date: '2026-02-01',
  record_date: null,
  pay_date: null,
  listing_date: null,
  amount_per_share: '2000',
  ratio_num: null,
  ratio_den: null,
};

const stockRow: CorporateActionRow = {
  ...caRow,
  id: 'c2',
  type: 'stock_dividend',
  amount_per_share: null,
  ratio_num: 20,
  ratio_den: 100,
};

const settingsRow: SettingsRow = {
  id: 1,
  fee_rate_ppm: 1500,
  sell_tax_rate_ppm: 1000,
  dividend_withholding_rate_ppm: 50000,
  settlement_days: 2,
  holidays: ['2026-01-01'],
  cash_dividend_treatment: 'reduceCost',
  cost_method: 'WAC',
};

describe('toSafeInt', () => {
  it('accepts number, bigint and digit string', () => {
    expect(toSafeInt(5, 'f')).toBe(5);
    expect(toSafeInt(5n, 'f')).toBe(5);
    expect(toSafeInt('5', 'f')).toBe(5);
  });
  it("rejects '9007199254740993', 1.5, '1e3', '', NaN, null", () => {
    for (const v of ['9007199254740993', 1.5, '1e3', '', NaN, null]) {
      expect(() => toSafeInt(v, 'f')).toThrow(RowMappingError);
    }
  });
  it("accepts negative string '-5000'", () => {
    expect(toSafeInt('-5000', 'f')).toBe(-5000);
  });
});

describe('transactionFromRow', () => {
  it('maps snake_case to core, fee/tax null -> undefined (not 0)', () => {
    const tx = transactionFromRow(txRow);
    expect(tx).toEqual({ id: 't1', seq: 7, tradeDate: '2026-01-05', symbol: 'VNM', side: 'buy', quantity: 100, price: 125400 });
    expect('fee' in tx).toBe(false);
  });
  it('seq/fee given as strings become numbers (no string concat)', () => {
    const tx = transactionFromRow({ ...txRow, seq: '10', fee: '1500', tax: '0' });
    expect(tx.seq + 1).toBe(11);
    expect(tx.fee).toBe(1500);
    expect(tx.tax).toBe(0);
  });
  it('rejects invalid trade_date / Date object / bad side', () => {
    expect(() => transactionFromRow({ ...txRow, trade_date: '2026-13-01' })).toThrow(RowMappingError);
    expect(() => transactionFromRow({ ...txRow, trade_date: new Date() as unknown as string })).toThrow(/pg type 1082/);
    expect(() => transactionFromRow({ ...txRow, side: 'hold' })).toThrow(RowMappingError);
  });
});

describe('transactionToInsert', () => {
  it('omits seq, maps meta (source, import_batch_id, external_ref), undefined fee -> null', () => {
    const insert = transactionToInsert(
      { tradeDate: '2026-01-05', symbol: 'VNM', side: 'sell', quantity: 100, price: 1 },
      { source: 'import', importBatchId: 'b1', externalRef: 'r1' },
    );
    expect(insert).toEqual({
      trade_date: '2026-01-05',
      symbol: 'VNM',
      side: 'sell',
      quantity: 100,
      price: 1,
      fee: null,
      tax: null,
      source: 'import',
      import_batch_id: 'b1',
      external_ref: 'r1',
    });
    expect('seq' in insert).toBe(false);
    expect('id' in insert).toBe(false);
  });
});

describe('transaction round trip', () => {
  it('core -> insert -> (+id, seq) -> core is deep-equal', () => {
    const core = { tradeDate: '2026-01-05', symbol: 'FPT', side: 'buy' as const, quantity: 200, price: 90000, fee: 135 };
    const insert = transactionToInsert(core, { source: 'manual' });
    const back = transactionFromRow({ ...insert, id: 'x', seq: '3' } as TransactionRow);
    expect(back).toEqual({ ...core, id: 'x', seq: 3 });
  });
});

describe('corporateActionFromRow', () => {
  it('cash: amount_per_share, pay_date; null pay_date -> no payDate key', () => {
    const a = corporateActionFromRow(caRow);
    expect(a).toEqual({ type: 'cash_dividend', id: 'c1', symbol: 'VNM', exDate: '2026-02-01', amountPerShare: 2000 });
    expect('payDate' in a).toBe(false);
    expect(corporateActionFromRow({ ...caRow, pay_date: '2026-02-20' })).toMatchObject({ payDate: '2026-02-20' });
  });
  it('stock: ratio_den->held, ratio_num->received (100:20)', () => {
    expect(corporateActionFromRow(stockRow)).toMatchObject({ ratio: { held: 100, received: 20 } });
  });
  it('rejects cash row with null amount / stock row with null ratio', () => {
    expect(() => corporateActionFromRow({ ...caRow, amount_per_share: null })).toThrow(RowMappingError);
    expect(() => corporateActionFromRow({ ...stockRow, ratio_num: null })).toThrow(RowMappingError);
    expect(() => corporateActionFromRow({ ...stockRow, ratio_den: null })).toThrow(RowMappingError);
  });
});

describe('corporateAction round trip', () => {
  it('cash and stock', () => {
    const cash = corporateActionFromRow({ ...caRow, pay_date: '2026-02-20' });
    expect(corporateActionFromRow(corporateActionToRow(cash))).toEqual(cash);
    const stock = corporateActionFromRow({ ...stockRow, listing_date: '2026-03-01' });
    const row = corporateActionToRow(stock, { recordDate: '2026-02-02' });
    expect(row).toMatchObject({ ratio_num: 20, ratio_den: 100, record_date: '2026-02-02' });
    expect(corporateActionFromRow(row)).toEqual(stock);
  });
});

describe('settingsFromRow', () => {
  it('maps ppm fields 1:1, holidays string[] kept, settlement_days number', () => {
    expect(settingsFromRow(settingsRow)).toEqual({
      feeRatePpm: 1500,
      sellTaxRatePpm: 1000,
      settlementDays: 2,
      holidays: ['2026-01-01'],
      dividendWithholdingRatePpm: 50000,
      cashDividendTreatment: 'reduceCost',
      costMethod: 'WAC',
    });
  });
  it("fee_rate_ppm null throws RowMappingError(field 'fee_rate_ppm')", () => {
    try {
      settingsFromRow({ ...settingsRow, fee_rate_ppm: null });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RowMappingError);
      expect((e as RowMappingError).field).toBe('fee_rate_ppm');
    }
  });
});

describe('settingsToRow', () => {
  it('DEFAULT_MARKET_SETTINGS + feeRatePpm null -> row with id 1', () => {
    const row = settingsToRow({ ...DEFAULT_MARKET_SETTINGS, feeRatePpm: null });
    expect(row).toMatchObject({ id: 1, fee_rate_ppm: null, sell_tax_rate_ppm: 1000, settlement_days: 2, holidays: [] });
  });
  it('settings round trip', () => {
    const s = settingsFromRow(settingsRow);
    expect(settingsFromRow(settingsToRow(s))).toEqual(s);
  });
});

describe('appSettingsFromRow', () => {
  const full: SettingsFullRow = {
    id: 1,
    fee_rate_ppm: null,
    sell_tax_rate_ppm: 1000,
    dividend_withholding_rate_ppm: 50000,
    settlement_days: 2,
    holidays: [],
    cash_dividend_treatment: 'income',
    cost_method: 'WAC',
    concentration_threshold_ppm: 250000,
    rule_configs: { market: { lotSize: 10 } },
  };
  it('null row gives defaults with a null fee', () => {
    expect(appSettingsFromRow(null)).toEqual({
      ...DEFAULT_MARKET_SETTINGS,
      feeRatePpm: null,
      concentrationThresholdPpm: null,
      marketRules: DEFAULT_MARKET_RULES,
      signalRules: DEFAULT_SIGNAL_RULES,
    });
  });
  it('null row gives DEFAULT_SIGNAL_RULES and a stored row is parsed', () => {
    expect(appSettingsFromRow(null).signalRules).toEqual(DEFAULT_SIGNAL_RULES);
    const rc = { signals: { medium: { freshness: { financialsMaxFetchAgeDays: 9 } } } };
    expect(appSettingsFromRow({ ...full, rule_configs: rc }).signalRules.freshness.financialsMaxFetchAgeDays).toBe(9);
  });
  it('maps concentration and rule_configs and keeps a null fee', () => {
    expect(appSettingsFromRow(full)).toMatchObject({
      feeRatePpm: null,
      concentrationThresholdPpm: 250000,
      cashDividendTreatment: 'income',
      marketRules: { lotSize: 10, priceLimitPpm: DEFAULT_MARKET_RULES.priceLimitPpm },
    });
  });
  it('throws RowMappingError on an invalid treatment', () => {
    expect(() => appSettingsFromRow({ ...full, cash_dividend_treatment: 'x' })).toThrow(RowMappingError);
  });
});

describe('settingsInputToRow', () => {
  const input: SettingsInput = {
    feeRatePpm: null,
    sellTaxRatePpm: 1000,
    settlementDays: 3,
    lotSize: 10,
    priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
    concentrationThresholdPpm: null,
    cashDividendTreatment: 'reduceCost',
    signalRules: DEFAULT_SIGNAL_RULES,
    holidays: ['2026-10-20'],
  };
  it('takes holidays from the input; keeps withholding, cost method and other rule_configs keys from the existing row', () => {
    const existing: SettingsFullRow = {
      id: 1,
      fee_rate_ppm: 1500,
      sell_tax_rate_ppm: 1000,
      dividend_withholding_rate_ppm: 40000,
      settlement_days: 2,
      holidays: ['2026-01-01'],
      cash_dividend_treatment: 'income',
      cost_method: 'WAC',
      concentration_threshold_ppm: null,
      rule_configs: { signals: { a: 1 } },
    };
    const row = settingsInputToRow(input, existing);
    expect(row).toMatchObject({
      dividend_withholding_rate_ppm: 40000,
      holidays: ['2026-10-20'],
      cost_method: 'WAC',
      settlement_days: 3,
      fee_rate_ppm: null,
    });
    expect(row.rule_configs).toMatchObject({ signals: { a: 1 }, market: { lotSize: 10 } });
  });
  it('writes market and signals.medium and keeps other keys', () => {
    const rules = { ...DEFAULT_SIGNAL_RULES, freshness: { financialsMaxFetchAgeDays: 30 } };
    const existing: SettingsFullRow = {
      id: 1, fee_rate_ppm: null, sell_tax_rate_ppm: 1000, dividend_withholding_rate_ppm: 50000, settlement_days: 2,
      holidays: [], cash_dividend_treatment: 'reduceCost', cost_method: 'WAC', concentration_threshold_ppm: null,
      rule_configs: { other: 1, signals: { long: { x: 1 } } },
    };
    const row = settingsInputToRow({ ...input, signalRules: rules }, existing);
    expect(row.rule_configs).toMatchObject({
      other: 1,
      market: { lotSize: 10 },
      signals: { long: { x: 1 }, medium: { freshness: { financialsMaxFetchAgeDays: 30 } } },
    });
    expect(appSettingsFromRow(row).signalRules).toEqual(rules);
  });
  it('strips seeded dates from input holidays; empty input gives []', () => {
    expect(settingsInputToRow({ ...input, holidays: ['2026-11-24', '2026-10-20'] }, null).holidays).toEqual(['2026-10-20']);
    expect(settingsInputToRow({ ...input, holidays: [] }, null).holidays).toEqual([]);
  });
  it('without an existing row uses the defaults', () => {
    expect(settingsInputToRow({ ...input, holidays: [] }, null)).toMatchObject({
      dividend_withholding_rate_ppm: 50000,
      holidays: [],
      cost_method: 'WAC',
      concentration_threshold_ppm: null,
    });
  });
});

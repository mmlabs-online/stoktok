export { createServiceClient } from './client';
export type { Db } from './client';
export { DataError } from './errors';
export type { DataErrorCode } from './errors';
export type { Asset, FinancialRecord, OpenGapRecord, WatchlistEntry } from './mappers';
export { loadLedger } from './ledger';
export { listHeldSymbols } from './holdings';
export {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  listTransactionsPage,
  updateTransaction,
} from './repos/transactions';
export type { TransactionPageQuery } from './repos/transactions';
export {
  createCorporateAction,
  deleteCorporateAction,
  listCorporateActions,
  updateCorporateAction,
} from './repos/corporate-actions';
export {
  getAppSettings,
  getConcentrationThreshold,
  getEntrySettings,
  getMarketRules,
  getSettings,
  getSignalRules,
  saveAppSettings,
  saveSettings,
} from './repos/settings';
export {
  getFirstPriceDates,
  getLatestCloses,
  getRecentCloses,
  listCloseHistory,
  listPriceDates,
  upsertPricesDaily,
} from './repos/prices-daily';
export { getLatestIntraday, upsertPricesIntraday } from './repos/prices-intraday';
export type { DataGapInsert, FinancialInsert, PriceDailyInsert, PriceIntradayInsert, SignalInsert, SymbolSectorRow } from './rows';
export { listFinancials, upsertFinancials } from './repos/financials';
export { insertGaps, listAllOpenGaps, listOpenGaps, listOpenMarketGaps, resolveGaps } from './repos/data-gaps';
export { listLatestSignals, upsertSignals } from './repos/signals';
export { createAsset, deleteAsset, getAsset, listAssets, updateAsset } from './repos/assets';
export { addToWatchlist, listWatchlist, removeFromWatchlist } from './repos/watchlist';
export { getSymbolExchanges, listSymbolSectors, setSymbolExchange, setSymbolSector } from './repos/symbols';

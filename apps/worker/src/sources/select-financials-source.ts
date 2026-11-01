import type { FinancialsSourceId } from '../config';
import { FINANCIALS_SYNC_CONFIG, TCBS_CONFIG, VCI_IQ_CONFIG } from '../config';
import type { FinancialsSource } from './financials-source';
import type { GetJsonOptions } from './http';
import { TcbsFinancialsSource } from './tcbs-financials';
import { VciIqFinancialsSource } from './vci-iq-financials';

/** One source per run, chosen by configuration (R5). No fallback chaining. */
export function createFinancialsSource(
  id: FinancialsSourceId,
  deps: { fetchImpl: typeof fetch; http: Omit<GetJsonOptions, 'userAgent'> },
): FinancialsSource {
  const c = FINANCIALS_SYNC_CONFIG;
  const common = { ...deps, requestDelayMs: c.requestDelayMs, maxPeriodsPerResponse: c.maxPeriodsPerResponse };
  switch (id) {
    case 'vci-iq':
      return new VciIqFinancialsSource({ ...common, userAgent: VCI_IQ_CONFIG.userAgent });
    case 'tcbs-public':
      return new TcbsFinancialsSource({ ...common, userAgent: TCBS_CONFIG.financialsUserAgent });
    default:
      throw new Error(`unknown financials source: ${String(id)}`);
  }
}

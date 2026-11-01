import type { PriceSourceId } from '../config';
import type { GetJsonOptions } from './http';
import type { PriceSource } from './price-source';
import { TcbsPriceSource } from './tcbs';
import { VciPriceSource } from './vci';

/** One source per run, chosen by configuration (R5). No fallback chaining. */
export function createPriceSource(
  id: PriceSourceId,
  deps: { fetchImpl: typeof fetch; http: Omit<GetJsonOptions, 'userAgent'> },
): PriceSource {
  switch (id) {
    case 'vci-public':
      return new VciPriceSource(deps);
    case 'tcbs-public':
      return new TcbsPriceSource(deps);
    default:
      throw new Error(`unknown price source: ${String(id)}`);
  }
}

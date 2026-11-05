'use server';

import { storedOnlyRefreshResult } from '@stoktok/core';
import type { RefreshPricesResult } from '@stoktok/core';
import { nowInstant } from '../../../server/clock';
import { getDb, getEntrySettings } from '../../../server/db';
import { requireUser } from '../../../server/auth/require-user';

// Interim body (STK-051): no source call and no DB write, only the session state. The client then calls
// router.refresh() to re-render stored data. STK-050 replaces this body with the throttled fetch-and-store and
// keeps the signature.
export async function refreshPricesAction(): Promise<RefreshPricesResult> {
  await requireUser();
  const { settings } = await getEntrySettings(getDb());
  return storedOnlyRefreshResult(nowInstant(), settings.holidays);
}

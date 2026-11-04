'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '../../../server/db';
import { handleAddWatch, handleRemoveWatch, handleSetExchange } from '../../../server/watchlist/handlers';
import type { ExchangeFormState, RemoveWatchState, WatchFormState } from '../../../server/watchlist/handlers';
import { requireUser } from '../../../server/auth/require-user';

// Every action calls requireUser() before getDb() (R6).
// No redirect: the board stays on /watchlist and is revalidated.

export async function addWatchAction(_prev: WatchFormState, formData: FormData): Promise<WatchFormState> {
  await requireUser();
  const state = await handleAddWatch(getDb(), formData);
  if (state.ok) revalidatePath('/watchlist');
  return state;
}

export async function removeWatchAction(symbol: string): Promise<RemoveWatchState> {
  await requireUser();
  const state = await handleRemoveWatch(getDb(), symbol);
  if (state.ok) revalidatePath('/watchlist');
  return state;
}

export async function setExchangeAction(
  symbol: string,
  _prev: ExchangeFormState,
  formData: FormData,
): Promise<ExchangeFormState> {
  await requireUser();
  const state = await handleSetExchange(getDb(), symbol, formData);
  if (state.ok) revalidatePath('/watchlist');
  return state;
}

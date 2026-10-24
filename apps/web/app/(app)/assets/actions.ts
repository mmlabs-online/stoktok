'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { todayVn } from '../../../server/clock';
import { handleCreateAsset, handleDeleteAsset, handleUpdateAsset } from '../../../server/assets/handlers';
import type { AssetFormState } from '../../../server/assets/handlers';
import { getDb } from '../../../server/db';
import type { FormState } from '../../../server/transactions/handlers';

// R6 is suspended: when it is restored, call requireUser() before getDb() in every action here.

function done(): never {
  revalidatePath('/assets');
  revalidatePath('/');
  redirect('/assets');
}

export async function createAssetAction(_prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const state = await handleCreateAsset(getDb(), formData, todayVn());
  if (state.ok) done();
  return state;
}

export async function updateAssetAction(id: string, _prev: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const state = await handleUpdateAsset(getDb(), id, formData, todayVn());
  if (state.ok) done();
  return state;
}

export async function deleteAssetAction(id: string): Promise<FormState<Record<string, never>>> {
  const state = await handleDeleteAsset(getDb(), id);
  if (state.ok) done();
  return state;
}

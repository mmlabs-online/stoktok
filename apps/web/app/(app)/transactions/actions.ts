'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '../../../server/db';
import { todayVn } from '../../../server/clock';
import {
  handleCreateCorporateAction,
  handleCreateTransaction,
  handleDeleteTransaction,
  handleUpdateTransaction,
} from '../../../server/transactions/handlers';
import type { CorporateActionFormState, FormState, TransactionFormState } from '../../../server/transactions/handlers';
import { requireUser } from '../../../server/auth/require-user';

// Every action calls requireUser() before getDb() (R6).

function done(): never {
  revalidatePath('/transactions');
  redirect('/transactions');
}

export async function createTransactionAction(_prev: TransactionFormState, formData: FormData): Promise<TransactionFormState> {
  await requireUser();
  const db = getDb();
  const state = await handleCreateTransaction(db, formData, todayVn());
  if (state.ok) done();
  return state;
}

export async function updateTransactionAction(
  id: string,
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  await requireUser();
  const db = getDb();
  const state = await handleUpdateTransaction(db, id, formData, todayVn());
  if (state.ok) done();
  return state;
}

export async function deleteTransactionAction(id: string): Promise<FormState<Record<string, never>>> {
  await requireUser();
  const db = getDb();
  const state = await handleDeleteTransaction(db, id, todayVn());
  if (state.ok) done();
  return state;
}

export async function createCorporateActionAction(
  _prev: CorporateActionFormState,
  formData: FormData,
): Promise<CorporateActionFormState> {
  await requireUser();
  const db = getDb();
  const state = await handleCreateCorporateAction(db, formData);
  if (state.ok) done();
  return state;
}

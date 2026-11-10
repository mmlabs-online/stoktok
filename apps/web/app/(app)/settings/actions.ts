'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AiKeyActionState } from '@stoktok/core';
import { handleDeleteAiKey, handleSaveAiKey } from '../../../server/ai-keys';
import { getDb } from '../../../server/db';
import { handleSaveSettings } from '../../../server/settings/handlers';
import type { SettingsFormState } from '../../../server/settings/handlers';
import { requireUser } from '../../../server/auth/require-user';

// Every action calls requireUser() before getDb() (R6).

export async function saveSettingsAction(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireUser();
  const state = await handleSaveSettings(getDb(), formData);
  if (state.ok) {
    revalidatePath('/', 'layout');
    redirect('/settings?saved=1');
  }
  return state;
}

export async function saveAiKeyAction(_prev: AiKeyActionState | null, formData: FormData): Promise<AiKeyActionState> {
  await requireUser();
  const state = await handleSaveAiKey(getDb(), formData);
  if (state.ok) revalidatePath('/settings');
  return state;
}

export async function deleteAiKeyAction(_prev: AiKeyActionState | null, formData: FormData): Promise<AiKeyActionState> {
  await requireUser();
  const state = await handleDeleteAiKey(getDb(), formData);
  if (state.ok) revalidatePath('/settings');
  return state;
}

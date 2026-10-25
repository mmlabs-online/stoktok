'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '../../../server/db';
import { handleSaveSettings } from '../../../server/settings/handlers';
import type { SettingsFormState } from '../../../server/settings/handlers';

// R6 is suspended: when it is restored, call requireUser() before getDb() here.

export async function saveSettingsAction(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const state = await handleSaveSettings(getDb(), formData);
  if (state.ok) {
    revalidatePath('/', 'layout');
    redirect('/settings?saved=1');
  }
  return state;
}

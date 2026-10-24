import { validateAssetInput } from '@stoktok/core';
import type { AssetFormRaw, EntryErrorCode } from '@stoktok/core';
import { DataError, createAsset, deleteAsset, updateAsset } from '../db';
import type { Db } from '../db';
import { isUuid } from '../is-uuid';
import { failForm, fieldErrors } from '../transactions/handlers';
import type { FormState } from '../transactions/handlers';

/**
 * FormData -> raw strings -> core validation -> repo.
 * R6 is suspended: when it is restored, call requireUser() before getDb() in every caller.
 */

export type AssetFormState = FormState<AssetFormRaw>;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '');

export function readAssetForm(fd: FormData): AssetFormRaw {
  return { type: str(fd, 'type'), name: str(fd, 'name'), value: str(fd, 'value'), asOf: str(fd, 'asOf') };
}

/** Repo NOT_FOUND maps to ASSET_NOT_FOUND, other DataErrors to SAVE_FAILED; anything else is a bug and is rethrown. */
function fromThrown<V>(e: unknown, values: V): FormState<V> {
  if (!(e instanceof DataError)) throw e;
  const code: EntryErrorCode = e.code === 'NOT_FOUND' ? 'ASSET_NOT_FOUND' : 'SAVE_FAILED';
  return failForm(values, code);
}

async function submitAsset(db: Db, formData: FormData, today: string, id?: string): Promise<AssetFormState> {
  const values = readAssetForm(formData);
  if (id !== undefined && !isUuid(id)) return failForm(values, 'ASSET_NOT_FOUND');
  const v = validateAssetInput(values, { today });
  if (!v.ok) return { ok: false, fieldErrors: fieldErrors(v.errors), values };
  try {
    if (id === undefined) await createAsset(db, v.value);
    else await updateAsset(db, id, v.value);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, values);
  }
}

export const handleCreateAsset = (db: Db, formData: FormData, today: string) => submitAsset(db, formData, today);

export const handleUpdateAsset = (db: Db, id: string, formData: FormData, today: string) =>
  submitAsset(db, formData, today, id);

export async function handleDeleteAsset(db: Db, id: string): Promise<FormState<Record<string, never>>> {
  if (!isUuid(id)) return failForm({}, 'ASSET_NOT_FOUND');
  try {
    await deleteAsset(db, id);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, {});
  }
}

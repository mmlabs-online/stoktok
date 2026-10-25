import { isValidDate } from '../calendar';
import type { EntryError } from './messages-vi';
import { parseIntegerInput } from './parse-input';
import { ASSET_NAME_MAX_LENGTH, ASSET_VALUE_MAX } from './rules';

export interface AssetFormRaw {
  type: string;
  name: string;
  value: string;
  asOf: string;
}

export type AssetField = keyof AssetFormRaw;

export interface AssetInput {
  type: 'cash' | 'other';
  name: string;
  value: number;
  asOf: string;
}

export type ValidateAssetResult =
  | { ok: true; value: AssetInput }
  | { ok: false; errors: Partial<Record<AssetField, EntryError>> };

/** Validates the asset form. `today` is the VN date, passed in: core reads no clock. All errors are reported together. */
export function validateAssetInput(raw: AssetFormRaw, ctx: { today: string }): ValidateAssetResult {
  const errors: Partial<Record<AssetField, EntryError>> = {};

  const type = raw.type === 'cash' || raw.type === 'other' ? raw.type : null;
  if (type === null) errors.type = { code: 'ASSET_TYPE_INVALID' };

  const name = raw.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name === '') errors.name = { code: 'REQUIRED' };
  else if ([...name].length > ASSET_NAME_MAX_LENGTH) errors.name = { code: 'NAME_TOO_LONG' };

  let value = 0;
  const v = parseIntegerInput(raw.value, { max: ASSET_VALUE_MAX });
  if (!v.ok) errors.value = { code: v.code };
  else value = v.value;

  const asOf = raw.asOf.trim();
  if (asOf === '') errors.asOf = { code: 'REQUIRED' };
  else if (!isValidDate(asOf)) errors.asOf = { code: 'DATE_INVALID' };
  else if (asOf > ctx.today) errors.asOf = { code: 'AS_OF_IN_FUTURE' };

  if (Object.keys(errors).length > 0 || type === null) return { ok: false, errors };
  return { ok: true, value: { type, name, value, asOf } };
}

export function assetToFormValues(a: AssetInput): AssetFormRaw {
  return { type: a.type, name: a.name, value: String(a.value), asOf: a.asOf };
}

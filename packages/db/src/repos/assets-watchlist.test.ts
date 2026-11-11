import { expect, test } from 'vitest';
import { assetFromRow } from '../mappers';

test('asset with invalid type throws MAPPING', () => {
  expect(() => assetFromRow({ id: 'a', type: 'bond', name: 'x', value: 1, as_of: '2026-10-23' })).toThrow();
});

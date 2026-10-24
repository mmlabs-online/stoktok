import { describe, expect, test } from 'vitest';
import { parseArgs } from './cli';

describe('parseArgs', () => {
  test('eod-prices -> dryRun false', () => {
    expect(parseArgs(['eod-prices'])).toEqual({ ok: true, job: 'eod-prices', dryRun: false });
  });
  test('eod-prices --dry-run -> dryRun true', () => {
    expect(parseArgs(['eod-prices', '--dry-run'])).toEqual({ ok: true, job: 'eod-prices', dryRun: true });
  });
  test('unknown job, no job or unknown flag -> usage error', () => {
    for (const argv of [['nope'], [], ['eod-prices', '--wat']]) {
      expect(parseArgs(argv)).toMatchObject({ ok: false });
    }
  });
});

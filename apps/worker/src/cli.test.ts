import { describe, expect, test } from 'vitest';
import { parseArgs } from './cli';

describe('parseArgs', () => {
  test('eod-prices -> dryRun false', () => {
    expect(parseArgs(['eod-prices'])).toEqual({ ok: true, job: 'eod-prices', dryRun: false });
  });
  test('eod-prices --dry-run -> dryRun true', () => {
    expect(parseArgs(['eod-prices', '--dry-run'])).toEqual({ ok: true, job: 'eod-prices', dryRun: true });
  });
  test('financials and financials --dry-run are accepted', () => {
    expect(parseArgs(['financials'])).toEqual({ ok: true, job: 'financials', dryRun: false });
    expect(parseArgs(['financials', '--dry-run'])).toEqual({ ok: true, job: 'financials', dryRun: true });
  });
  test('signals and signals --dry-run are accepted', () => {
    expect(parseArgs(['signals'])).toEqual({ ok: true, job: 'signals', dryRun: false });
    expect(parseArgs(['signals', '--dry-run'])).toEqual({ ok: true, job: 'signals', dryRun: true });
  });
  test('unknown job, no job or unknown flag -> usage error', () => {
    for (const argv of [['nope'], [], ['eod-prices', '--wat'], ['financials', '--wat'], ['signals', '--wat']]) {
      expect(parseArgs(argv)).toMatchObject({ ok: false });
    }
  });
});

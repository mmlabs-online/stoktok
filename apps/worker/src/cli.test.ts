import { describe, expect, test } from 'vitest';
import { EOD_SYNC_CONFIG } from './config';
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
  test('financial-statements and --dry-run accepted; --source and --backfill rejected', () => {
    expect(parseArgs(['financial-statements'])).toEqual({ ok: true, job: 'financial-statements', dryRun: false });
    expect(parseArgs(['financial-statements', '--dry-run'])).toEqual({ ok: true, job: 'financial-statements', dryRun: true });
    expect(parseArgs(['financial-statements', '--source', 'vci-iq'])).toMatchObject({ ok: false });
    expect(parseArgs(['financial-statements', '--backfill'])).toMatchObject({ ok: false });
  });
  test('signals and signals --dry-run are accepted', () => {
    expect(parseArgs(['signals'])).toEqual({ ok: true, job: 'signals', dryRun: false });
    expect(parseArgs(['signals', '--dry-run'])).toEqual({ ok: true, job: 'signals', dryRun: true });
  });
  test('resolve-holiday-gaps parses with and without --dry-run; --backfill and --source give usage', () => {
    expect(parseArgs(['resolve-holiday-gaps'])).toEqual({ ok: true, job: 'resolve-holiday-gaps', dryRun: false });
    expect(parseArgs(['resolve-holiday-gaps', '--dry-run'])).toEqual({ ok: true, job: 'resolve-holiday-gaps', dryRun: true });
    expect(parseArgs(['resolve-holiday-gaps', '--backfill'])).toMatchObject({ ok: false });
    expect(parseArgs(['resolve-holiday-gaps', '--source', 'vci-public'])).toMatchObject({ ok: false });
  });
  test('unknown job, no job or unknown flag -> usage error', () => {
    for (const argv of [['nope'], [], ['eod-prices', '--wat'], ['financials', '--wat'], ['signals', '--wat']]) {
      expect(parseArgs(argv)).toMatchObject({ ok: false });
    }
  });

  describe('--backfill', () => {
    test('eod-prices --backfill 260 -> backfillTradingDays 260', () => {
      expect(parseArgs(['eod-prices', '--backfill', '260'])).toEqual({ ok: true, job: 'eod-prices', dryRun: false, backfillTradingDays: 260 });
    });
    test('--backfill without n -> config default; with --dry-run before or after', () => {
      const n = EOD_SYNC_CONFIG.backfillDefaultTradingDays;
      expect(parseArgs(['eod-prices', '--backfill'])).toEqual({ ok: true, job: 'eod-prices', dryRun: false, backfillTradingDays: n });
      expect(parseArgs(['eod-prices', '--backfill', '--dry-run'])).toEqual({ ok: true, job: 'eod-prices', dryRun: true, backfillTradingDays: n });
      expect(parseArgs(['eod-prices', '--dry-run', '--backfill', '100'])).toEqual({ ok: true, job: 'eod-prices', dryRun: true, backfillTradingDays: 100 });
      expect(parseArgs(['eod-prices', '--backfill', '100', '--dry-run'])).toEqual({ ok: true, job: 'eod-prices', dryRun: true, backfillTradingDays: 100 });
    });
    test('--backfill 0 / -5 / 2.5 / abc / > max -> usage', () => {
      const over = String(EOD_SYNC_CONFIG.backfillMaxTradingDays + 1);
      for (const v of ['0', '-5', '2.5', 'abc', over]) {
        expect(parseArgs(['eod-prices', '--backfill', v])).toMatchObject({ ok: false });
      }
      expect(parseArgs(['eod-prices', '--backfill', String(EOD_SYNC_CONFIG.backfillMaxTradingDays)])).toMatchObject({ ok: true });
    });
    test('signals --backfill / financials --backfill / repeated flag -> usage', () => {
      for (const argv of [['signals', '--backfill'], ['financials', '--backfill', '5'], ['eod-prices', '--backfill', '5', '--backfill', '5']]) {
        expect(parseArgs(argv)).toMatchObject({ ok: false });
      }
    });
  });

  describe('--source', () => {
    test('vci-public / tcbs-public accepted, alone and with other flags in any order', () => {
      for (const id of ['vci-public', 'tcbs-public'] as const) {
        expect(parseArgs(['eod-prices', '--source', id])).toEqual({ ok: true, job: 'eod-prices', dryRun: false, source: id });
        expect(parseArgs(['eod-prices', '--dry-run', '--source', id])).toEqual({ ok: true, job: 'eod-prices', dryRun: true, source: id });
        expect(parseArgs(['eod-prices', '--source', id, '--backfill', '30', '--dry-run'])).toEqual({
          ok: true, job: 'eod-prices', dryRun: true, backfillTradingDays: 30, source: id,
        });
      }
    });
    test('unknown id, missing value, repeated, or on financials/signals -> usage', () => {
      for (const argv of [
        ['eod-prices', '--source', 'nope'],
        ['eod-prices', '--source'],
        ['eod-prices', '--source', '--dry-run'],
        ['eod-prices', '--source', 'vci-public', '--source', 'tcbs-public'],
        ['financials', '--source', 'vci-public'],
        ['signals', '--source', 'vci-public'],
      ]) {
        expect(parseArgs(argv)).toMatchObject({ ok: false });
      }
    });
    test('financials accepts vci-iq / tcbs-public, rejects price-only ids; eod-prices rejects vci-iq', () => {
      for (const id of ['vci-iq', 'tcbs-public'] as const) {
        expect(parseArgs(['financials', '--source', id])).toEqual({ ok: true, job: 'financials', dryRun: false, source: id });
        expect(parseArgs(['financials', '--dry-run', '--source', id])).toEqual({ ok: true, job: 'financials', dryRun: true, source: id });
      }
      expect(parseArgs(['financials', '--source', 'vci-public'])).toMatchObject({ ok: false });
      expect(parseArgs(['eod-prices', '--source', 'vci-iq'])).toMatchObject({ ok: false });
      expect(parseArgs(['financials', '--source', 'vci-iq', '--source', 'tcbs-public'])).toMatchObject({ ok: false });
    });
    test('without --source the result has no source key', () => {
      expect(parseArgs(['eod-prices', '--dry-run'])).not.toHaveProperty('source');
    });
  });
});

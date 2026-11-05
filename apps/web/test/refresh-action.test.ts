import fs from 'node:fs';
import path from 'node:path';
import { storedOnlyRefreshResult } from '@stoktok/core';
import { describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const now = new Date('2026-10-23T03:00:00Z'); // Friday 10:00 VN

vi.mock('server-only', () => ({}));
vi.mock('../server/auth/require-user', () => ({
  requireUser: vi.fn(async () => {
    order.push('requireUser');
  }),
}));
vi.mock('../server/db', () => ({
  getDb: () => ({}),
  getEntrySettings: vi.fn(async () => {
    order.push('getEntrySettings');
    return { settings: { holidays: [] }, feeRateConfigured: true };
  }),
}));
vi.mock('../server/clock', () => ({ nowInstant: () => now }));

import { refreshPricesAction } from '../app/(app)/prices/actions';

describe('refreshPricesAction', () => {
  it('calls requireUser() before reading settings and returns the stored-only result', async () => {
    const r = await refreshPricesAction();
    expect(order).toEqual(['requireUser', 'getEntrySettings']);
    expect(r).toEqual(storedOnlyRefreshResult(now, []));
    expect(r).toEqual({ status: 'ok', nextInMs: 0, sessionOpen: true });
  });

  it('imports no market source', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app/(app)/prices/actions.ts'), 'utf8');
    expect(src).not.toMatch(/@stoktok\/sources|server\/sources/);
  });
});

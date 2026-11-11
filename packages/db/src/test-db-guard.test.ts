import { describe, expect, test } from 'vitest';
import { checkAdminUrl } from '../test-db/global-setup';

describe('test:db DB_TEST_URL guard', () => {
  test('accepts a local URL, including a port in the authority', () => {
    expect(checkAdminUrl('postgresql://postgres@127.0.0.1:54329/postgres').hostname).toBe('127.0.0.1');
    expect(checkAdminUrl('postgresql://postgres:pw@localhost/postgres').hostname).toBe('localhost');
  });

  test('refuses a missing URL and a non-local host', () => {
    expect(() => checkAdminUrl(undefined)).toThrow(/needs DB_TEST_URL/);
    expect(() => checkAdminUrl('postgresql://postgres@example.com/postgres')).toThrow(/refuses non-local/);
  });

  test('refuses host, hostaddr and port query params that override the URL host', () => {
    for (const q of ['host=prod.example', 'hostaddr=10.0.0.5', 'port=5432']) {
      expect(() => checkAdminUrl(`postgresql://postgres:pw@localhost/postgres?${q}`), q).toThrow(/query parameter/);
    }
  });
});

import { defineConfig } from 'vitest/config';

// Real-Postgres tests (STK-080). Needs DB_TEST_URL; never skips.
export default defineConfig({
  test: {
    include: ['test-db/**/*.test.ts'],
    environment: 'node',
    globalSetup: './test-db/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

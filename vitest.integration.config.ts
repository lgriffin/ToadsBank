import { defineConfig } from 'vitest/config';

// Adapter integration tests against a real PostgreSQL: TOADSBANK_TEST_DATABASE_URL must point at a scratch database.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

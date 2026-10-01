import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'packages/adapters/*/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', 'tests/integration/**', 'tests/fixtures/**'],
    coverage: { include: ['packages/domain/src', 'packages/application/src'] },
  },
});

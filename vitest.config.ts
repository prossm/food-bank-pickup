import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    // Real Postgres, not a mock. Mocks cannot reproduce snapshot isolation semantics, which
    // is precisely what the booking race depends on — a mocked test would pass against the
    // broken SELECT-then-INSERT implementation too, and prove nothing.
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    exclude: ['node_modules/**', '.next/**', 'bot/**'],
    testTimeout: 20_000,
    // beforeEach starts an in-memory Postgres and runs every migration; on a busy machine
    // that alone can pass vitest's 10 s default for hooks.
    hookTimeout: 30_000,
  },
});

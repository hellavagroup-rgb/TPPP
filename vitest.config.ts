import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'client/src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
  test: {
    // Run tests from the project root, not the Vite client root
    root: '.',
    include: ['server/**/*.test.ts', 'client/src/lib/**/*.test.ts', 'client/src/pages/**/*.browser.test.tsx', 'client/src/components/**/*.browser.test.tsx'],
    environment: 'node',
    // Parallel imports can start the server while authSession.test.ts is still
    // resolving routes, hitting the existing routes/index import cycle.
    maxWorkers: 1,
  },
});

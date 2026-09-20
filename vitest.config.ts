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
    include: ['server/**/*.test.ts', 'client/src/lib/**/*.test.ts', 'client/src/pages/**/*.browser.test.tsx'],
    environment: 'node',
  },
});

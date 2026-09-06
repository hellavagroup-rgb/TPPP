import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'shared'),
    },
  },
  test: {
    // Run tests from the project root, not the Vite client root
    root: '.',
    include: ['server/**/*.test.ts', 'client/src/lib/**/*.test.ts'],
    environment: 'node',
  },
});

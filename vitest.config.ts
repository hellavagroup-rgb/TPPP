import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run tests from the project root, not the Vite client root
    root: '.',
    include: ['server/**/*.test.ts'],
    environment: 'node',
  },
});

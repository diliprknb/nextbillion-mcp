import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Loads the committed documentation fixture for every test file (tests/setup.ts).
    setupFiles: ['tests/setup.ts'],
  },
});

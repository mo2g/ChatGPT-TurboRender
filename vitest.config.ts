import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
  // Handle CSS imports in tests
  css: {
    modules: {
      scopeBehaviour: 'global',
    },
  },
});

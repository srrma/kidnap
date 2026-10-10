import { defineConfig } from 'vitest/config';

/**
 * Tests default to node. Anything that needs a DOM declares it with a
 * `@vitest-environment jsdom` docblock, so only the DOM suites pay for it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

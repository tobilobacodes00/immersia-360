import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/*.spec.ts belongs to Playwright, not Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});

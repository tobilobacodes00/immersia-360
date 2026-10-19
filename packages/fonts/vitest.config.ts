import { defineConfig } from 'vitest/config';

/** Catalogue and manifest checks only: Node, no browser project (the loader needs a real FontFaceSet). */
export default defineConfig({
  test: { name: 'unit', include: ['test/**/*.test.ts'], environment: 'node' },
});

import { defineConfig } from 'vitest/config';

// Node only: the worker's decisions (config, the job state machine, the file server, the API client).
// Chrome is exercised by `pnpm smoke`, which CI runs as its own job.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});

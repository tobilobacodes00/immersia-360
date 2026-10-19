import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

/**
 * Two projects: shader metadata in Node, and the shaders themselves compiled and run in real Chrome
 * (WebGL2 on SwiftShader in CI), where the pixels can be checked.
 */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'browser',
          include: ['test-browser/**/*.browser.test.ts'],
          testTimeout: 120_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: { channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});

import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

/**
 * Two projects: pure logic in Node, and golden tests in real Chrome (WebCodecs + WebGL2). CI runners
 * have no GPU, so WebGL runs on SwiftShader; Chrome stable (channel 'chrome') ships the H.264
 * encoder that Playwright's own Chromium lacks.
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

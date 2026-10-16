import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test('home renders in English by default @mobile', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Turn any screen into a 360 and photo booth.');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('negotiates the locale from Accept-Language', async ({ browser }) => {
    // `locale` drives the browser's real Accept-Language (an extra header would be overridden on navigation).
    const context = await browser.newContext({ locale: 'pt-BR' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Transforme qualquer tela em uma cabine 360 e de fotos.',
    );
    await context.close();
  });

  test('the language picker persists the choice', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Convierte cualquier pantalla en una cabina 360 y de fotos.',
    );
  });

  test('uses the self-hosted Satoshi font, with no third-party font requests', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).host;
      if (host && !host.startsWith('127.0.0.1') && !host.startsWith('localhost')) external.push(r.url());
    });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const family = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family.toLowerCase()).toContain('satoshi');
    expect(external).toEqual([]);
  });
});

test.describe('design system', () => {
  test('guest surfaces take the event theme from --g-* variables', async ({ page }) => {
    await page.goto('/design');
    const preview = page.locator('.booth-preview');
    await expect(preview).toHaveCSS('background-color', 'rgb(247, 246, 242)');
    await page.getByRole('combobox', { name: 'Event theme' }).selectOption('Monochrome');
    await expect(preview).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.getByRole('combobox', { name: 'Event theme' }).selectOption('Vermilion');
    await expect(preview).toHaveCSS('background-color', 'rgb(250, 247, 242)');
  });

  test('token field previews dynamic fields', async ({ page }) => {
    await page.goto('/design');
    await expect(page.getByText('GOLDEN HOUR GALA · 11 October 2026')).toBeVisible();
  });
});

test.describe('accessibility (WCAG 2.2 AA)', () => {
  for (const path of ['/', '/design']) {
    test(`${path} has no axe violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});

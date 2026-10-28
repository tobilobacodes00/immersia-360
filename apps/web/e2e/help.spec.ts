import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { e2eHeaders, open, signIn, uniqueEmail } from './helpers';

/**
 * The help centre (HLP-2, screen 22) and the public status page (HLP-4, screen 24): search finds an
 * article, an article renders, help links keep a reader where they are, the contact form reaches the
 * support inbox, and the status page shows live checks. Every page is axe-clean (WCAG 2.2 AA).
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.length}`);
}

test.describe('help centre (screen 22)', () => {
  test('lists the guides by topic and the FAQ, and has no axe violations @mobile', async ({ page }) => {
    await open(page, '/help');
    await expect(page.getByRole('heading', { level: 1, name: 'Help centre' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Browse by topic' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Troubleshooting' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fix camera access problems' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Frequently asked questions' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Contact us' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Service status' })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('search finds an article as you type, shows it, and an article renders', async ({ page }) => {
    await open(page, '/help');
    const box = page.getByRole('searchbox', { name: 'Search the help centre' });
    await box.fill('kiosk printing');
    const results = page.getByRole('region', { name: 'Search results' });
    await expect(results.getByRole('link', { name: /Chrome kiosk printing/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /articles? match/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // A misspelling still finds it, and a nonsense word says so and offers the contact form.
    await box.fill('pritner');
    await expect(results.getByRole('link', { name: 'Print at the right size' })).toBeVisible();
    await box.fill('zzzqxv');
    await expect(page.getByText('No articles match “zzzqxv”')).toBeVisible();
    await expect(page.getByText('Try fewer or different words')).toBeVisible();

    // Clearing the box brings the browse view back.
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Browse by topic' })).toBeVisible();

    await box.fill('camera blocked');
    await results.getByRole('link', { name: 'Fix camera access problems' }).click();
    await expect(page).toHaveURL(/\/help\/camera-permissions$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Fix camera access problems' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Camera access was blocked' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The camera disconnected' })).toBeVisible();
    // Related articles, the way out to support and the review date.
    await expect(page.getByRole('heading', { level: 2, name: 'Read next' })).toBeVisible();
    await expect(page.getByText('Still stuck?')).toBeVisible();
    await expect(page.getByText(/Last reviewed/)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('an article with commands, tables and notes renders them as content, never as markup', async ({ page }) => {
    await open(page, '/help/chrome-kiosk-printing');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Chrome kiosk printing');
    await expect(page.getByText('--kiosk-printing').first()).toBeVisible();
    await expect(page.locator('pre code').first()).toBeVisible();
    // The renderer builds elements itself: nothing in an article is injected as HTML.
    expect(await page.locator('article script, article iframe, article [onclick]').count()).toBe(0);
    await open(page, '/help/printing-setup');
    await expect(page.getByRole('table').first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test('a link to an error code lands on that heading, and links keep the reader in the public help centre', async ({
    page,
  }) => {
    await open(page, '/help/cloud-copy-errors#quota_exceeded');
    const heading = page.getByRole('heading', { level: 3, name: 'Your cloud is full' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeInViewport();
    await expect(page.getByRole('link', { name: 'Team roles', exact: true })).toHaveAttribute(
      'href',
      '/help/team-roles',
    );
  });

  test('wide tables do not make the page scroll sideways on a phone @mobile', async ({ page }) => {
    await open(page, '/help/team-roles');
    await expect(page.getByRole('table').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('unknown articles are a real 404', async ({ page }) => {
    const res = await page.goto('/help/this-article-does-not-exist');
    expect(res?.status()).toBe(404);
  });
});

test.describe('help centre in other languages', () => {
  for (const [locale, title, query, slug] of [
    ['es-419', 'Imprimir sin cuadro de diálogo', 'impresión de quiosco', 'chrome-kiosk-printing'],
    ['pt-BR', 'Imprimir sem caixa de diálogo', 'impressão de quiosque', 'chrome-kiosk-printing'],
  ] as const) {
    test(`${locale}: the article, its search and its page language`, async ({ browser }) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await open(page, `/help/${slug}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
      await open(page, '/help');
      await page.getByRole('searchbox').fill(query);
      await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await context.close();
    });
  }
});

test.describe('contact form', () => {
  test('says what is wrong, then sends the message to the support inbox with a reply address', async ({ page }) => {
    await open(page, '/help');
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Send message' }) });
    await form.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Some details need fixing' })).toBeVisible();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // The support address is on the page itself ("Prefer email? Write to ...").
    const line = await page
      .getByText(/Prefer email\? Write to /)
      .first()
      .innerText();
    const support = /Write to (\S+@\S+?)\.(?:\s|$)/.exec(line)?.[1];
    expect(support, line).toBeTruthy();

    const sender = uniqueEmail('help');
    const marker = `HELP-E2E-${Date.now().toString(36)}`;
    await page.getByLabel('Your name (optional)').fill('Dana Operator');
    await page.getByLabel('Your email').fill(sender);
    await page.getByLabel('What is it about?').selectOption({ label: 'Printing' });
    await page.getByLabel('Your message').fill(`The strip prints too small on our printer. ${marker}`);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Message sent', { exact: true })).toBeVisible();
    await expect(page.getByText(/within 2 business days/).first()).toBeVisible();

    // The e2e mailbox holds what the server sent.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/test/mailbox?to=${encodeURIComponent(support!)}`, {
            headers: e2eHeaders,
          });
          if (!res.ok()) return null;
          return (await res.json()) as { subject: string; text: string; replyTo?: string };
        },
        { timeout: 10_000 },
      )
      .toMatchObject({
        subject: expect.stringMatching(/printing/i),
        text: expect.stringContaining(marker),
        replyTo: sender,
      });
  });

  test('a bot that fills the hidden field gets a polite "sent" and nothing is delivered', async ({ page }) => {
    await open(page, '/help');
    const support = /Write to (\S+@\S+?)\.(?:\s|$)/.exec(
      await page
        .getByText(/Prefer email\? Write to /)
        .first()
        .innerText(),
    )?.[1];
    const sender = uniqueEmail('bot');
    await page.getByLabel('Your email').fill(sender);
    await page.getByLabel('Your message').fill('Buy cheap watches now, this is clearly spam.');
    // The field a person never sees or reaches with the keyboard.
    await page.locator('input[name="website"]').evaluate((el: HTMLInputElement) => {
      el.value = 'https://spam.example';
    });
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Message sent', { exact: true })).toBeVisible();
    const res = await page.request.get(`/api/test/mailbox?to=${encodeURIComponent(support!)}`, { headers: e2eHeaders });
    if (res.ok()) expect(JSON.stringify(await res.json())).not.toContain('cheap watches');
  });
});

test.describe('help centre inside the Studio', () => {
  test('is in the side menu, prefills the contact form and keeps links inside the Studio', async ({ page }) => {
    const email = await signIn(page);
    await page.getByRole('navigation', { name: 'Studio' }).getByRole('link', { name: 'Help', exact: true }).click();
    await expect(page).toHaveURL(/\/studio\/help$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Help centre' })).toBeVisible();
    await expect(page.getByLabel('Your email')).toHaveValue(email);

    await open(page, '/studio/help/cloud-copy-errors');
    await expect(page.getByRole('link', { name: 'Team roles', exact: true })).toHaveAttribute(
      'href',
      '/studio/help/team-roles',
    );
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('status page (screen 24)', () => {
  test('shows live checks of the services, the incidents and how to reach us, and has no axe violations @mobile', async ({
    page,
  }) => {
    await open(page, '/status');
    await expect(page.getByRole('heading', { level: 1, name: 'Service status' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Services' })).toBeVisible();

    const states = /^(Operational|Degraded|Down|Not configured)$/;
    for (const name of ['Database', 'File storage', 'Live Display hub', 'Email']) {
      const row = page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
      await expect(row).toHaveCount(1);
      await expect(row.getByText(states)).toBeVisible();
    }
    // The database is real in CI, so it must answer.
    const database = page.getByRole('listitem').filter({ has: page.getByText('Database', { exact: true }) });
    await expect(database.getByText('Operational', { exact: true })).toBeVisible();

    await expect(
      page.getByText(/^(All systems operational|Some systems are slower than usual|A system is down)$/).first(),
    ).toBeVisible();
    await expect(page.getByText(/Checked .*Results are kept for up to \d+ seconds\./)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Recent incidents' })).toBeVisible();
    await expect(page.getByText('No incidents in the last 90 days.')).toBeVisible();
    await expect(page.getByText(/We reply within 2 business days\./)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Help centre' }).last()).toHaveAttribute('href', '/help');
    expect(await axeViolations(page)).toEqual([]);
  });

  test('the JSON endpoint reports the same checks with a short cache, and a core outage is a 503', async ({
    request,
  }) => {
    const res = await request.get('/api/status');
    expect([200, 503]).toContain(res.status());
    expect(res.headers()['cache-control']).toMatch(/no-store|max-age=\d+/);
    const body = (await res.json()) as {
      overall: string;
      checkedAt: string;
      services: { id: string; state: string }[];
    };
    expect(['operational', 'degraded', 'outage']).toContain(body.overall);
    expect(body.services.map((s) => s.id).sort()).toEqual(['database', 'email', 'realtime', 'storage']);
    expect(body.services.find((s) => s.id === 'database')?.state).toBe('operational');
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    // Operational means 200; a core service down means 503, so an uptime monitor can alert on it.
    expect(res.status()).toBe(body.overall === 'outage' ? 503 : 200);
  });
});

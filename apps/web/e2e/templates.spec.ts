import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createEvent, open, signIn } from './helpers';

/**
 * Screen 7 (the template library, PHO-5) and the editor's library panel. The designs are generated
 * by code, so the checks name nothing that could change with a style or a layout: they use the
 * occasions and sizes the library promises, and read counts off the screen.
 */

const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();

const countOf = async (page: Page) => {
  const status = page.getByRole('status').filter({ hasText: /templates?$/ });
  await expect(status).toBeVisible();
  return Number((await status.innerText()).match(/\d+/)![0]);
};

async function openLibrary(page: Page) {
  await open(page, '/studio');
  await page.getByRole('navigation', { name: 'Studio' }).getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/studio\/templates$/);
  await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
  await expect(page.getByRole('heading', { level: 1, name: 'Template library' })).toBeVisible();
}

test.describe('template library (screen 7)', () => {
  test('filter by occasion and size, preview, use it for an event, and see it on Branding', async ({ page }) => {
    await signIn(page);
    // A new photo booth event prints 2×6 strips.
    const eventId = await createEvent(page, 'Library wedding', 'Photo Booth');
    await openLibrary(page);

    const grid = page.getByRole('list', { name: 'Templates' });
    const total = await countOf(page);
    expect(total).toBeGreaterThanOrEqual(160);

    // An occasion, then a size: only that occasion's designs for that page remain.
    await page.getByRole('radio', { name: 'Wedding' }).click();
    await expect(page.getByRole('radio', { name: 'Wedding' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => countOf(page)).toBeLessThan(total);
    const wedding = await countOf(page);
    expect(wedding).toBeGreaterThanOrEqual(15);
    await page.getByLabel('Size', { exact: true }).selectOption({ label: '2×6 in strip' });
    await expect.poll(() => countOf(page)).toBeLessThan(wedding);
    expect(await countOf(page)).toBeGreaterThanOrEqual(3);
    const cards = grid.getByRole('button', { name: /^Wedding · .+ · 2×6 in strip · \d+ photos?$/ });
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBe(await countOf(page));

    // The name search narrows further, ignoring case.
    await page.getByRole('textbox', { name: 'Search templates' }).fill('zzzz nothing');
    await expect(page.getByText('No templates match')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Wedding' }).click();
    await page.getByLabel('Size', { exact: true }).selectOption({ label: '2×6 in strip' });
    await expect(cards.first()).toBeVisible();

    // A preview drawn large by the real renderer.
    await cards.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: /^Preview of Wedding · / })).toBeVisible();
    await expect(dialog.getByText('From the library')).toBeVisible();

    const r = await axe(page);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    // Use it for the event the test made: it is a 2×6 event, so the design is used as is.
    await dialog.getByRole('button', { name: 'Use for an event…' }).click();
    const event = dialog.getByRole('radio', { name: /Library wedding/ });
    await expect(event).toBeVisible();
    await expect(dialog.getByText(/matches this template/)).toBeVisible();
    await event.check();
    await dialog.getByRole('button', { name: 'Use this design' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'now uses this design' })).toBeVisible();

    await dialog.getByRole('link', { name: 'Open Branding' }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/events/${eventId}/branding$`));
    await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    // Before this, the event had no design of its own ("Using the standard layout").
    await expect(page.getByRole('img', { name: "The event's print layout" })).toBeVisible();
    await expect(page.getByText('Using the standard layout for the print size.')).toHaveCount(0);
  });

  test('a design for another page size is made for the event’s own size, and a built-in can be saved', async ({
    page,
  }) => {
    await signIn(page);
    const eventId = await createEvent(page, 'Library birthday', 'Photo Booth');
    await openLibrary(page);

    // A 4×6 template for a 2×6 event: the same style at 2×6 is used (the QR stays 18 mm or more).
    await page.getByRole('radio', { name: 'Birthday' }).click();
    await page.getByLabel('Size', { exact: true }).selectOption({ label: '4×6 in' });
    const card = page
      .getByRole('list', { name: 'Templates' })
      .getByRole('button', { name: /^Birthday · / })
      .first();
    await expect(card).toBeVisible();
    await card.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Use for an event…' }).click();
    await expect(dialog.getByText(/the same style made for this size is used/)).toBeVisible();
    await dialog.getByRole('radio', { name: /Library birthday/ }).check();
    await dialog.getByRole('button', { name: 'Use this design' }).click();
    await expect(dialog.getByRole('status').filter({ hasText: 'now uses this design' })).toBeVisible();
    await dialog.getByRole('link', { name: 'Open Branding' }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/events/${eventId}/branding$`));
    await expect(page.getByRole('img', { name: "The event's print layout" })).toBeVisible();

    // Save a built-in to the organisation's own templates; it survives a reload, marked as mine.
    await openLibrary(page);
    await page.getByRole('radio', { name: 'Christmas' }).click();
    await page.getByLabel('Size', { exact: true }).selectOption({ label: 'Story 9:16' });
    await page
      .getByRole('list', { name: 'Templates' })
      .getByRole('button', { name: /^Christmas · / })
      .first()
      .click();
    await expect(page.getByRole('dialog').getByText('Made for screens, so there is no QR code.')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Save to my templates' }).click();
    const name = page.getByRole('dialog').getByRole('textbox', { name: 'Template name' });
    await name.fill('Our Christmas story');
    await page.getByRole('dialog').getByRole('button', { name: 'Save template' }).click();
    await expect(
      page.getByRole('dialog').getByRole('status').filter({ hasText: 'Saved as “Our Christmas story”.' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.reload();
    await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    await page.getByRole('textbox', { name: 'Search templates' }).fill('our christmas');
    const mine = page.getByRole('list', { name: 'Templates' }).getByRole('button', { name: /Our Christmas story/ });
    await expect(mine).toHaveCount(1);
    await expect(mine.getByText('Mine')).toBeVisible();

    const r = await axe(page);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe('the editor’s library panel', () => {
  test('shows designs of the page’s size first, filters by occasion, and applies one', async ({ page }) => {
    await signIn(page);
    const eventId = await createEvent(page, 'Panel party', 'Photo Booth');
    await open(page, `/studio/events/${eventId}/design/layout`);
    await expect(page.getByRole('application').locator('canvas').first()).toBeVisible();

    await page.getByRole('radio', { name: 'Templates' }).click();
    await page.getByLabel('Occasion', { exact: true }).selectOption({ label: 'Birthday' });
    await expect(page.getByRole('heading', { name: 'Same size as this page' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other sizes (fitted when used)' })).toBeVisible();
    // The event prints 2×6, so those come first.
    const first = page.getByRole('button', { name: /^Birthday · .+ · / }).first();
    await expect(first).toHaveAccessibleName(/2×6 in strip/);

    await first.click();
    await page.getByRole('button', { name: 'Use this design' }).click();
    await page.getByRole('radio', { name: 'Layers' }).click();
    // Library designs date themselves with a dynamic field.
    await expect(page.getByRole('list', { name: 'Layers' }).getByRole('button', { name: /^\{default,/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
  });
});

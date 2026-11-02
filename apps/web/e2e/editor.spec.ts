import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createEvent, open, signIn } from './helpers';

/**
 * Screens 5 and 6: branding and the layout/overlay editor (PHO-4, PHO-6). The canvas is exercised
 * through the editor's accessible controls (toolbar, layers, properties) and the keyboard, which is
 * what an operator without a mouse uses too.
 */

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
const layers = (page: Page) => page.getByRole('list', { name: 'Layers' });

async function openEditor(page: Page, eventId: string, kind: 'layout' | 'overlay') {
  await open(page, `/studio/events/${eventId}/branding`);
  await page.getByRole('link', { name: 'Design one' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/events/${eventId}/design/${kind}$`));
  await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
  // The canvas (react-konva) loads in the browser only.
  await expect(page.getByRole('application').locator('canvas').first()).toBeVisible();
}

test.describe('layout editor (PHO-4)', () => {
  test('add and edit text, undo and redo, nudge with the keyboard, and the design is saved', async ({ page }) => {
    await signIn(page);
    const id = await createEvent(page, 'Editor wedding', 'Photo Booth');
    await openEditor(page, id, 'layout');

    // A new event starts from the preset for its print size: photo slots and a title.
    await expect(layers(page).getByRole('button', { name: 'Photo 1' })).toBeVisible();

    await page.getByRole('button', { name: 'Add text' }).click();
    // The preset's title is also {eventName}: the new layer is the selected one.
    const titles = layers(page).getByRole('button', { name: '{eventName}' });
    await expect(titles).toHaveCount(2);
    await expect(layers(page).getByRole('button', { name: '{eventName}', pressed: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Text' }).fill('Hello booth');
    await expect(layers(page).getByRole('button', { name: 'Hello booth' })).toBeVisible();

    // Typing is one undo step; adding the element is another.
    const undo = page.getByRole('button', { name: 'Undo (Ctrl+Z)' });
    const redo = page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' });
    await undo.click();
    await expect(titles).toHaveCount(2);
    await undo.click();
    await expect(titles).toHaveCount(1);
    await redo.click();
    await redo.click();
    await expect(layers(page).getByRole('button', { name: 'Hello booth' })).toBeVisible();

    // Arrow keys nudge the selection by one pixel (ten with Shift).
    await layers(page).getByRole('button', { name: 'Hello booth' }).click();
    const x = page.getByRole('textbox', { name: 'X position' });
    const before = Number(await x.inputValue());
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(x).toHaveValue(String(before + 13));

    await saved(page);
    await page.reload();
    await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    await expect(layers(page).getByRole('button', { name: 'Hello booth' })).toBeVisible();

    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      // The drawing surface is a canvas; its contents are exposed through the layers panel.
      .exclude('[role="application"] canvas')
      .analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test('a save from another tab is never overwritten silently', async ({ page, context }) => {
    await signIn(page);
    const id = await createEvent(page, 'Two tabs', 'Photo Booth');
    await openEditor(page, id, 'layout');

    const other = await context.newPage();
    await open(other, `/studio/events/${id}/design/layout`);
    await other.getByRole('button', { name: 'Add a rectangle' }).click();
    await saved(other);

    // This tab's version is now stale: its save is refused, and the operator decides.
    await page.getByRole('button', { name: 'Add text' }).click();
    const conflict = page.getByRole('alert').filter({ hasText: 'This design was changed in another tab' });
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Keep mine' }).click();
    await saved(page);

    await other.reload();
    await other.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    await expect(layers(other).getByRole('button', { name: '{eventName}' })).toHaveCount(2);
    await expect(layers(other).getByRole('button', { name: 'Shape' })).toHaveCount(0);
  });
});

test.describe('branding and the overlay editor (screen 5, PHO-6)', () => {
  test('theme presets save; an overlay preset applies and previews on the branding page', async ({ page }) => {
    await signIn(page);
    const id = await createEvent(page, 'Overlay party');
    await open(page, `/studio/events/${id}/branding`);

    await page.getByRole('radio', { name: 'Forest' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'All changes saved' })).toBeVisible();
    await page.reload();
    await page.locator('html[data-hydrated="1"]').waitFor({ state: 'attached' });
    await expect(page.getByRole('radio', { name: 'Forest' })).toHaveAttribute('aria-checked', 'true');

    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    await openEditor(page, id, 'overlay');
    await page.getByRole('radio', { name: 'Templates' }).click();
    await page.getByRole('button', { name: 'Frame' }).click();
    await page.getByRole('button', { name: 'Use this design' }).click();
    await page.getByRole('radio', { name: 'Layers' }).click();
    await expect(layers(page).getByRole('button', { name: '{eventName}' })).toBeVisible();
    await saved(page);

    await open(page, `/studio/events/${id}/branding`);
    await expect(page.getByRole('img', { name: "The event's video overlay" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the editor' })).toBeVisible();
  });
});

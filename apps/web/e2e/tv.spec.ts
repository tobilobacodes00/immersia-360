import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

/**
 * Screens 24 and 17 from a TV's point of view (LIV-1): no login, a keyboard or remote only. Creating
 * a pairing code needs an operator and a control page that these tests don't use, so no code is ever
 * valid here: what is covered is the entry, its errors, and the redirect of an unpaired display.
 */

const box = (page: Page, n: number) => page.getByRole('textbox', { name: `Character ${n} of 6` });
const invalid = (page: Page) => page.getByRole('alert').filter({ hasText: /isn.t right/ });

test.describe('pairing a screen (LIV-1)', () => {
  test('the code goes into six boxes from the keyboard, and Enter submits it', async ({ page }) => {
    await open(page, '/tv');
    await expect(page.getByRole('heading', { level: 1, name: 'Connect this screen' })).toBeVisible();
    // The first box has focus on arrival: a remote can start typing at once.
    await expect(box(page, 1)).toBeFocused();

    // Lowercase is uppercased, and each character moves on to the next box.
    await page.keyboard.type('zzzzzz');
    for (let n = 1; n <= 6; n++) await expect(box(page, n)).toHaveValue('Z');
    // The sixth character hands focus to the button, so OK/Enter connects.
    await expect(page.getByRole('button', { name: 'Connect screen' })).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(invalid(page)).toBeVisible();
    await expect(page).toHaveURL(/\/tv$/);
    // The code stays in the boxes to be corrected.
    await expect(box(page, 1)).toHaveValue('Z');
  });

  test('characters a code never has are ignored, and Backspace steps back a box', async ({ page }) => {
    await open(page, '/tv');
    await expect(box(page, 1)).toBeFocused();
    // 0, O, 1, I and L look like each other and are not in the alphabet; punctuation neither.
    await page.keyboard.type('0O1IL-.k');
    await expect(box(page, 1)).toHaveValue('K');
    await expect(box(page, 2)).toBeFocused();
    await page.keyboard.type('7');
    await expect(box(page, 2)).toHaveValue('7');

    await page.keyboard.press('Backspace');
    await expect(box(page, 2)).toHaveValue('');
    await expect(box(page, 2)).toBeFocused();
    await expect(box(page, 1)).toHaveValue('K');
  });

  test('an incomplete code asks for the rest instead of calling the server', async ({ page }) => {
    await open(page, '/tv');
    await page.keyboard.type('abc');
    await page.getByRole('button', { name: 'Connect screen' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter all six characters.' })).toBeVisible();
    await expect(box(page, 4)).toBeFocused();
  });

  test('the pairing link pairs at once, and says so when the code is wrong', async ({ page }) => {
    await open(page, '/tv?code=zzzzzz');
    await expect(invalid(page)).toBeVisible();
    await expect(box(page, 6)).toHaveValue('Z');
  });

  test('a display with no pairing goes back to the pairing screen', async ({ page }) => {
    await page.goto('/tv/live');
    await expect(page).toHaveURL(/\/tv$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Connect this screen' })).toBeVisible();
  });

  test('a display whose pairing was removed forgets it and returns to pairing', async ({ page }) => {
    await open(page, '/tv');
    await page.evaluate(() => localStorage.setItem('immersia.display.token', 'x'.repeat(43)));
    // The feed refuses a token it doesn't know (401): the display clears it and starts over.
    await page.goto('/tv/live');
    await expect(page).toHaveURL(/\/tv$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Connect this screen' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('immersia.display.token'))).toBeNull();
  });

  test('has no axe violations, empty or showing an error', async ({ page }) => {
    await open(page, '/tv');
    const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

    await page.keyboard.type('zzzzzz');
    await page.keyboard.press('Enter');
    await expect(invalid(page)).toBeVisible();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

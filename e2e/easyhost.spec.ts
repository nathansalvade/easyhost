import { expect, test, type Page } from '@playwright/test';

// One EasyHost instance for the whole file: the tests follow a user from
// the first run onward, so they run in order.
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'first e2e password';
const NEW_PASSWORD = 'second e2e password';
let recoveryCode = '';

async function logIn(page: Page, password: string) {
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('first run shows the recovery code, then the empty Home screen', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create password' }).click();

  // Creating the password also logs in; the code must still be shown.
  await expect(page.getByRole('heading', { name: 'Your recovery code' })).toBeVisible();
  recoveryCode = await page.locator('.code').innerText();
  expect(recoveryCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText("You don't have any apps yet.")).toBeVisible();
  await expect(page.getByRole('link', { name: /^Install / })).toHaveCount(4);
});

test('a logged-out deep link returns there after logging in', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
  await logIn(page, 'not the password');
  await expect(page.getByText('Wrong password.')).toBeVisible();
  await logIn(page, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
});

test('login never sends the user to another site', async ({ page }) => {
  for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example']) {
    await page.context().clearCookies();
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await logIn(page, PASSWORD);
    await expect(page.getByText(/You don't have any apps yet/)).toBeVisible();
    expect(new URL(page.url()).host).toBe('127.0.0.1:3999');
  }
});

test('forgot password: the recovery code typed loosely resets the password', async ({ page, browser }) => {
  const other = await browser.newPage();
  await other.goto('/login');
  await logIn(other, PASSWORD);
  await expect(other.getByText(/You don't have any apps yet/)).toBeVisible();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Recovery code').fill(recoveryCode.toLowerCase().replaceAll('-', ' '));
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery code' })).toBeVisible();
  await expect(page.locator('.code')).not.toHaveText(recoveryCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/You don't have any apps yet/)).toBeVisible();

  // Every other session ended with the recovery.
  await other.reload();
  await expect(other.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await other.close();
});

test('with Docker off, a banner says so and an install ends with a readable problem', async ({ page }) => {
  await page.goto('/login');
  await logIn(page, NEW_PASSWORD);
  await expect(page.getByText("Docker isn't running on the server, so apps can't start.")).toBeVisible();

  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await page.locator('.grid .card', { hasText: 'Jellyfin' }).getByRole('button', { name: 'Install' }).click();
  await page.getByLabel('Name', { exact: true }).fill('My Movies');
  await expect(page.getByRole('button', { name: 'Install Jellyfin' })).toBeDisabled();
  await page.getByRole('button', { name: 'Use my-movies' }).click();
  await page.getByRole('button', { name: 'Install Jellyfin' }).click();

  const card = page.locator('.app-card', { hasText: 'my-movies' });
  await expect(card.locator('.badge')).toHaveText('Problem', { timeout: 15_000 });
  await card.getByRole('link', { name: 'my-movies' }).click();
  await expect(page.locator('.notice[role=alert]')).toHaveText(
    "Docker isn't running on the server, so the app couldn't be installed.",
  );
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('.error[role=alert]')).toHaveText(
    "This app didn't finish installing. Remove it and install it again.",
  );
});

test('on a phone, pages fit the screen and navigation sits at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await logIn(page, NEW_PASSWORD);
  await expect(page.locator('.app-card')).toHaveCount(1);
  for (const path of ['/', '/add', '/add?install=pihole', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal scroll on ${path}`).toBe(0);
    const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
    expect(nav!.y + nav!.height).toBeGreaterThan(800);
  }
});

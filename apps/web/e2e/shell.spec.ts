import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click(); await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible(); });

test('desktop routes, portfolio selector, and keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await expect(page.locator('.demo-badge')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Portfolio holdings' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your portfolios' })).toBeVisible();
  await page.getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'News', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Portfolios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your portfolios' })).toBeVisible();
  await page.getByLabel('Portfolio', { exact: true }).selectOption('demo-income');
  await expect(page.getByRole('heading', { name: 'Long term' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Portfolio holdings' }).getByRole('rowheader', { name: /NOVA/ })).toBeVisible();
  for (const [route, heading] of [['/assistant', 'Assistant'], ['/watchlist', 'Watchlist'], ['/settings', 'Settings']] as const) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  }
});

test('mobile navigation and layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Watchlist' }).click();
  await expect(page.getByRole('heading', { name: 'Watchlist', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
});

test('Assistant displays a completed mock answer', async ({ page }) => {
  await page.goto('/assistant');
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await page.getByLabel('Ask about your portfolio').fill('What do I own?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Assistant · MOCK', { exact: true })).toBeVisible();
  await expect(page.getByText('[Mock answer]', { exact: false }).first()).toBeVisible();
});




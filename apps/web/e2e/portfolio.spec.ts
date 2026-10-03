import { expect, test } from '@playwright/test';
import { closeConnections, getDatabase } from '@portfolio-pilot/db';
import { seedDemo } from '../../../packages/db/dist/seed.js';

test('reference trades persist, holdings reconcile, and two users own separate watchlists', async ({ page, browser }) => {
  test.setTimeout(90000);
  const url = process.env.PORTFOLIO_E2E_DATABASE_URL;
  test.skip(!url, 'Set PORTFOLIO_E2E_DATABASE_URL and run the API against that dedicated database.');
  const target = new URL(url!);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/portfolio_m08_verify') throw new Error('Use the dedicated local portfolio acceptance database.');
  const db = await getDatabase(url!);
  await seedDemo(db);
  const name = `UI reference ${crypto.randomUUID()}`;
  const quote = await db.quoteSnapshot.create({ data: { securityId: 'demo-acme-xnas', provider: 'e2e-reference', price: '125', currency: 'USD', isSynthetic: true, asOf: new Date() } });
  const security = await db.security.create({ data: { symbol: `E${Date.now()}`, exchangeMic: 'XNYS', name: 'E2E watch security', currency: 'USD' } });
  const bob = await browser.newContext();
  try {
    await page.goto('/portfolios');
    await page.getByRole('button', { name: 'Sign in as Alice Demo' }).click();
    await page.getByRole('button', { name: 'Create portfolio' }).click();
    await page.getByLabel('Portfolio name').fill(name);
    await page.getByRole('button', { name: 'Save portfolio' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('No holdings yet.', { exact: false })).toBeVisible();
    for (const [side, quantity, price, fees, date] of [['BUY', '10', '100', '2', '2025-01-01T00:00:00'], ['BUY', '5', '120', '1', '2025-01-02T00:00:00'], ['SELL', '6', '130', '3', '2025-01-03T00:00:00']]) {
      await page.getByRole('button', { name: 'Record transaction' }).click();
      await page.getByRole('combobox', { name: 'Security', exact: true }).selectOption('demo-acme-xnas');
      await page.getByRole('combobox', { name: 'Side', exact: true }).selectOption(side!);
      await page.getByLabel('Quantity', { exact: true }).fill(quantity!);
      await page.getByLabel('Price (USD)', { exact: true }).fill(price!);
      await page.getByLabel('Fees (USD)', { exact: true }).fill(fees!);
      await page.getByLabel('Executed at (UTC)').fill(date!.slice(0, 16));
      await page.getByRole('button', { name: 'Record trade', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
    const holdings = page.getByRole('table', { name: 'Portfolio holdings' });
    await expect(holdings.getByRole('cell', { name: '9', exact: true })).toBeVisible();
    for (const value of ['USD 961.80', 'USD 135.80', 'USD 1,125.00', 'USD 163.20', '100.00%']) await expect(holdings.getByRole('cell', { name: value, exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'ACME: 100.00%' })).toBeVisible();
    await page.reload();
    await page.getByLabel('Portfolio', { exact: true }).selectOption({ label: name });
    await expect(holdings.getByRole('cell', { name: 'USD 961.80', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Watchlist', exact: true }).click();
    await page.getByRole('button', { name: 'Add watchlist item', exact: true }).click();
    await page.getByRole('combobox', { name: 'Security', exact: true }).selectOption(security.id);
    await page.getByRole('button', { name: 'Save watchlist item' }).click();
    await expect(page.getByText(`${security.symbol} · XNYS · USD · E2E watch security`, { exact: true })).toBeVisible();
    const other = await bob.newPage(); await other.goto('/portfolios');
    await other.getByRole('button', { name: 'Sign in as Bob Demo' }).click();
    await expect(other.getByLabel('Portfolio', { exact: true }).locator('option', { hasText: name })).toHaveCount(0);
    await other.getByRole('button', { name: 'Create portfolio' }).click(); await other.getByLabel('Portfolio name').fill(`${name} Bob`); await other.getByRole('button', { name: 'Save portfolio' }).click();
    await expect(other.getByRole('heading', { name: `${name} Bob`, exact: true })).toBeVisible();
    await other.getByRole('link', { name: 'Watchlist', exact: true }).click();
    await expect(other.getByText(`${security.symbol} · XNYS · USD · E2E watch security`, { exact: true })).toHaveCount(0);
    await other.getByRole('button', { name: 'Add watchlist item', exact: true }).click(); await other.getByRole('combobox', { name: 'Security', exact: true }).selectOption(security.id); await other.getByRole('button', { name: 'Save watchlist item' }).click();
    await expect(other.getByText(`${security.symbol} · XNYS · USD · E2E watch security`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Remove ${security.symbol}`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Remove watchlist item' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: `Remove ${security.symbol}`, exact: true })).toBeFocused();
    await page.getByRole('button', { name: `Remove ${security.symbol}`, exact: true }).click(); await page.getByRole('button', { name: 'Confirm removal' }).click();
    await page.reload(); await expect(page.getByText(`${security.symbol} · XNYS · USD · E2E watch security`, { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Portfolios', exact: true }).click();
    await page.getByLabel('Portfolio', { exact: true }).selectOption({ label: name });
    const id = await page.getByLabel('Portfolio', { exact: true }).inputValue();
    // Add enough real, paired ledger records to exercise the second history page.
    for (let index = 0; index < 8; index++) {
      const response = await page.request.post(`/api/portfolios/${id}/transactions`, {
        headers: { origin: 'http://127.0.0.1:5173', 'Idempotency-Key': crypto.randomUUID() },
        data: { security: { symbol: 'ACME', exchangeMic: 'XNAS', currency: 'USD' }, side: index % 2 ? 'SELL' : 'BUY', quantity: '0.1', price: '106.8666666667', fees: '0', occurredAt: `2025-02-0${index + 1}T00:00:00.000Z` }
      });
      expect(response.status()).toBe(200);
      expect((await response.json()).replayed).toBe(false);
    }
    const liquidation = await page.request.post(`/api/portfolios/${id}/transactions`, {
      headers: { origin: 'http://127.0.0.1:5173', 'Idempotency-Key': crypto.randomUUID() },
      data: { security: { symbol: 'ACME', exchangeMic: 'XNAS', currency: 'USD' }, side: 'SELL', quantity: '9', price: '90', fees: '2', occurredAt: '2025-03-01T00:00:00.000Z' }
    });
    expect(liquidation.status()).toBe(200);
    expect((await liquidation.json()).replayed).toBe(false);
    await page.reload(); await page.getByLabel('Portfolio', { exact: true }).selectOption(id);
    await expect(holdings.getByRole('rowheader', { name: /Sold out/ })).toBeVisible();
    await expect(holdings.getByRole('cell', { name: 'USD -18.00', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Transactions', exact: true }).getByRole('row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Edit portfolio', exact: true }).click(); await page.getByLabel('Portfolio name').fill(`${name} Renamed`); await page.getByRole('button', { name: 'Save portfolio' }).click();
    await expect(page.getByRole('heading', { name: `${name} Renamed`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Archive portfolio', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Archive portfolio', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm archive', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Record transaction', exact: true })).toBeDisabled();
    await page.reload(); await page.getByLabel('Portfolio', { exact: true }).selectOption(id);
    await expect(page.getByRole('heading', { name: `${name} Renamed · Archived (read-only)`, exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Transactions', exact: true })).toBeVisible();
    // A rejected authenticated read must immediately remove all account content.
    await page.route('**/api/portfolios', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.', requestId: crypto.randomUUID() } }) }));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in to PortfolioPilot', exact: true })).toBeVisible();
  } finally {
    await bob.close();
    await db.portfolio.deleteMany({ where: { name: { in: [name, `${name} Bob`, `${name} Renamed`] }, ownerId: { in: ['demo-alice', 'demo-bob'] } } });
    await db.watchlistEntry.deleteMany({ where: { securityId: security.id } });
    await db.security.delete({ where: { id: security.id } }); await db.quoteSnapshot.delete({ where: { id: quote.id } }); await closeConnections();
  }
});


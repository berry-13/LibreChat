import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false });

test('revoking a disconnected MCP account requires confirmation @scenario:mcp-revoke-confirm', async ({
  page,
}) => {
  const server = 'e2e-memory';
  const requests: string[] = [];
  await page.route('**/api/mcp/connection/status', (route) =>
    route.fulfill({
      json: {
        success: true,
        connectionStatus: { [server]: { connectionState: 'disconnected', requiresOAuth: true } },
      },
    }),
  );
  await page.route('**/api/user/plugins', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON().action);
    await route.fulfill({ json: { message: 'Success' } });
  });
  await page.goto('/c/new');
  const settings = page.getByRole('button', { name: 'MCP Settings' });
  if ((await settings.getAttribute('aria-pressed')) !== 'true') await settings.click();
  const card = page.getByLabel(/^E2E Memory - /);
  await card.hover();
  const revoke = card.getByRole('button', { name: 'Revoke', exact: true });
  await revoke.click();
  const dialog = page.getByRole('alertdialog', { name: 'Revoke access for e2e-memory?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(revoke).toBeFocused();
  expect(requests).toEqual([]);
  await revoke.press('Enter');
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect.poll(() => requests).toEqual(['uninstall']);
});

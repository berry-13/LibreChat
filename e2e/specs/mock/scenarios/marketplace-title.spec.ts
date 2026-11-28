import { expect, test } from '@playwright/test';

test('@scenario:marketplace-tab-title uses the deployment title on direct Marketplace visits', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('unseenTabBadge', 'false'));
  let appTitle = 'Acme';
  await page.route(
    (url) => url.pathname === '/api/config',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), appTitle } });
    },
  );

  await page.goto('/agents');
  await expect(page).toHaveTitle('Agent Marketplace | Acme');

  appTitle = '';
  await page.goto('/agents/all');
  await expect(page).toHaveTitle('Agent Marketplace | LibreChat');
});

import { expect, test } from '@playwright/test';
import { mockAnonymousSession } from './support/api-mocks';

const inviteAccess = {
  invite_id: 'invite-1',
  score_id: 'score-1',
  score_title: 'Collab Score',
  inviter: { display_name: 'Owner', email: 'owner@example.com', avatar_url: null },
  email: 'member@example.com',
  role: 'EDITOR',
  status: 'PENDING',
  expires_at: null,
  requires_login: true,
  can_accept: false,
};

test('invite login and registration links preserve returnUrl', async ({ page }) => {
  await mockAnonymousSession(page);
  await page.route('**/api/v1/invites/invite-token', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: inviteAccess }),
  }));

  await page.goto('/en/invite/invite-token');
  await expect(page.getByRole('heading', { name: 'Collab Score' })).toBeVisible();

  await page.getByRole('link', { name: 'Accept invite' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?/);
  const loginUrl = new URL(page.url());
  expect(loginUrl.searchParams.get('returnUrl')).toBe('/invite/invite-token?accept=1');

  await page.locator('a[href*="/auth/register?returnUrl="]').click();
  await expect(page).toHaveURL(/\/auth\/register\?/);
  const registerUrl = new URL(page.url());
  expect(registerUrl.searchParams.get('returnUrl')).toBe('/invite/invite-token?accept=1');
});

import { expect, test } from '@playwright/test';
import { mockGuestPreview } from './support/guest-preview';

const scoreId = 'shell-score';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  );
});

test('anonymous users can access public and external shells without AppShell sidebar', async ({ page }) => {
  await mockGuestPreview(page, 'shell-preview');
  for (const path of ['/en/subscriptions', '/en/help', '/en/preview/shell-preview']) {
    await page.goto(path);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page.getByRole('link', { name: 'Upload' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  }

  await expect(page.getByRole('heading', { name: 'Guest Score' })).toBeVisible();
});

test('invite routes use InviteShell instead of public marketing navigation', async ({ page }) => {
  await page.route('**/api/v1/invites/shell-invite', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
          invite_id: 'invite-1',
          score_id: scoreId,
          score_display_title: 'Invite Shell Score',
          inviter: { display_name: 'Owner', email: 'owner@example.com', avatar_url: null },
          email: 'member@example.com',
          role: 'EDITOR',
          status: 'PENDING',
          expires_at: null,
          requires_login: true,
          can_accept: false,
        }),
    })
  );

  await page.goto('/en/invite/shell-invite');
  await expect(page).not.toHaveURL(/\/auth\/login/);
  await expect(page.getByRole('heading', { name: 'Invite Shell Score' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upload' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
});

test('auth routes use the focused AuthShell instead of app or marketing navigation', async ({ page }) => {
  for (const path of [
    '/en/auth/login',
    '/en/auth/register',
    '/en/auth/forgot-password',
    '/en/auth/reset-password?token=shell-token',
  ]) {
    await page.goto(path);
    await expect(page).not.toHaveURL(/\/auth\/login\?returnUrl=/);
    await expect(page.getByRole('link', { name: 'Upload' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Return Home' })).toBeVisible();
  }
});

test('auth routes remain focused and usable on mobile viewports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of [
    '/zh/auth/login',
    '/zh/auth/register',
    '/zh/auth/forgot-password',
    '/zh/auth/reset-password?token=shell-token',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible();
    await expect(page.getByRole('link', { name: '上传' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '设置' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '定价' })).toHaveCount(0);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    });
    expect(hasHorizontalOverflow).toBe(false);
  }
});

test('anonymous users are redirected from app and workspace routes with returnUrl', async ({ page }) => {
  const protectedPaths = [
    '/zh/library?view=all',
    `/zh/score/${scoreId}`,
    `/zh/score/${scoreId}/edit`,
    `/zh/score/${scoreId}/practice`,
    `/zh/review/${scoreId}`,
    `/zh/review/${scoreId}/edit`,
  ];

  for (const path of protectedPaths) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/zh\/auth\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(path);
  }
});

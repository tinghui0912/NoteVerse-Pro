import { expect, test, type Page } from '@playwright/test';

async function mockLoggedOutProfile(page: Page) {
  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        code: 'unauthorized',
        message: 'Authentication required',
      }),
    });
  });

  await page.route('**/api/v1/profile**', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        code: 'unauthorized',
        message: 'Authentication required',
      }),
    });
  });
}

test.describe('public routes and authentication guard', () => {
  test.beforeEach(async ({ page }) => {
    await mockLoggedOutProfile(page);
  });

  test('renders localized login pages', async ({ page }) => {
    await page.context().addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'zh',
        domain: 'localhost',
        path: '/',
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await expect(page.getByLabel('电子邮箱')).toBeVisible();
    await expect(page.getByLabel('密码')).toBeVisible();

    await page.goto('/en/login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('preserves the return URL when redirecting protected routes', async ({ page }) => {
    await page.goto('/en/history?view=list', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/en\/login\?/);
    let redirectedUrl = new URL(page.url());
    expect(redirectedUrl.searchParams.get('returnUrl')).toBe('/en/history?view=list');

    await page.goto('/share/smoke-share?source=final', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/login\?/);
    redirectedUrl = new URL(page.url());
    expect(redirectedUrl.pathname).toBe('/en/login');
    expect(redirectedUrl.searchParams.get('returnUrl')).toBe(
      '/share/smoke-share?source=final'
    );
  });
});

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

async function mockPublicShare(page: Page) {
  await page.route('**/api/v1/shares/public-share', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        code: 'share_retrieved',
        message: 'Share retrieved',
        data: {
          task: {
            task_id: 'task-public',
            state: 'SUCCESS',
            progress: 100,
            title: 'Public Score',
            difficulty: '',
            files: {},
          },
          share_info: {
            shared_by: 'Public User',
            expires_at: null,
            can_download: false,
            can_edit: true,
          },
        },
      }),
    });
  });
  await page.route('**/api/v1/shares/public-share/download/final_xml', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: '<?xml version="1.0"?><score-partwise version="4.0" />',
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
    const redirectedUrl = new URL(page.url());
    expect(redirectedUrl.searchParams.get('returnUrl')).toBe('/en/history?view=list');
  });

  test('opens shares anonymously but still protects editor navigation', async ({ page }) => {
    await mockPublicShare(page);
    await page.context().addCookies([{
      name: 'NEXT_LOCALE',
      value: 'zh',
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    }]);

    await page.goto('/share/public-share?source=final', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Public Score')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/share/public-share');

    const editLink = page.getByRole('link', { name: '编辑' });
    const editorUrl = new URL(await editLink.getAttribute('href') ?? '', page.url());
    const expectedReturnUrl = `${editorUrl.pathname}${editorUrl.search}`;
    await editLink.click();

    await expect(page).toHaveURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(expectedReturnUrl);

    await page.goto('/en/share/public-share', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Public Score')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/en/share/public-share');

    await page.goto('/en/share/manage/settings?tab=members', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/en\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(
      '/en/share/manage/settings?tab=members'
    );
  });
});

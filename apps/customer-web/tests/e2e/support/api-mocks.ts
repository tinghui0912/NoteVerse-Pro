import type { Page } from '@playwright/test';

const testUserProfile = {
  user: {
    id: 1,
    email: 'owner@example.com',
    display_name: 'Owner',
    avatar_url: null,
    is_active: true,
  },
};

export async function mockAnonymousSession(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        public_code: 'unauthorized',
        public_message: 'Unauthorized',
      }),
    })
  );
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        public_code: 'unauthorized',
        public_message: 'Unauthorized',
      }),
    })
  );
}

export async function mockAuthenticatedSession(page: Page): Promise<void> {
  const authCookieName = process.env.AUTH_COOKIE_NAME;
  const refreshCookieName = process.env.REFRESH_COOKIE_NAME;
  if (!authCookieName || !refreshCookieName) {
    throw new Error('AUTH_COOKIE_NAME and REFRESH_COOKIE_NAME are required for authenticated E2E sessions.');
  }
  await page.context().addCookies([
    {
      name: authCookieName,
      value: 'test-session',
      domain: 'localhost',
      path: '/',
    },
    {
      name: refreshCookieName,
      value: 'test-refresh',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null }),
    })
  );
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: testUserProfile }),
    })
  );
  await page.route('**/api/v1/me/invites**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { count: 0 } }),
    })
  );
}

export async function mockRealtimeEvents(page: Page): Promise<void> {
  await page.route('**/api/v1/realtime/events**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ': test stream closed\n\n',
    })
  );
}

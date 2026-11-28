import { AUTH_COOKIE_NAME } from '../../../src/generated/browser-protocol';
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
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'unauthorized', request_id: 'e2e-request',
      }),
    })
  );
}

export async function mockAuthenticatedSession(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: 'test-session',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(testUserProfile),
    })
  );
  await page.route('**/api/v1/me/invites**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], next_cursor: null }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0 }),
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

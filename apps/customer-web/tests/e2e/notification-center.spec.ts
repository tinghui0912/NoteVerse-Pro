import { expect, test } from '@playwright/test';
import { mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const pendingInvites = [
  {
    invite_id: 'invite-1',
    score_id: 'score-pending',
    score_display_title: 'Pending Collaboration',
    inviter: {
      display_name: 'Collaborator',
      email: 'collab@example.com',
      avatar_url: null,
    },
    email: 'owner@example.com',
    role: 'PRACTITIONER',
    status: 'PENDING',
    expires_at: null,
    created_at: '2026-07-01T08:00:00Z',
  },
];

const notifications = [
  {
    notification_id: 'notification-1',
    kind: 'score_invite.accepted',
    invite_id: 'invite-2',
    score_id: 'score-accepted',
    score_display_title: 'Accepted Collaboration',
    actor: {
      display_name: 'Member',
      email: 'member@example.com',
      avatar_url: null,
    },
    read_at: null,
    created_at: '2026-07-01T09:00:00Z',
  },
  {
    notification_id: 'notification-2',
    kind: 'score_invite.declined',
    invite_id: 'invite-3',
    score_id: 'score-declined',
    score_display_title: 'Declined Collaboration',
    actor: {
      display_name: 'Reader',
      email: 'reader@example.com',
      avatar_url: null,
    },
    read_at: '2026-07-01T09:10:00Z',
    created_at: '2026-07-01T09:10:00Z',
  },
];
const failedProcessingNotification = {
  notification_id: 'notification-processing-failed',
  kind: 'import.failed',
  job_id: 'failed-job-1',
  import_display_title: null,
  read_at: null,
  created_at: '2026-07-01T09:20:00Z',
};
const completedProcessingNotification = {
  notification_id: 'notification-processing-completed',
  kind: 'import.completed',
  job_id: 'ready-job-1',
  import_display_title: 'Ready Score',
  score_id: null,
  score_display_title: null,
  read_at: '2026-07-01T09:35:00Z',
  created_at: '2026-07-01T09:30:00Z',
};
const confirmedProcessingNotification = {
  ...completedProcessingNotification,
  notification_id: 'notification-processing-confirmed',
  score_id: 'ready-score-1',
  score_display_title: 'Ready Score',
};

test('notification center combines pending invites and update notifications', async ({ page }) => {
  let markReadCalled = false;

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await page.route('**/api/v1/me/invites', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: pendingInvites, next_cursor: null }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 1 }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(notifications),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/me/notifications/notification-1/read', (route) => {
    markReadCalled = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...notifications[0],
        read_at: '2026-07-01T09:05:00Z',
      }),
    });
  });
  await page.route('**/api/v1/scores/score-accepted**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(null),
    })
  );

  await page.route('**/api/v1/import-jobs?*', (route) =>
    route.fulfill({ json: { items: [], page: 1, page_size: 20, total: 0, total_pages: 0 } })
  );
  await page.goto('/en/upload');
  const bell = page.getByRole('button', { name: 'Notifications' });
  await expect(bell).toBeVisible();
  await expect(bell.getByText('2', { exact: true })).toBeVisible();

  await bell.click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Action required' })).toBeVisible();
  await expect(page.getByText('Pending Collaboration')).toBeVisible();
  await expect(page.getByText('Practitioner', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Updates' })).toBeVisible();
  await expect(page.getByText('Member accepted your invitation')).toBeVisible();
  await expect(page.getByText('Accepted Collaboration')).toBeVisible();
  await expect(page.getByText('Reader declined your invitation')).toBeVisible();
  await expect(page.getByText('Declined Collaboration')).toBeVisible();

  await page.getByRole('button', { name: 'Unread' }).click();
  await expect(page.getByText('Member accepted your invitation')).toBeVisible();
  await expect(page.getByText('Reader declined your invitation')).toBeHidden();

  await page.getByText('Member accepted your invitation').click();
  await expect.poll(() => markReadCalled).toBe(true);
});

test('failed processing notification opens Import Activity', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 1 }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([failedProcessingNotification]),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/me/notifications/notification-processing-failed/read', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...failedProcessingNotification,
        read_at: '2026-07-01T09:25:00Z',
      }),
    })
  );
  await page.route('**/api/v1/import-jobs?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            job_id: 'failed-job-1',
            state: 'FAILURE',
            progress: 0,
            display_title: 'Failed upload',
          },
        ],
        ...{ page: 1, page_size: 20, total: 1, total_pages: 1 },
      },
    })
  );

  await page.goto('/en/upload');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByText('Score processing failed').click();

  await expect(page).toHaveURL(/\/upload#import-activity$/);
});

test('confirmed processing notification opens created score', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 1 }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([confirmedProcessingNotification]),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/me/notifications/notification-processing-confirmed/read', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...confirmedProcessingNotification,
        read_at: '2026-07-01T09:40:00Z',
      }),
    })
  );
  await page.route('**/api/v1/scores/ready-score-1**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(null),
    })
  );

  await page.goto('/en/upload');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByText('Score processing completed').click();

  await expect(page).toHaveURL(/\/score\/ready-score-1$/);
});

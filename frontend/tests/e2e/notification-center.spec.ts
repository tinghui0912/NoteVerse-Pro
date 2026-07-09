import { expect, test } from '@playwright/test';

const userProfile = {
  user: {
    id: 1,
    email: 'owner@example.com',
    display_name: 'Owner',
    avatar_url: null,
    is_active: true,
  },
};

const pendingInvites = [
  {
    invite_id: 'invite-1',
    score_id: 'score-pending',
    score_title: 'Pending Collaboration',
    inviter: { display_name: 'Collaborator', email: 'collab@example.com', avatar_url: null },
    email: 'owner@example.com',
    role: 'EDITOR',
    status: 'PENDING',
    expires_at: null,
    created_at: '2026-07-01T08:00:00Z',
  },
];

const notifications = [
  {
    notification_id: 'notification-1',
    type: 'score_invite.accepted',
    title: 'Invite accepted',
    body: 'Member accepted your invite.',
    resource_type: 'score',
    resource_id: 'score-accepted',
    score_id: 'score-accepted',
    actor: { display_name: 'Member', email: 'member@example.com', avatar_url: null },
    data: { invite_id: 'invite-2', score_title: 'Accepted Collaboration', role: 'EDITOR' },
    read_at: null,
    created_at: '2026-07-01T09:00:00Z',
  },
  {
    notification_id: 'notification-2',
    type: 'score_invite.declined',
    title: 'Invite declined',
    body: 'Member declined your invite.',
    resource_type: 'score',
    resource_id: 'score-declined',
    score_id: 'score-declined',
    actor: { display_name: 'Reader', email: 'reader@example.com', avatar_url: null },
    data: { invite_id: 'invite-3', score_title: 'Declined Collaboration', role: 'VIEWER' },
    read_at: '2026-07-01T09:10:00Z',
    created_at: '2026-07-01T09:10:00Z',
  },
];

const failedProcessingNotification = {
  notification_id: 'notification-processing-failed',
  type: 'import.failed',
  title: 'Processing failed',
  body: 'We could not finish processing your score.',
  resource_type: 'job',
  resource_id: 'failed-job-1',
  score_id: null,
  actor: null,
  data: { job_id: 'failed-job-1', code: 'unknown_error', error_type: 'PipelineError' },
  read_at: null,
  created_at: '2026-07-01T09:20:00Z',
};

const completedProcessingNotification = {
  notification_id: 'notification-processing-completed',
  type: 'import.completed',
  title: 'Processing complete',
  body: 'Your score is ready for review.',
  resource_type: 'job',
  resource_id: 'ready-job-1',
  score_id: null,
  actor: null,
  data: { job_id: 'ready-job-1', job_title: 'Ready Score' },
  read_at: null,
  created_at: '2026-07-01T09:30:00Z',
};

const confirmedProcessingNotification = {
  ...completedProcessingNotification,
  notification_id: 'notification-processing-confirmed',
  score_id: 'ready-score-1',
  data: {
    job_id: 'ready-job-1',
    job_title: 'Ready Score',
    score_id: 'ready-score-1',
    score_title: 'Ready Score',
  },
};

test('notification center combines pending invites and update notifications', async ({ page }) => {
  let markReadCalled = false;

  await page.context().addCookies([
    {
      name: 'noteverse_session',
      value: 'test-session',
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
      body: JSON.stringify({ success: true, data: userProfile }),
    })
  );
  await page.route('**/api/v1/me/invites', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: pendingInvites }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { count: 1 } }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: notifications }),
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
        success: true,
        data: { ...notifications[0], read_at: '2026-07-01T09:05:00Z' },
      }),
    });
  });
  await page.route('**/api/v1/scores/score-accepted**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null }),
    })
  );

  await page.goto('/en');
  const bell = page.getByRole('button', { name: 'Notifications' });
  await expect(bell).toBeVisible();
  await expect(bell.getByText('2', { exact: true })).toBeVisible();

  await bell.click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Action required' })).toBeVisible();
  await expect(page.getByText('Pending Collaboration')).toBeVisible();
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

test('failed processing notification opens the matching upload job', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'noteverse_session',
      value: 'test-session',
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
      body: JSON.stringify({ success: true, data: userProfile }),
    })
  );
  await page.route('**/api/v1/me/invites', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { count: 1 } }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [failedProcessingNotification] }),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/me/notifications/notification-processing-failed/read', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { ...failedProcessingNotification, read_at: '2026-07-01T09:25:00Z' },
      }),
    })
  );
  await page.route('**/api/v1/import-jobs/failed-job-1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          job_id: 'failed-job-1',
          score_id: null,
          state: 'FAILURE',
          progress: 0,
          current_step: 'ocr',
          title: 'Failed upload',
          taxonomy_tags: [],
          thumbnail_artifact_id: null,
          created_at: '2026-07-01T09:00:00Z',
          updated_at: '2026-07-01T09:20:00Z',
          started_at: '2026-07-01T09:00:00Z',
          finished_at: '2026-07-01T09:20:00Z',
          error: 'OCR failed',
          code: 'unknown_error',
          steps: [],
          artifacts: {},
          upload_ids: [],
        },
      }),
    })
  );

  await page.goto('/en');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByText('Score processing failed').click();

  await expect(page).toHaveURL(/\/upload\?job_id=failed-job-1$/);
});

test('completed processing notification opens job review', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'noteverse_session',
      value: 'test-session',
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
      body: JSON.stringify({ success: true, data: userProfile }),
    })
  );
  await page.route('**/api/v1/me/invites', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { count: 1 } }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [completedProcessingNotification] }),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/me/notifications/notification-processing-completed/read', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { ...completedProcessingNotification, read_at: '2026-07-01T09:35:00Z' },
      }),
    })
  );

  await page.goto('/en');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByText('Score processing completed').click();

  await expect(page).toHaveURL(/\/review\/ready-job-1$/);
});

test('confirmed processing notification opens created score', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'noteverse_session',
      value: 'test-session',
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
      body: JSON.stringify({ success: true, data: userProfile }),
    })
  );
  await page.route('**/api/v1/me/invites', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    })
  );
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { count: 1 } }),
    })
  );
  await page.route('**/api/v1/me/notifications', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [confirmedProcessingNotification] }),
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/me/notifications/notification-processing-confirmed/read', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { ...confirmedProcessingNotification, read_at: '2026-07-01T09:40:00Z' },
      }),
    })
  );
  await page.route('**/api/v1/scores/ready-score-1**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null }),
    })
  );

  await page.goto('/en');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByText('Score processing completed').click();

  await expect(page).toHaveURL(/\/score\/ready-score-1$/);
});

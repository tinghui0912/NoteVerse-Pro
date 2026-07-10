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

const apiError = (code: string, message: string) => ({
  success: false,
  code,
  error: message,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify(apiError('unauthorized', 'Unauthorized')),
    })
  );
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify(apiError('unauthorized', 'Unauthorized')),
    })
  );
});

test('public score errors use the shared resource error state', async ({ page }) => {
  await page.route('**/api/v1/publications/missing-public-score', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(apiError('score_not_found', 'Score not found')),
    })
  );
  await page.route('**/api/v1/publications/missing-public-score/content', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(apiError('score_not_found', 'Score not found')),
    })
  );

  await page.goto('/en/public/missing-public-score');

  await expect(page.getByRole('heading', { name: 'Load Failed' })).toBeVisible();
  await expect(page.getByText('The score does not exist or has been deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
});

test('practice score errors stop the preparation state and show the shared resource error', async ({ context, page }) => {
  const releaseScoreResponse = deferred<void>();

  await context.addCookies([{ name: 'noteverse_session', value: 'session', domain: 'localhost', path: '/' }]);
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
  );
  await page.route('**/api/v1/me/notifications/unread-count', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { count: 0 } }) })
  );
  await page.route('**/api/v1/scores/missing-practice-score', async (route) => {
    await releaseScoreResponse.promise;
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(apiError('score_not_found', 'Score not found')),
    });
  });

  await page.goto('/en/score/missing-practice-score/practice');

  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await expect(page.getByText('Loading score data...')).toBeVisible();
  await expect(page.getByText('Preparing your practice...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start Practice' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End Practice' })).toHaveCount(0);

  releaseScoreResponse.resolve();

  await expect(page.getByRole('heading', { name: 'Practice Mode' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Load Failed' })).toBeVisible();
  await expect(page.getByText('The score does not exist or has been deleted.')).toBeVisible();
  await expect(page.getByText('Preparing your practice...')).toHaveCount(0);
  await expect(page.getByText('Practice mode score display area')).toHaveCount(0);
});

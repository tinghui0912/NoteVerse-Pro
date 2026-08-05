import { expect, test } from '@playwright/test';
import { mockAnonymousSession, mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const apiError = (code: string, message: string) => ({
  success: false,
  public_code: code,
  public_message: message,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test.beforeEach(async ({ page }) => {
  await mockAnonymousSession(page);
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

test('practice score errors stop the preparation state and show the shared resource error', async ({ page }) => {
  const releaseScoreResponse = deferred<void>();

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
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

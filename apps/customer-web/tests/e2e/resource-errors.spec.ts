import { expect, test } from '@playwright/test';
import { mockAnonymousSession, mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const apiError = (code: string) => ({ code, request_id: 'e2e-request' });

test.beforeEach(async ({ page }) => {
  await mockAnonymousSession(page);
});


test('direct Practice enters Setup with only a score metadata read', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  const representationRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/scores/') || path.startsWith('/api/v1/practice/')) {
      representationRequests.push(path);
    }
  });
  for (const path of ['**/api/v1/scores/**', '**/api/v1/practice/**']) {
    await page.route(path, route => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(apiError('score_not_found')),
    }));
  }

  await page.goto('/en/score/missing-practice-score/practice?practiceRevisionId=missing-revision');

  await expect(page).toHaveURL(/\/practice\/setup\?practiceRevisionId=missing-revision$/);
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await expect(page.getByText('Preparing your practice...')).toHaveCount(0);
  await expect(page.getByText('Practice mode score display area')).toHaveCount(0);
  expect(representationRequests).toEqual(['/api/v1/scores/missing-practice-score']);
});

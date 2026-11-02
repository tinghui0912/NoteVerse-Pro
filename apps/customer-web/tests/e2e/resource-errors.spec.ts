import { expect, test } from '@playwright/test';
import { mockAnonymousSession, mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const apiError = (code: string, message: string) => ({
  success: false,
  public_code: code,
  public_message: message,
});

test.beforeEach(async ({ page }) => {
  await mockAnonymousSession(page);
});


test('direct Practice requires Setup without reading unavailable Score or Source', async ({ page }) => {
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
      body: JSON.stringify(apiError('score_not_found', 'Score not found')),
    }));
  }

  await page.goto('/en/score/missing-practice-score/practice?practiceRevisionId=missing-revision');

  await expect(page.getByRole('status')).toHaveText('Complete setup before starting practice.');
  await expect(page.getByRole('button', { name: 'Practice setup', exact: true })).toBeVisible();
  await expect(page.getByText('Preparing your practice...')).toHaveCount(0);
  await expect(page.getByText('Practice mode score display area')).toHaveCount(0);
  expect(representationRequests).toEqual([]);
});

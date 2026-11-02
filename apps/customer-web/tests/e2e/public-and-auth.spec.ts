import { expect, test } from '@playwright/test';
import { mockGuestPreview } from './support/guest-preview';

test('protected routes preserve return URL while guest previews stay anonymous', async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/me/profile**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.goto('/en/library?view=all');
  await expect(page).toHaveURL(/\/auth\/login\?/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/en/library?view=all');

  await page.goto('/en/my-scores?view=all');
  await expect(page).toHaveURL(/\/auth\/login\?/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/en/my-scores?view=all');

  await mockGuestPreview(page, 'preview-token');
  await page.goto('/en/preview/preview-token');
  await expect(page.getByRole('heading', { name: 'Guest Score' })).toBeVisible();
});

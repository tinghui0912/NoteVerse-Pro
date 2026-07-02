import { expect, test } from '@playwright/test';

test('protected routes preserve return URL while share grants stay anonymous', async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/profile**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.goto('/en/library?view=all');
  await expect(page).toHaveURL(/\/en\/login\?/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/en/library?view=all');

  await page.goto('/en/my-scores?view=published');
  await expect(page).toHaveURL(/\/en\/login\?/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/en/my-scores?view=published');

  await page.route('**/api/v1/score-grants/public-token', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      score_id: 'score-public', revision_id: 'revision-public', title: 'Public Score', taxonomy_tags: [],
      shared_by: { display_name: 'Sharer', avatar_url: null },
      shared_at: '2026-06-23T00:00:00Z',
      metadata: null, artifacts: [], capabilities: {
        can_view: true, can_edit: false, can_delete: false, can_manage_sharing: false,
        can_download: false, can_practice: true, can_publish: false,
      },
    } }),
  }));
  await page.route('**/api/v1/score-grants/public-token/content', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      score_id: 'score-public', revision_id: 'revision-public', mime_type: 'application/xml',
      content: '<?xml version="1.0"?><score-partwise version="4.0"><part-list/></score-partwise>',
    } }),
  }));
  await page.goto('/en/share/public-token');
  await expect(page.getByText('Public Score')).toBeVisible();
});

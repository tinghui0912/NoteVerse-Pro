import { expect, test } from '@playwright/test';

const xml = '<?xml version="1.0"?><score-partwise version="4.0"><part-list/></score-partwise>';
const capabilities = (download: boolean, edit: boolean) => ({
  can_view: true, can_edit: edit, can_delete: false, can_manage_sharing: false,
  can_download: download, can_practice: true, can_publish: false, can_approve: false,
});

test('anonymous grant UI follows backend capabilities', async ({ page }) => {
  await page.route('**/api/v1/score-grants/view-token', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      score_id: 'score-1', revision_id: 'revision-1', title: 'Shared Score', taxonomy_tags: [],
      shared_by: { display_name: 'Sharer', avatar_url: null },
      shared_at: '2026-06-23T00:00:00Z',
      capabilities: capabilities(false, false), metadata: null, artifacts: [],
    } }),
  }));
  await page.route('**/api/v1/score-grants/view-token/content', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      score_id: 'score-1', revision_id: 'revision-1', content: xml, mime_type: 'application/xml',
    } }),
  }));
  await page.goto('/en/share/view-token');
  await expect(page.getByRole('heading', { name: 'Shared Score' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

test('My Scores keeps owned scores, processing, review and failed views with library/delete actions', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  const scoreRequests: string[] = [];
  const score = {
    score_id: 'owned-score', title: 'Owned sonata', taxonomy_tags: [], version: 1,
    head_revision_id: 'revision', in_library: false, metadata: null, input_assets: [],
    derived_assets: {
      preview: { status: 'pending', asset_id: null, revision_id: null, is_fallback: false },
      audio: { status: 'pending', asset_id: null, revision_id: null, is_fallback: false },
    },
    capabilities: { can_view: true, can_edit: true, can_delete: true, can_manage_sharing: true,
      can_manage_members: true, can_download: true, can_practice: true },
    created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-21T00:00:00Z',
  };
  await page.route('**/api/v1/my-scores?*', route => {
    scoreRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: [score], pagination: { total: 1, page: 1, page_size: 20, total_pages: 1 },
    }) });
  });
  await page.route('**/api/v1/import-jobs?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true,
      data: [
        { job_id: 'processing-job', title: 'Processing scan', state: 'RUNNING', progress: 50 },
        { job_id: 'review-job', title: 'Review scan', state: 'PENDING_REVIEW', progress: 100 },
        { job_id: 'failed-job', title: 'Failed scan', state: 'FAILURE', progress: 0 },
      ], pagination: { total: 3, page: 1, page_size: 20, total_pages: 1 },
    }),
  }));
  await page.goto('/en/my-scores');
  await expect(page.getByRole('heading', { name: 'Owned sonata' })).toBeVisible();
  for (const label of ['Private', 'Published', 'Publish selected', 'Unpublish selected']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Batch operations', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Owned sonata', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Add to library', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Delete work', exact: true })).toBeEnabled();
  for (const [view, title] of [['Processing', 'Processing scan'], ['Pending review', 'Review scan'], ['Failed', 'Failed scan']]) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Owned sonata', exact: true })).toHaveCount(0);
  }
  for (const url of scoreRequests) {
    expect(new URL(url).searchParams.has('view')).toBe(false);
    expect(new URL(url).searchParams.get('page')).toBe('1');
  }
});

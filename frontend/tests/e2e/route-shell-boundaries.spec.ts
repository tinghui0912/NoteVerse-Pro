import { expect, test } from '@playwright/test';

const scoreId = 'shell-score';
const revisionId = 'shell-revision';
const musicXml =
  '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>';

const capabilities = {
  can_view: true,
  can_edit: true,
  can_delete: true,
  can_manage_sharing: true,
  can_download: true,
  can_practice: true,
  can_publish: true,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  );
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  );
});

test('anonymous users can access public and external shells without AppShell sidebar', async ({ page }) => {
  await page.route('**/api/v1/score-grants/shell-share', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          score_id: scoreId,
          revision_id: revisionId,
          title: 'Shared Shell Score',
          taxonomy_tags: [],
          shared_by: { display_name: 'Sharer', avatar_url: null },
          shared_at: '2026-06-23T00:00:00Z',
          metadata: null,
          artifacts: [],
          capabilities: { ...capabilities, can_edit: false, can_manage_sharing: false, can_publish: false },
        },
      }),
    })
  );
  await page.route('**/api/v1/score-grants/shell-share/content', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { score_id: scoreId, revision_id: revisionId, mime_type: 'application/xml', content: musicXml },
      }),
    })
  );
  await page.route('**/api/v1/publications/shell-public', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          title: 'Public Shell Score',
          taxonomy_tags: [],
          publication: { score_id: scoreId, public_slug: 'shell-public', status: 'PUBLISHED' },
          metadata: null,
          artifacts: [],
          capabilities: { ...capabilities, can_edit: false, can_manage_sharing: false, can_publish: false },
        },
      }),
    })
  );
  await page.route('**/api/v1/publications/shell-public/content', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { revision_id: revisionId, mime_type: 'application/xml', content: musicXml },
      }),
    })
  );

  for (const path of ['/en/subscriptions', '/en/help', '/en/share/shell-share', '/en/public/shell-public']) {
    await page.goto(path);
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page.getByRole('link', { name: 'Upload' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  }

  await expect(page.getByRole('heading', { name: 'Public Shell Score' })).toBeVisible();
});

test('anonymous users are redirected from app and workspace routes with returnUrl', async ({ page }) => {
  const protectedPaths = [
    '/zh/library?view=all',
    `/zh/score/${scoreId}`,
    `/zh/score/${scoreId}/edit`,
    `/zh/score/${scoreId}/practice`,
    `/zh/review/${scoreId}`,
    `/zh/review/${scoreId}/edit`,
  ];

  for (const path of protectedPaths) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/zh\/auth\/login\?/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(path);
  }
});

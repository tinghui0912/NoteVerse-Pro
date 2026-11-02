import { expect, test } from '@playwright/test';
import { mockAnonymousSession, mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';
import { mockGuestPreview, preview } from './support/guest-preview';

for (const loggedIn of [false, true]) {
  test(`guest presentation remains view/listen only with authenticated=${loggedIn}`, async ({ page }) => {
    if (loggedIn) { await mockAuthenticatedSession(page); await mockRealtimeEvents(page); } else await mockAnonymousSession(page);
    await mockGuestPreview(page, 'pinned-a');
    const requests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/api/v1/')) requests.push(`${request.method()} ${request.url()}`); });
    await page.goto('/en/preview/pinned-a');
    await expect(page.getByRole('heading', { name: preview.title })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Score page 1' })).toBeVisible();
    await expect.poll(() => page.getByRole('img', { name: 'Score page 1' }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const audio = page.getByLabel('Listen to score');
    await audio.evaluate((element: HTMLAudioElement) => element.play());
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex.*nofollow.*noarchive/);
    for (const name of [/practice/i, /download/i, /save to/i, /edit/i, /log in/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
      await expect(page.getByRole('link', { name })).toHaveCount(0);
    }
    expect(requests.filter((request) => /musicxml|revision-sources|practice\/sources|bookmark|redeem|members/.test(request))).toEqual([]);
    expect(requests.filter((request) => /^(POST|PUT|PATCH|DELETE) /.test(request) && !request.includes('/auth/refresh'))).toEqual([]);
  });
}

test('owner creates an expiring preview and an anonymous browser opens it', async ({ page, browser }) => {
  await mockAuthenticatedSession(page); await mockRealtimeEvents(page);
  const score = { score_id: 'preview-owner-score', title: 'Owner Score', taxonomy_tags: [], version: 1, head_revision_id: 'revision-a', metadata: null, input_assets: [], in_library: false,
    derived_assets: { preview: { status: 'pending', asset_id: null, revision_id: null, is_fallback: false }, audio: { status: 'pending', asset_id: null, revision_id: null, is_fallback: false } },
    capabilities: { can_view: true, can_edit: true, can_delete: true, can_manage_guest_previews: true, can_manage_members: true, can_download: true, can_practice: true }, created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-20T00:00:00Z' };
  await page.route('**/api/v1/scores/preview-owner-score', (route) => route.fulfill({ json: { success: true, data: score } }));
  await page.route('**/api/v1/scores/preview-owner-score/revision-assets**', (route) => route.fulfill({ json: { success: true, data: { revision_sources: [], render_assets: [] } } }));
  let created = false;
  await page.route('**/api/v1/scores/preview-owner-score/guest-previews', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(Object.keys(body)).toEqual(['expires_at']);
      expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
      created = true;
      await route.fulfill({ json: { success: true, data: { preview_id: 'preview-a', token: 'created-token', created_at: preview.created_at, expires_at: preview.expires_at, revoked_at: null } } });
    } else await route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/en/score/preview-owner-score?tab=guest-preview');
  await page.getByRole('button', { name: 'Create Guest Preview', exact: true }).click();
  const link = page.getByRole('textbox', { name: 'Guest Preview link' });
  await expect(link).toHaveValue(/\/preview\/created-token$/);
  expect(created).toBe(true);
  const context = await browser.newContext();
  try {
    const visitor = await context.newPage(); await mockAnonymousSession(visitor); await mockGuestPreview(visitor, 'created-token');
    await visitor.goto(await link.inputValue());
    await expect(visitor.getByRole('img', { name: 'Score page 1' })).toBeVisible();
    await visitor.getByLabel('Listen to score').evaluate((audio: HTMLAudioElement) => audio.play());
  } finally { await context.close(); }
});

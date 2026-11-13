import { expect, test } from '@playwright/test';
import {
  mockAnonymousSession,
  mockAuthenticatedSession,
  mockRealtimeEvents,
} from './support/api-mocks';
import { mockGuestPreview, preview } from './support/guest-preview';

for (const loggedIn of [false, true]) {
  test(`guest presentation remains view/listen only with authenticated=${loggedIn}`, async ({
    page,
  }) => {
    if (loggedIn) {
      await mockAuthenticatedSession(page);
      await mockRealtimeEvents(page);
    } else await mockAnonymousSession(page);
    await mockGuestPreview(page, 'stable-score');
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/')) requests.push(`${request.method()} ${request.url()}`);
    });
    await page.goto('/en/preview/stable-score');
    await expect(page.getByRole('heading', { name: preview.title })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Score page 1' })).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole('img', { name: 'Score page 1' })
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
      )
      .toBe(true);
    const audio = page.getByLabel('Listen to score');
    await audio.evaluate((element: HTMLAudioElement) => element.play());
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
      .toBeGreaterThan(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex.*nofollow.*noarchive/
    );
    for (const name of [/practice/i, /download/i, /save to/i, /edit/i, /log in/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
      await expect(page.getByRole('link', { name })).toHaveCount(0);
    }
    expect(
      requests.filter((request) =>
        /musicxml|revision-sources|practice\/bundles|bookmark|redeem|members/.test(request)
      )
    ).toEqual([]);
    expect(
      requests.filter(
        (request) => /^(POST|PUT|PATCH|DELETE) /.test(request) && !request.includes('/auth/refresh')
      )
    ).toEqual([]);
  });
}

test('owner toggles a stable preview link and an anonymous browser opens it', async ({
  page,
  browser,
}) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  const score = {
    score_id: 'preview-owner-score',
    title: 'Owner Score',
    genres: [],
    version: 1,
    head_revision_id: 'revision-a',
    metadata: null,
    input_assets: [],
    in_library: false,
    derived_assets: {
      preview: { status: 'pending', asset_id: null },
      audio: { status: 'pending', asset_id: null },
    },
    capabilities: {
      can_view: true,
      can_edit: true,
      can_delete: true,
      can_manage_guest_previews: true,
      can_manage_members: true,
      can_download: true,
      can_practice: true,
    },
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
  };
  await page.route('**/api/v1/scores/preview-owner-score', (route) =>
    route.fulfill({ json: { success: true, data: score } })
  );
  await page.route('**/api/v1/scores/preview-owner-score/revision-assets**', (route) =>
    route.fulfill({ json: { success: true, data: { revision_sources: [], render_assets: [] } } })
  );
  let enabled = false;
  await page.route('**/api/v1/scores/preview-owner-score/guest-preview', async (route) => {
    if (route.request().method() === 'PATCH') {
      expect(Object.keys(route.request().postDataJSON())).toEqual(['enabled']);
      enabled = route.request().postDataJSON().enabled;
    }
    await route.fulfill({ json: { success: true, data: { token: 'stable-token', enabled } } });
  });
  await page.goto('/en/score/preview-owner-score?tab=guest-preview');
  const link = page.getByRole('textbox', { name: 'Guest Preview link' });
  await expect(link).toHaveValue(/\/preview\/stable-token$/);
  await page.getByRole('button', { name: 'Enable Guest Preview', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Disable Guest Preview', exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(link).toHaveValue(/\/preview\/stable-token$/);
  await page.getByRole('button', { name: 'Disable Guest Preview', exact: true }).click();
  await expect(link).toHaveValue(/\/preview\/stable-token$/);
  await page.getByRole('button', { name: 'Enable Guest Preview', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Disable Guest Preview', exact: true })
  ).toBeVisible();
  const context = await browser.newContext();
  try {
    const visitor = await context.newPage();
    await mockAnonymousSession(visitor);
    await mockGuestPreview(visitor, 'stable-token');
    await visitor.goto(await link.inputValue());
    await expect(visitor.getByRole('img', { name: 'Score page 1' })).toBeVisible();
    await visitor.getByLabel('Listen to score').evaluate((audio: HTMLAudioElement) => audio.play());
  } finally {
    await context.close();
  }
});

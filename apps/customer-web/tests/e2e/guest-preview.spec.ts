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
    await expect(page.getByRole('heading', { name: preview.display_title })).toBeVisible();
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
        (request) => /^(POST|PUT|PATCH|DELETE) /.test(request)
      )
    ).toEqual([]);
  });
}

test('owner issues, rotates and revokes one-time bearer links', async ({
  page,
  browser,
}) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  const score = {
    score_id: 'preview-owner-score',
    display_title: 'Owner Score',
    genres: [],
    metadata_version: 1, head_revision_number: 1,
    head_revision_id: 'revision-a',
    metadata: null,
    input_assets: [],
    derived_assets: {
      preview: { status: 'pending', asset_id: null },
      audio: { status: 'pending', asset_id: null },
    },
    capabilities: {
      can_view: true,
      can_edit: true,
      can_delete: true,
      can_leave: false,
      can_manage_guest_previews: true,
      can_manage_members: true,
      can_download: true,
      can_practice: true,
    },
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
  };
  await page.route('**/api/v1/scores/preview-owner-score', (route) =>
    route.fulfill({ json: score })
  );
  await page.route('**/api/v1/scores/preview-owner-score/revision-assets**', (route) =>
    route.fulfill({ json: { revision_sources: [], render_assets: [] } })
  );
  let activeToken: string | null = null;
  let generation = 0;
  const issued_at = '2026-11-17T00:00:00Z';
  await page.route('**/api/v1/scores/preview-owner-score/guest-preview**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: { enabled: activeToken !== null, issued_at: activeToken ? issued_at : null } });
    } else if (method === 'DELETE') {
      activeToken = null;
      await route.fulfill({ status: 204 });
    } else if (method === 'POST') {
      if (path.endsWith('/rotate') ? !activeToken : !!activeToken) throw new Error('Invalid credential lifecycle command');
      activeToken = `credential-${++generation}`;
      await route.fulfill({ json: { token: activeToken, issued_at } });
    } else throw new Error('Unexpected credential command');
  });
  await page.goto('/en/score/preview-owner-score?tab=guest-preview');
  const link = page.getByRole('textbox', { name: 'Guest Preview link' });
  await expect(link).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable Guest Preview', exact: true }).click();
  await expect(link).toHaveValue(/\/preview\/credential-1$/);
  const a = await link.inputValue();
  const context = await browser.newContext();
  try {
    const visitor = await context.newPage();
    await mockAnonymousSession(visitor);
    // The anonymous endpoint resolves the currently active credential, not a stable fixture.
    for (const token of ['credential-1', 'credential-2', 'credential-3']) await mockGuestPreview(visitor, token);
    await visitor.route('**/api/v1/guest-previews/**', async (route) => {
      const token = new URL(route.request().url()).pathname.split('/')[4];
      if (token !== activeToken) await route.fulfill({ status: 404, json: { code: 'guest_preview_not_found', request_id: 'e2e-guest-preview' } });
      else await route.fallback();
    });
    const visible = async (url: string) => {
      await visitor.goto(url);
      await expect(visitor.getByRole('img', { name: 'Score page 1' })).toBeVisible();
    };
    const unavailable = async (url: string) => {
      await visitor.goto(url);
      await expect(visitor.getByText('This preview is unavailable.')).toBeVisible();
    };
    await visible(a);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Rotate Guest Preview link' })).toBeVisible();
    await expect(link).toHaveCount(0);
    await page.getByRole('button', { name: 'Rotate Guest Preview link' }).click();
    await expect(link).toHaveValue(/\/preview\/credential-2$/);
    const b = await link.inputValue();
    expect(b).not.toBe(a);
    await unavailable(a); await visible(b);
    await page.getByRole('button', { name: 'Disable Guest Preview', exact: true }).click();
    await expect(link).toHaveCount(0);
    await unavailable(b);
    await page.getByRole('button', { name: 'Enable Guest Preview', exact: true }).click();
    await expect(link).toHaveValue(/\/preview\/credential-3$/);
    const c = await link.inputValue();
    expect([a, b]).not.toContain(c);
    await unavailable(a); await unavailable(b); await visible(c);
  } finally {
    await context.close();
  }
});

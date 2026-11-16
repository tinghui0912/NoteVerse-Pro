import type { ScoreRead } from '../../src/generated/api';
import { expect, test } from '@playwright/test';
import { mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const scoreId = 'score-detail-layout';
const revisionId = 'revision-score-detail-layout';
const musicXml =
  '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>';

test('score detail uses lightweight hero layout and lazy playback', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  const score = {
    score_id: scoreId,
    display_title: 'Layout Score',
    genres: ['classical'],
    metadata_version: 1, head_revision_number: 1,
    head_revision_id: revisionId,
    originating_job_id: 'job-1',
    metadata: null,
    derived_assets: {
      preview: { status: 'pending', asset_id: null },
      audio: { status: 'ready', asset_id: 'audio-1' },
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
    updated_at: '2026-06-21T00:00:00Z',
  };
  await page.route(`**/api/v1/scores/${scoreId}`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(score),
    })
  );
  await page.route(`**/api/v1/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        revision_id: revisionId,
        revision_number: 1,
        content_hash: 'hash',
        origin: 'OMR',
        created_at: score.created_at,
        content: musicXml,
        mime_type: 'application/xml',
      }),
    })
  );
  await page.route(`**/api/v1/scores/${scoreId}/revision-assets**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ revision_sources: [], render_assets: [] }),
    })
  );
  await page.route(`**/api/v1/scores/${scoreId}/guest-preview`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false, token: 'layout-preview-token' }),
    })
  );
  await page.goto(`/en/score/${scoreId}`);
  await expect(page.getByRole('heading', { name: 'Layout Score' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Score' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Score Information' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Version History' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Guest Preview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Collaborators', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await expect(page.getByText('Published', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Practice' })).toBeVisible();
  await expect(page.getByTestId('score-preview-viewport')).toHaveCount(0);
});

test('Score head presentation progresses neutrally to exact READY assets through realtime', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await page.addInitScript(() => {
    const sources: EventTarget[] = [];
    class ScoreChanges extends EventTarget {
      constructor() {
        super();
        sources.push(this);
      }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: ScoreChanges });
    Object.assign(window, {
      emitScoreChange: (data: string) =>
        sources.forEach((source) => source.dispatchEvent(new MessageEvent('change', { data }))),
      scoreChangeStreamCount: () => sources.length,
    });
  });
  const score: ScoreRead = {
    score_id: 'exact-score',
    display_title: 'Exact head score',
    head_revision_id: 'r2',
    metadata_version: 2, head_revision_number: 2,
    genres: [],
    metadata: null,
    input_assets: [],
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-21T00:00:00Z',
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
    derived_assets: {
      preview: { status: 'pending', asset_id: null },
      audio: { status: 'pending', asset_id: null },
    },
  };
  await page.route('**/api/v1/scores/exact-score', (route) => route.fulfill({ json: score }));
  const assetReads: string[] = [],
    mediaReads: string[] = [],
    imageReads: string[] = [];
  await page.route('**/api/v1/scores/exact-score/revision-assets?**', (route) => {
    assetReads.push(route.request().url());
    return route.fulfill({
      json: { revision_sources: [], render_assets: [] },
    });
  });
  await page.route('**/api/v1/render-assets/*/view', (route) => {
    imageReads.push(route.request().url());
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="white"/></svg>',
    });
  });
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(16000, 40);
  await page.route('**/api/v1/scores/exact-score/revisions/*/playback', (route) => {
    mediaReads.push(route.request().url());
    return route.fulfill({ contentType: 'audio/wav', body: wav });
  });
  await page.goto('/en/score/exact-score');
  await expect(page.getByRole('heading', { name: score.display_title })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { scoreChangeStreamCount(): number }).scoreChangeStreamCount()
      )
    )
    .toBeGreaterThan(0);
  const hero = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: score.display_title }) });
  const refresh = async () =>
    page.evaluate(
      (data) =>
        (window as unknown as { emitScoreChange(data: string): void }).emitScoreChange(data),
      JSON.stringify({
        schemaVersion: 1,
        changeId: crypto.randomUUID(),
        sequence: 1,
        kind: 'score.derived_assets.changed',
        scoreId: score.score_id,
        revisionId: 'r2',
        createdAt: score.updated_at,
      })
    );
  for (const status of ['pending', 'processing', 'unavailable'] as const) {
    score.derived_assets.preview.status = status;
    score.derived_assets.audio.status = status;
    await refresh();
    const audio = hero.getByRole('button', {
      name:
        status === 'unavailable'
          ? 'Preview audio is unavailable'
          : 'Preview audio is being prepared',
      exact: true,
    });
    await expect(audio).toBeDisabled();
    await expect(audio).not.toHaveAttribute('title');
    await expect(hero.locator('img')).toHaveCount(0);
    await expect(hero.locator('.animate-spin')).toHaveCount(status === 'unavailable' ? 0 : 2);
    await expect(hero.getByText(/Preparing|Rendering|Unavailable|Failed|Retry/i)).toHaveCount(0);
    expect(imageReads).toEqual([]);
    expect(mediaReads).toEqual([]);
  }
  score.derived_assets = {
    preview: { status: 'ready', asset_id: 'r2-image' },
    audio: { status: 'ready', asset_id: 'r2-audio' },
  };
  await refresh();
  await expect(hero.locator('img')).toHaveJSProperty(
    'src',
    new URL('/api/v1/render-assets/r2-image/view', page.url()).href
  );
  await hero.getByRole('button', { name: 'Play Score', exact: true }).click();
  await expect.poll(() => mediaReads.length).toBeGreaterThan(0);
  expect(mediaReads.every((url) => url.includes('/revisions/r2/playback'))).toBe(true);
  expect(imageReads.every((url) => url.includes('/r2-image/view'))).toBe(true);
  expect(assetReads.every((url) => new URL(url).searchParams.get('revision_id') === 'r2')).toBe(
    true
  );
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toHaveAttribute(
    'href',
    /practiceRevisionId=r2/
  );
});

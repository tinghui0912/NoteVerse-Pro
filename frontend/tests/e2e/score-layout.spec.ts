import { expect, test } from '@playwright/test';

const scoreId = 'score-detail-layout';
const revisionId = 'revision-score-detail-layout';
const musicXml = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>';

test('score detail uses lightweight hero layout and lazy playback', async ({ context, page }) => {
  await context.addCookies([{ name: 'noteverse_session', value: 'session', domain: 'localhost', path: '/' }]);
  const score = { score_id: scoreId, title: 'Layout Score', taxonomy_tags: [{ category: 'genre', code: 'classical', source: 'USER', confidence: null }], version: 1,
    head_revision_id: revisionId, originating_job_id: 'job-1', metadata: null, publication: null,
    derived_assets: {
      preview: { status: 'pending', asset_id: null, revision_id: null, is_fallback: false },
      audio: { status: 'ready', asset_id: 'audio-1', revision_id: revisionId, is_fallback: false },
    },
    capabilities: { can_view: true, can_edit: true, can_delete: true, can_manage_sharing: true, can_download: true, can_practice: true, can_publish: true },
    created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-21T00:00:00Z' };
  await page.route(`**/api/v1/scores/${scoreId}`, async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: score }) }));
  await page.route(`**/api/v1/scores/${scoreId}/revisions/${revisionId}/content`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { revision_id: revisionId, revision_number: 1, parent_revision_id: null, base_revision_id: null, content_hash: 'hash', origin: 'OMR', created_at: score.created_at, content: musicXml, mime_type: 'application/xml' } }) }));
  await page.route(`**/api/v1/scores/${scoreId}/revision-assets**`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { revision_sources: [], render_assets: [] } }) }));
  await page.route(`**/api/v1/scores/${scoreId}/grants`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route(`**/api/v1/scores/${scoreId}/publication`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.goto(`/en/score/${scoreId}`);
  await expect(page.getByRole('heading', { name: 'Layout Score' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play Score' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Score Information' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Version History' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Create Share' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Practice Mode' })).toBeVisible();
  await expect(page.getByTestId('score-preview-viewport')).toHaveCount(0);
});

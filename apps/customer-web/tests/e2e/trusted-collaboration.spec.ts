import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';
import { openPreparedPractice } from './support/practice-workspace';
import type { RevisionRead } from '../../src/generated/api';
import artifactFixture from '../../src/lib/practice/__fixtures__/canonical-practice-score-artifact.json';

const musicXml = readFileSync(resolve('../../backend/tests/fixtures/musicxml/canonical-practice-score.musicxml'), 'utf8');
const scoreId = 'trusted-score';
const revisionId = 'trusted-revision';
type Role = 'OWNER' | 'VIEWER' | 'PRACTITIONER' | 'EDITOR';
const capabilities = (role: Role) => ({
  can_view: true, can_edit: role === 'OWNER' || role === 'EDITOR', can_delete: role === 'OWNER', can_leave: role !== 'OWNER',
  can_manage_guest_previews: role === 'OWNER', can_manage_members: role === 'OWNER',
  can_download: role === 'OWNER', can_practice: role !== 'VIEWER',
});

async function mockScore(page: Page, role: Role) {
  await mockAuthenticatedSession(page); await mockRealtimeEvents(page);
  const caps = capabilities(role);
  const score = { score_id: scoreId, title: 'Trusted Score', genres: [], version: 1, head_revision_id: revisionId,
    metadata: null, input_assets: [], created_at: '2026-06-20T00:00:00Z', updated_at: '2026-06-20T00:00:00Z', capabilities: caps,
    derived_assets: { preview: { status: 'ready', asset_id: 'page-a' }, audio: { status: 'pending', asset_id: null } } };
  const revision: RevisionRead = { revision_id: revisionId, revision_number: 1, origin: 'IMPORT', created_at: score.created_at, created_by: null, restore: null, note: null };
  await page.route(`**/api/v1/scores/${scoreId}`, route => route.fulfill({ json: score }));
  await page.route(`**/api/v1/scores/${scoreId}/revision-assets**`, route => route.fulfill({ json: { revision_sources: [], render_assets: [] } }));
  await page.route('**/api/v1/render-assets/page-a/view', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/></svg>' }));
  await page.route(`**/api/v1/scores/${scoreId}/revisions?**`, route => route.fulfill({ json: { items: [revision], next_cursor: null } }));
  await page.route(`**/api/v1/scores/${scoreId}/revisions/*/content`, route => route.fulfill({ status: caps.can_edit ? 200 : 403, json: caps.can_edit ? { ...revision, revision_id: new URL(route.request().url()).pathname.split('/').at(-2), content: musicXml, mime_type: 'application/vnd.recordare.musicxml+xml' } : {  code: 'no_edit_access', request_id: null } }));
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/bundle?**`, route => {
    expect(caps.can_practice).toBe(true);
    expect(new URL(route.request().url()).searchParams.get('include_notation')).toBe('true');
    return route.fulfill({ json: { source_id: 'trusted-admission', artifact: { ...artifactFixture, scoreId, revisionId }, notation: { musicxml: musicXml, mime_type: 'application/vnd.recordare.musicxml+xml' } } });
  });
  return { score, revision };
}

for (const role of ['OWNER', 'VIEWER', 'PRACTITIONER', 'EDITOR'] as const) {
  test(`${role} Score UI exposes only its authorized actions`, async ({ page }) => {
    await mockScore(page, role);
    const reads: string[] = [];
    page.on('request', request => { if (request.url().includes('/api/v1/')) reads.push(request.url()); });
    await page.goto(`/en/score/${scoreId}`);
    await expect(page.getByRole('heading', { name: 'Trusted Score' })).toBeVisible();
    const caps = capabilities(role);
    await expect(page.getByRole('link', { name: 'Practice', exact: true })).toHaveCount(caps.can_practice ? 1 : 0);
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(caps.can_edit ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(caps.can_download ? 1 : 0);
    await expect(page.getByRole('tab', { name: 'Version History', exact: true })).toHaveCount(caps.can_edit ? 1 : 0);
    await expect(page.getByRole('tab', { name: 'Guest Preview', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
    await expect(page.getByRole('tab', { name: 'Collaborators', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
    if (!caps.can_edit) {
      expect(reads.filter(url => /\/revisions(?:\?|$)|\/content(?:\?|$)/.test(url))).toEqual([]);
    } else {
      await page.getByRole('tab', { name: 'Version History', exact: true }).click();
      await expect(page.getByText('v1', { exact: true })).toBeVisible();
    }
  });
}

test('Practitioner completes Setup source admission without direct editor source access', async ({ page }) => {
  await mockScore(page, 'PRACTITIONER');
  await page.addInitScript(() => {
    const input = { id: 'midi', name: 'Trusted MIDI', state: 'connected', connection: 'open', addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map([['midi', input]]), outputs: new Map(), addEventListener() {}, removeEventListener() {} }) });
  });
  const reads: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/v1/')) reads.push(request.url()); });
  await openPreparedPractice(page, scoreId, revisionId);
  expect(reads.filter(url => url.includes('/content') || url.includes('/revision-sources/'))).toEqual([]);
  expect(reads.filter(url => url.includes('/bundle?'))).toHaveLength(1);
});

test('Editor loads MusicXML and saves a revision without download permission', async ({ page }) => {
  const { score, revision } = await mockScore(page, 'EDITOR');
  let saved = false;
  await page.route(`**/api/v1/scores/${scoreId}/revisions`, async route => {
    const body = route.request().postDataJSON();
    expect(body.expected_head_revision_id).toBe(revisionId);
    expect(Object.keys(body).sort()).toEqual(['content', 'expected_head_revision_id', 'idempotency_key']);
    expect(body.content).toContain('<score-partwise');
    saved = true;
    score.head_revision_id = 'new-revision';
    score.version = 2;
    await route.fulfill({ json: { ...revision, revision_id: 'new-revision', revision_number: 2 } });
  });
  await page.goto(`/en/score/${scoreId}/edit`);
  await expect(page.locator('svg .note').first()).toBeVisible();
  await page.evaluate(async ({ scoreId, revisionId, xml }) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('NoteVerseEditorDrafts');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('drafts', 'readwrite');
        const drafts = transaction.objectStore('drafts');
        if (!drafts.indexNames.contains('baselineRevisionId')) {
          db.close(); reject(new Error('Draft baseline index missing')); return;
        }
        drafts.put({ draftId: `${scoreId}:${revisionId}`, scoreId, baselineRevisionId: revisionId, xml, savedAt: Date.now() });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, { scoreId, revisionId, xml: musicXml });
  const save = page.locator('button').filter({ has: page.locator('svg.lucide-save') });
  await save.click();
  await expect.poll(async () => saved || await page.getByRole('alertdialog').count() > 0).toBe(true);
  if (!saved) await page.getByRole('button', { name: 'Ignore & Save', exact: true }).click();
  await expect.poll(() => saved).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/score/${scoreId}$`));
  const draft = await page.evaluate(async (key) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('NoteVerseEditorDrafts');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }), `${scoreId}:${revisionId}`);
  expect(draft).toBeUndefined();
});

test('Owner invites with default Viewer and can choose Practitioner or Editor and change member roles', async ({ page }) => {
  await mockScore(page, 'OWNER');
  let memberRole = 'VIEWER';
  await page.route(`**/api/v1/scores/${scoreId}/members`, route => route.fulfill({ json: [{ membership_id: 10, display_name: 'Member', email: 'member@example.com', role: memberRole, created_at: '2026-06-20T00:00:00Z', revoked_at: null, avatar_url: null }] }));
  const invited: string[] = [], changed: string[] = [];
  await page.route(`**/api/v1/scores/${scoreId}/invites`, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); invited.push(body.role);
      await route.fulfill({ json: { invite_id: `invite-${invited.length}`, token: `token-${invited.length}`, email: body.email, role: body.role, status: 'PENDING', created_at: '2026-06-20T00:00:00Z', expires_at: null, terminal_at: null, created_by: null, terminal_actor: null } });
    } else await route.fulfill({ json: [] });
  });
  await page.route(`**/api/v1/scores/${scoreId}/members/10`, async route => {
    memberRole = route.request().postDataJSON().role;
    changed.push(memberRole);
    await route.fulfill({ json: { membership_id: 10, role: changed.at(-1), display_name: 'Member', email: 'member@example.com', created_at: '2026-06-20T00:00:00Z', revoked_at: null, avatar_url: null } });
  });
  await page.goto(`/en/score/${scoreId}?tab=collaboration`);
  const selectors = page.getByRole('combobox');
  await expect(selectors.first()).toHaveText('Viewer');
  for (const [index,role] of ['Viewer','Practitioner','Editor'].entries()) {
    if (index > 0) { await selectors.first().click(); await page.getByRole('option', { name: role, exact: true }).click(); }
    await page.getByLabel('Email', { exact: true }).fill('member@example.com');
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await expect.poll(() => invited.length).toBe(index + 1);
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  }
  expect(invited).toEqual(['VIEWER','PRACTITIONER','EDITOR']);
  for (const [index,role] of ['Practitioner','Editor','Viewer'].entries()) {
    await selectors.nth(1).click(); await page.getByRole('option', { name: role, exact: true }).click();
    await expect.poll(() => changed.length).toBe(index + 1);
    await expect(selectors.nth(1)).toBeEnabled();
  }
  expect(changed).toEqual(['PRACTITIONER','EDITOR','VIEWER']);
});

test('Practitioner invitation renders and accepts the same role', async ({ page }) => {
  await mockAuthenticatedSession(page); await mockRealtimeEvents(page);
  let accepted = false;
  await page.route('**/api/v1/invites/practitioner-token', route => route.fulfill({ json: { invite_id: 'invite-p', score_id: scoreId, score_title: 'Practice invitation', inviter: { display_name: 'Owner', email: 'owner@example.com', avatar_url: null }, email: 'owner@example.com', role: 'PRACTITIONER', status: 'PENDING', expires_at: null, requires_login: false, can_accept: true } }));
  await page.route('**/api/v1/invites/practitioner-token/accept', route => { accepted = true; return route.fulfill({ json: { score_id: scoreId, role: 'PRACTITIONER', membership_id: 10 } }); });
  await mockScore(page, 'PRACTITIONER');
  await page.goto('/en/invite/practitioner-token');
  await expect(page.getByText('Practitioner', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invite', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/score/${scoreId}$`));
  expect(accepted).toBe(true);
  await expect(page.getByRole('link', { name: 'Practice', exact: true })).toBeVisible();
});


test('Editor keeps the document open when its expected head conflicts', async ({ page }) => {
  await mockScore(page, 'EDITOR');
  let rejected = false;
  await page.route(`**/api/v1/scores/${scoreId}/revisions`, route => {
    expect(route.request().postDataJSON().expected_head_revision_id).toBe(revisionId);
    rejected = true;
    return route.fulfill({ status: 409, json: { code: 'revision_conflict', request_id: null } });
  });
  await page.goto(`/en/score/${scoreId}/edit`);
  await expect(page.locator('svg .note').first()).toBeVisible();
  await page.locator('button').filter({ has: page.locator('svg.lucide-save') }).click();
  await expect.poll(async () => rejected || await page.getByRole('alertdialog').count() > 0).toBe(true);
  if (!rejected) await page.getByRole('button', { name: 'Ignore & Save', exact: true }).click();
  await expect(page.getByText('This score was updated elsewhere. Please refresh and try again.', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/score/${scoreId}/edit$`));
  await expect(page.locator('svg .note').first()).toBeVisible();
});

test('Version History restores a snapshot as a new head with event provenance', async ({ page }) => {
  const { score, revision } = await mockScore(page, 'EDITOR');
  const older = { ...revision, revision_id: 'revision-2', revision_number: 2 };
  const current = { ...revision, revision_number: 4 };
  let items: RevisionRead[] = [current, older];
  await page.route(`**/api/v1/scores/${scoreId}/revisions?**`, route => route.fulfill({ json: { items, next_cursor: null } }));
  let restored = false;
  await page.route(`**/api/v1/scores/${scoreId}/revisions/revision-2/restore`, route => {
    expect(route.request().postDataJSON()).toEqual({ note: 'Return to revision 2' });
    const next = { ...revision, revision_id: 'revision-5', revision_number: 5, restore: {
      restored_from_revision_id: 'revision-2', restored_from_revision_number: 2,
      note: 'Return to revision 2', actor: null, created_at: revision.created_at,
    } };
    items = [next, current, older];
    score.head_revision_id = next.revision_id;
    score.version = 5;
    restored = true;
    return route.fulfill({ json: next });
  });
  await page.goto(`/en/score/${scoreId}?tab=versions`);
  await expect(page.getByText('v4', { exact: true })).toBeVisible();
  const target = page.locator('div.rounded-xl').filter({ has: page.getByText('v2', { exact: true }) });
  await target.getByRole('button', { name: 'Version actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restore this version', exact: true }).click();
  await page.getByPlaceholder('Add a restore reason (optional)').fill('Return to revision 2');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore this version', exact: true }).click();
  await expect.poll(() => restored).toBe(true);
  await expect(page.getByText('v5', { exact: true })).toBeVisible();
  await expect(page.getByText('Restored from v2', { exact: true })).toBeVisible();
  await expect(page.getByText('v4', { exact: true })).toBeVisible();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
});

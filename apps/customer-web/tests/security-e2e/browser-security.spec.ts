import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  mockAuthenticatedSession,
  mockAnonymousSession,
  mockRealtimeEvents,
} from '../e2e/support/api-mocks';
import artifact from '../../src/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { openPreparedPractice } from '../e2e/support/practice-workspace';

const musicxml = readFileSync(
  resolve('../../backend/tests/fixtures/musicxml/canonical-practice-score.musicxml'),
  'utf8',
);
const editorMusicxml =
  '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="csp-note"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
const scoreId = 'csp-score',
  revisionId = 'csp-revision';

async function observeCsp(page: Page) {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (
      /Content Security Policy|Refused to (?:execute|load|connect)|violates the following/i.test(
        message.text(),
      )
    )
      consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const results: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = results;
    document.addEventListener('securitypolicyviolation', (event) =>
      results.push(`${event.effectiveDirective}:${new URL(event.documentURI).pathname}`),
    );
  });
  return async () => {
    expect(
      await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
    ).toEqual([]);
    expect(consoleErrors).toEqual([]);
  };
}

async function mockWorkspace(page: Page) {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  const score = {
    score_id: scoreId,
    display_title: 'CSP Score',
    genres: [],
    metadata_version: 1,
    head_revision_number: 1,
    head_revision_id: revisionId,
    metadata: null,
    input_assets: [],
    created_at: '2026-06-20T00:00:00Z',
    updated_at: '2026-06-20T00:00:00Z',
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
  const revision = {
    revision_id: revisionId,
    revision_number: 1,
    origin: 'IMPORT',
    created_at: score.created_at,
    created_by: null,
    restore: null,
    note: null,
  };
  await page.route(`**/api/v1/scores/${scoreId}`, (route) => route.fulfill({ json: score }));
  await page.route(`**/api/v1/scores/${scoreId}/revision-assets**`, (route) =>
    route.fulfill({ json: { revision_sources: [], render_assets: [] } }),
  );
  await page.route(`**/api/v1/scores/${scoreId}/revisions?**`, (route) =>
    route.fulfill({ json: { items: [revision], next_cursor: null } }),
  );
  await page.route(`**/api/v1/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      json: {
        ...revision,
        content: editorMusicxml,
        mime_type: 'application/vnd.recordare.musicxml+xml',
      },
    }),
  );
  await page.route(
    `**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/bundle?**`,
    (route) =>
      route.fulfill({
        json: {
          binding: { score_id: scoreId, revision_id: revisionId, bundle_id: 'csp-bundle' },
          artifact,
          notation: { musicxml, mime_type: 'application/vnd.recordare.musicxml+xml' },
        },
      }),
  );
  await page.route('**/api/v1/playback/performance-plan', (route) =>
    route.fulfill({
      json: {
        musicxml: route.request().postDataJSON().musicxml,
        initial_tempo_bpm: { numerator: 120, denominator: 1 },
        performance_end: { numerator: 4, denominator: 1 },
        tempo_events: [],
        occurrences: [
          {
            ordinal: 0,
            measure_index: 0,
            visit: 1,
            written_start: { numerator: 0, denominator: 1 },
            written_end: { numerator: 4, denominator: 1 },
            performance_start: { numerator: 0, denominator: 1 },
            performance_end: { numerator: 4, denominator: 1 },
          },
        ],
      },
    }),
  );
  await page.addInitScript(() => {
    const input = {
      id: 'csp-midi',
      name: 'CSP MIDI',
      state: 'connected',
      connection: 'open',
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => ({
        inputs: new Map([['midi', input]]),
        outputs: new Map(),
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  });
}

test('auth hydrates with matching fresh nonces and no policy violations', async ({ page }) => {
  const clean = await observeCsp(page);
  await mockAnonymousSession(page);
  const response = await page.goto('/zh/auth/login');
  const csp = response!.headers()['content-security-policy'];
  const nonce = /\'nonce-([^']+)\'/.exec(csp)![1];
  expect(Buffer.from(nonce, 'base64').byteLength).toBe(16);
  expect(csp.split(';').find((value) => value.trim().startsWith('script-src '))).not.toMatch(
    /unsafe-inline|unsafe-eval|wasm-unsafe-eval/,
  );
  const scripts = await page.locator('script').evaluateAll((nodes) =>
    nodes
      .map((node) => node as HTMLScriptElement)
      .filter((node) => !node.src)
      .map((node) => node.nonce),
  );
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((value) => value === nonce)).toBe(true);
  await page.locator('input[type=email]').fill('user@example.com');
  await page.locator('input[type=password]').fill('correct-password-123');
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  await clean();
  const second = await page.reload();
  expect(second!.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
  expect(second!.headers()['cache-control']).toContain('no-store');
  await clean();
});

test('score editor renders real Verovio WASM under its workspace policy', async ({ page }) => {
  const clean = await observeCsp(page);
  await mockWorkspace(page);
  await page.goto(`/zh/score/${scoreId}/edit`);
  await expect(page.locator('svg .note').first()).toBeVisible();
  await clean();
});

test('practice admits its bundle, renders real WASM and runs scoped worker capabilities', async ({
  page,
}) => {
  const clean = await observeCsp(page);
  await mockWorkspace(page);
  await openPreparedPractice(page, scoreId, revisionId);
  await expect(page.locator('svg .note').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const url = URL.createObjectURL(
      new Blob(['self.postMessage("ready")'], { type: 'text/javascript' }),
    );
    try {
      return await new Promise<string>((resolve, reject) => {
        const worker = new Worker(url);
        worker.onmessage = (event) => {
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = () => {
          worker.terminate();
          reject(new Error('Worker admission failed'));
        };
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  expect(result).toBe('ready');
  await clean();
});

test('cross-policy client navigation replaces the document and its nonce', async ({ page }) => {
  const clean = await observeCsp(page);
  await mockAnonymousSession(page);
  const response = await page.goto('/zh/auth/login');
  const nonce = /\'nonce-([^']+)\'/.exec(response!.headers()['content-security-policy'])![1];
  const navigation = page.waitForEvent(
    'response',
    (r) => r.request().isNavigationRequest() && new URL(r.url()).pathname === '/zh',
  );
  const loaded = page.waitForEvent('domcontentloaded');
  await page.getByRole('link', { name: '返回首页', exact: true }).click();
  const next = await navigation;
  await loaded;
  await next.finished();
  expect(next.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
  expect(next.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  await clean();
});

test('Admin production login hydrates with one strict nonce policy', async ({ page }) => {
  const clean = await observeCsp(page);
  await page.route('http://localhost:3001/api/v1/auth/me', (route) =>
    route.fulfill({ status: 401, json: { code: 'auth_failed', request_id: 'admin-csp' } }),
  );
  const response = await page.goto('http://localhost:3001/login');
  const csp = response!.headers()['content-security-policy'];
  const nonce = /\'nonce-([^']+)\'/.exec(csp)![1];
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  const scripts = await page.locator('script').evaluateAll((nodes) =>
    nodes
      .map((node) => node as HTMLScriptElement)
      .filter((node) => !node.src)
      .map((node) => node.nonce),
  );
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((value) => value === nonce)).toBe(true);
  await page.locator('input[type=email]').fill('operator@example.com');
  await page.locator('input[type=password]').fill('correct-password-123');
  await expect(page.locator('button[type=submit]')).toBeEnabled();
  await clean();
});

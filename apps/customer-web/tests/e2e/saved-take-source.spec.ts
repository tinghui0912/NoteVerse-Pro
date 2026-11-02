import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { take, artifact } from '../../src/lib/practice/video-export/__fixtures__/saved-take';
import { mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const musicXml = `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note id="note-1"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
<measure number="2"><note id="note-2"><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>whole</type></note></measure></part></score-partwise>`;

for (const sourceState of ['LIVE', 'DELETED', 'MISMATCH'] as const) {
  test(`saved Take ${sourceState}: raw playback/download are independent of optional exact score export`, async ({ page }) => {
    await mockAuthenticatedSession(page);
    await mockRealtimeEvents(page);
    await page.goto('/en');
    // A native browser-produced media fixture with a deterministic frame boundary.
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!;
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: Blob[] = [];
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.start();
      for (let frame = 0; frame < 60; frame++) {
        context.fillStyle = frame % 2 ? '#123456' : '#abcdef';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      recorder.stop(); await stopped;
      stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    const media = Buffer.from(bytes);
    await page.route('**/api/v1/performance-takes/take-1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...take, media_byte_size: media.length } }),
    }));
    await page.route('**/api/v1/performance-takes/take-1/media', route => route.fulfill({ status: 200, contentType: 'video/webm', body: media }));
    const sourceRequests: string[] = [];
    const exportWrites: string[] = [];
    page.on('request', request => {
      if (['POST', 'PUT'].includes(request.method())) exportWrites.push(request.url());
      const path = new URL(request.url()).pathname;
      if (path.includes('/practice-source') || path.startsWith('/api/v1/practice/sources/')) sourceRequests.push(request.url());
    });
    await page.route('**/api/v1/practice/sources/source-1*', route => route.fulfill({
      status: sourceState === 'DELETED' ? 404 : 200, contentType: 'application/json',
      body: JSON.stringify(sourceState === 'DELETED' ? { public_code: 'resource_not_found' } : {
        data: { source_id: sourceState === 'MISMATCH' ? 'another-source' : take.source_id, artifact,
          notation: { musicxml: musicXml, mime_type: 'application/vnd.recordare.musicxml+xml' } },
      }),
    }));
    await page.goto('/en/my-performances/take-1/video-export');
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await video.evaluate(element => (element as HTMLVideoElement).play());
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    await video.evaluate(element => (element as HTMLVideoElement).pause());
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Video', exact: true }).click();
    const raw = await download;
    expect(await readFile((await raw.path())!)).toEqual(media);
    if (sourceState === 'LIVE') {
      await expect(page.getByTestId('generate-video-export')).toBeEnabled();
    } else {
      await expect(page.getByText('The exact score source is no longer available for score-based video export. Your original recording remains available.')).toBeVisible();
      await expect(page.getByTestId('generate-video-export')).toHaveCount(0);
    }
    // Saved export is an ordinary query: the application's one error retry keeps
    // requesting this same exact identity, never a Take-owned or alternate source.
    expect(sourceRequests).toHaveLength(sourceState === 'LIVE' ? 1 : 2);
    for (const request of sourceRequests) {
      expect(new URL(request).pathname).toBe('/api/v1/practice/sources/source-1');
      expect(new URL(request).searchParams.get('include_notation')).toBe('true');
    }
    expect(exportWrites).toEqual([]);
  });
}

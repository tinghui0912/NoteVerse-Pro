import { videoExportOutputFiles, installVideoExportOutputBarrier } from './support/video-export-output';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { take, artifact } from '../../src/lib/practice/video-export/__fixtures__/saved-take';
import { mockAuthenticatedSession, mockRealtimeEvents } from './support/api-mocks';

const musicXml = `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note id="note-1"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
<measure number="2"><note id="note-2"><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>whole</type></note></measure></part></score-partwise>`;

async function temporaryMediaFiles(page:Page) {
  return page.evaluate(async()=>{
    try {
      const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('noteverse-performance-take-media');
      const names:string[]=[];
      for await(const entry of (directory as unknown as {values():AsyncIterable<{name:string}>}).values())names.push(entry.name);
      return names;
    }catch(error){if(error instanceof DOMException&&error.name==='NotFoundError')return [];throw error;}
  });
}

for (const sourceState of ['LIVE', 'DELETED', 'MISMATCH'] as const) {
  test(`saved Take ${sourceState}: raw playback/download are independent of optional exact score export`, async ({ page }) => {
    await installVideoExportOutputBarrier(page);
    await mockAuthenticatedSession(page);
    await mockRealtimeEvents(page);
    await page.goto('/en');
    // A native browser-produced media fixture with a deterministic frame boundary.
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!;
      const stream = canvas.captureStream(30);
      const audio = new AudioContext(), oscillator = audio.createOscillator(), output = audio.createMediaStreamDestination();
      oscillator.connect(output); oscillator.start(); await audio.resume();
      for(const track of output.stream.getAudioTracks())stream.addTrack(track);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks: Blob[] = [];
      const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.start();
      const start=performance.now();
      for (let frame = 0; performance.now()-start < 2000; frame++) {
        context.fillStyle = frame % 2 ? '#123456' : '#abcdef';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      recorder.stop(); await stopped;
      stream.getTracks().forEach(track => track.stop()); await audio.close();
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    const media = Buffer.from(bytes);
    await page.route('**/api/v1/performance-takes/take-1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...take, manifest: { ...take.manifest, media: { ...take.manifest.media, byte_size: media.length } } } }),
    }));
    await page.route('**/api/v1/performance-takes/take-1/media', route => route.fulfill({ status: 200, contentType: 'video/webm', body: media }));
    const sourceRequests: string[] = [];
    const exportWrites: string[] = [];
    page.on('request', request => {
      if (['POST', 'PUT'].includes(request.method())) exportWrites.push(request.url());
      const path = new URL(request.url()).pathname;
      if (path.includes('/practice-bundle') || path.startsWith('/api/v1/practice/scores/')) sourceRequests.push(request.url());
    });
    await page.route('**/api/v1/practice/scores/*/revisions/*/bundle*', route => route.fulfill({
      status: sourceState === 'DELETED' ? 404 : 200, contentType: 'application/json',
      body: JSON.stringify(sourceState === 'DELETED' ? { public_code: 'resource_not_found' } : {
        data: { binding:{score_id:take.manifest.practice_binding.score_id,revision_id:take.manifest.practice_binding.revision_id,bundle_id:sourceState === 'MISMATCH' ? 'another-bundle' : take.manifest.practice_binding.bundle_id}, artifact,
          notation: { musicxml: musicXml, mime_type: 'application/vnd.recordare.musicxml+xml' } },
      }),
    }));
    await page.goto('/en/my-performances/take-1/video-export');
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', /^blob:/);
    await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
    await video.evaluate(element => (element as HTMLVideoElement).play());
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    await video.evaluate(element => (element as HTMLVideoElement).pause());
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Video', exact: true }).click();
    const raw = await download;
    expect(await readFile((await raw.path())!)).toEqual(media);
    if (sourceState === 'LIVE') {
      await expect(page.getByTestId('generate-video-export')).toBeEnabled();
      expect(await temporaryMediaFiles(page)).toHaveLength(1);
      const composed=page.waitForEvent('download');
      await page.getByTestId('generate-video-export').click();
      await expect.poll(() => videoExportOutputFiles(page)).not.toEqual([]);
      expect((await temporaryMediaFiles(page)).filter(name => !name.endsWith('.crswap'))).toHaveLength(1);
      expect(await(await composed).failure()).toBeNull();
      await expect(page.getByTestId('video-export-success')).toBeVisible();
      await expect.poll(() => videoExportOutputFiles(page)).toEqual([]);
      // Cancellation retires a separate derivative without retiring the saved source.
      await page.getByTestId('generate-video-export').click();
      await expect.poll(() => videoExportOutputFiles(page)).not.toEqual([]);
      await page.getByRole('button', { name: 'Cancel Export', exact: true }).click();
      await expect.poll(() => videoExportOutputFiles(page)).toEqual([]);
      await expect(page.getByTestId('generate-video-export')).toBeEnabled();
      expect((await temporaryMediaFiles(page)).filter(name => !name.endsWith('.crswap'))).toHaveLength(1);
      // Hold real IO so route retirement must preserve the input lease until output cleanup settles.
      await page.evaluate(() => (window as unknown as { __videoOutput: { arm(): void } }).__videoOutput.arm());
      await page.getByTestId('generate-video-export').click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __videoOutput: { pending: boolean } }).__videoOutput.pending)).toBe(true);
      await page.getByRole('button',{name:'Back to My Performances',exact:true}).click();
      await expect(page).toHaveURL(/\/my-performances$/);
      expect((await temporaryMediaFiles(page)).filter(name => !name.endsWith('.crswap'))).toHaveLength(1);
      await page.evaluate(() => (window as unknown as { __videoOutput: { release(): void } }).__videoOutput.release());
      await expect.poll(() => videoExportOutputFiles(page)).toEqual([]);
      await expect.poll(()=>temporaryMediaFiles(page)).toEqual([]);
    } else {
      await expect(page.getByText('The exact score source is no longer available for score-based video export. Your original recording remains available.')).toBeVisible();
      await expect(page.getByTestId('generate-video-export')).toHaveCount(0);
    }
    // Saved export is an ordinary query: the application's one error retry keeps
    // requesting this same exact identity, never a Take-owned or alternate source.
    expect(sourceRequests).toHaveLength(sourceState === 'LIVE' ? 1 : 2);
    for (const request of sourceRequests) {
      expect(new URL(request).pathname).toBe(`/api/v1/practice/scores/${take.manifest.practice_binding.score_id}/revisions/${take.manifest.practice_binding.revision_id}/bundle`);
      expect(new URL(request).searchParams.get('include_notation')).toBe('true');
    }
    expect(exportWrites).toEqual([]);
  });
}

test('route exit during saved-media streaming aborts the writer and removes its partial OPFS file',async({page})=>{
  await mockAuthenticatedSession(page);await mockRealtimeEvents(page);
  await page.addInitScript(()=>{
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    (window as unknown as {__savedMediaWrite:{pending:boolean;release():void}}).__savedMediaWrite={pending:false,release};
    const create=FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable=async function(options){
      const writer=await create.call(this,options),write=writer.write.bind(writer);
      writer.write=async chunk=>{
        if(chunk instanceof Uint8Array){
          (window as unknown as {__savedMediaWrite:{pending:boolean}}).__savedMediaWrite.pending=true;
          await gate;
        }
        return write(chunk);
      };
      return writer;
    };
  });
  const bytes=Buffer.from('pending temporary bytes');
  await page.route('**/api/v1/performance-takes/take-1',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{...take,manifest:{...take.manifest,media:{...take.manifest.media,byte_size:bytes.length}}}})}));
  await page.route('**/api/v1/performance-takes/take-1/media',route=>route.fulfill({status:200,contentType:'video/webm',body:bytes}));
  await page.route('**/api/v1/practice/scores/*/revisions/*/bundle*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{binding:{score_id:take.manifest.practice_binding.score_id,revision_id:take.manifest.practice_binding.revision_id,bundle_id:take.manifest.practice_binding.bundle_id},artifact,notation:{musicxml:musicXml,mime_type:'application/vnd.recordare.musicxml+xml'}}})}));
  await page.goto('/en/my-performances/take-1/video-export');
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__savedMediaWrite:{pending:boolean}}).__savedMediaWrite.pending)).toBe(true);
  expect((await temporaryMediaFiles(page)).filter(name=>!name.endsWith('.crswap'))).toHaveLength(1);
  // Native client navigation preserves this document so the deferred writer can settle after unmount.
  await page.getByRole('link',{name:'My Library',exact:true}).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.evaluate(()=>(window as unknown as {__savedMediaWrite:{release():void}}).__savedMediaWrite.release());
  await expect.poll(()=>temporaryMediaFiles(page)).toEqual([]);
});

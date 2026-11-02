import { resolvePracticeScope } from '../../src/lib/practice/kernel/scope';
import { resolvePracticeTempoPlan } from '../../src/lib/practice/kernel/tempo';
import type { LibraryFolderTreeRead, PerformanceTakeRead, PerformanceTakeUploadReservationRequest } from "../../src/generated/api/types.gen";
import type { PracticeScoreArtifact } from '../../src/lib/practice/kernel/artifact';
import { installAcousticEngineFixture, openPreparedPractice, preparePracticeSetup, configurePractice, openPracticeSetup, selectPracticeConfiguration } from './support/practice-workspace';
import { expect, test, type Page } from '@playwright/test';
import { acousticCaptureWitness, installAcousticCaptureFixture } from './support/acoustic-capture';
import {
  mockAuthenticatedSession,
  mockRealtimeEvents,
} from './support/api-mocks';

const scoreId = 'continuous-review-score';
const revisionId = 'continuous-review-revision';
const unmatchedApiRequests = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(unmatchedApiRequests.get(page) ?? [], 'All API requests belong to the browser fixture').toEqual([]);
});

const sampleMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note id="note-c4">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note id="note-d4">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note id="note-e4">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note><rest /><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const testArtifact: PracticeScoreArtifact = {
  schemaVersion: 1,
  artifactId: 'practice-score-artifact:continuous-test', scoreId, revisionId,
   scoreEndBeat: 4,
  notes: [60, 62, 64].map((pianoKey, i) => ({ noteId: `note-${i}`, eventId: `e-${i}`, pianoKey,
    renderNoteId: ['note-c4', 'note-d4', 'note-e4'][i], measureNumber: '1', staffId: '1', voiceId: '1', tieTypes: [] })),
  events: [0,1,2].map(i => ({ eventId: `e-${i}`, onsetBeat: i, durationBeats: i === 2 ? 2 : 1 })),
  moments: [60,62,64].map((pianoKey,i) => ({ groupId: `group-${i}`, onsetBeat: i, canonicalEndBeat: i === 2 ? 4 : i+1,
    attacks: [{ attackId: `strike-${i}`, pianoKey, noteIds: [`note-${i}`] }], continuationNoteIds: [] })),
  meterSegments: [{ startBeat: 0, numerator: 4, denominator: 4,   }],
  scoreTempoSegments: [{ startBeat: 0, bpm: 120 }],
};

function apiResponse(data: unknown) {
  return JSON.stringify({ success: true, data });
}

type MockOptions = {
  denyMicrophone?: boolean;
  camera?: 'READY' | 'DENIED' | 'NO_VIDEO' | 'NO_AUDIO' | 'PENDING';
  reservationMismatch?: 'SCOPE' | 'TEMPO';
};

type MediaMock = {
  audioStreams: MediaStream[];
  cameraStreams: MediaStream[];
  captureRoots: MediaStream[];
  requests: MediaStreamConstraints[];
  tracks: Array<{ track: MediaStreamTrack; stopCalls: number }>;
  resolveCamera: (() => void) | null;
};

async function setupContinuousPracticeMocks(page: Page, options: MockOptions = {}) {
  const unmatched: string[] = [];
  unmatchedApiRequests.set(page, unmatched);
  await page.route('**/api/v1/**', route => {
    unmatched.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ success: false, public_code: 'unmocked_api' }) });
  });
  // Explicit navigation away from Practice also stays inside the mock backend.
  await page.route('**/api/v1/library/folders', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: apiResponse({ folders: [], all_count: 0, favorite_count: 0, mastered_count: 0, recent_practice_count: 0, to_practice_count: 0 } satisfies LibraryFolderTreeRead) }));
  await page.route('**/api/v1/library/entries?**', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } }) }));
  await installAcousticEngineFixture(page);
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);

  await page.route('**/api/v1/model-assets/practice-acoustic-robust-browser-v1/access', route => route.fulfill({
    contentType: 'application/json', body: apiResponse({ schemaVersion: 1, assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1',
      expectedByteSize: 98689283, sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', mediaType: 'application/octet-stream',
      downloadUrl: 'https://example.test/controlled-model', downloadUrlExpiresAt: new Date(Date.now() + 3600000).toISOString() }),
  }));
  await page.addInitScript(({ denyMic, camera }) => {
    // Mock Web MIDI
    const deviceCounts = { midi: 0 };
    (window as unknown as { __deviceCounts: typeof deviceCounts }).__deviceCounts = deviceCounts;
    const midiListeners = new Set<(event: { data: Uint8Array }) => void>();
    (window as unknown as { __emitMidiNote: (note: number, velocity: number) => void }).__emitMidiNote = (
      note: number,
      velocity: number
    ) => {
      const data = new Uint8Array([velocity > 0 ? 0x90 : 0x80, note, velocity]);
      for (const listener of midiListeners) {
        listener({ data });
      }
    };

    const fakeInput = {
      id: 'mock-midi-in-1',
      name: 'Mock MIDI Keyboard',
      manufacturer: 'Test',
      state: 'connected',
      connection: 'open',
      addEventListener: (_type: string, handler: (event: { data: Uint8Array }) => void) => {
        midiListeners.add(handler);
      },
      removeEventListener: (_type: string, handler: (event: { data: Uint8Array }) => void) => {
        midiListeners.delete(handler);
      },
      set onmidimessage(handler: ((event: { data: Uint8Array }) => void) | null) {
        if (handler) {
          midiListeners.add(handler);
        }
      },
    };

    const inputsMap = new Map();
    inputsMap.set('mock-midi-in-1', fakeInput);

    const midiStateListeners = new Set<() => void>();
    const access = { inputs: inputsMap, outputs: new Map(), onstatechange: null as (() => void) | null,
      addEventListener: (_type: string, listener: () => void) => midiStateListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => midiStateListeners.delete(listener) };
    const midiControl = { denied: false, connect: (connected: boolean) => {
      fakeInput.state = connected ? 'connected' : 'disconnected';
      for (const listener of midiStateListeners) listener(); access.onstatechange?.();
    } };
    (window as unknown as { __practiceMidi: typeof midiControl }).__practiceMidi = midiControl;
    (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess = async () => {
      deviceCounts.midi++; if (midiControl.denied) throw new DOMException('blocked', 'NotAllowedError'); return access;
    };

    // Mock Audio & Media Devices
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (denyMic) {
      if (!navigator.mediaDevices) {
        (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
          getUserMedia: async () => {
            throw new DOMException('Permission denied', 'NotAllowedError');
          },
        };
      } else {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Permission denied', 'NotAllowedError');
        };
      }
    } else {
      const createSyntheticStream = () => {
        try {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const dst = ctx.createMediaStreamDestination();
          osc.connect(dst);
          osc.start();
          return dst.stream;
        } catch {
          // Fallback mock stream with track
          const track = {
            kind: 'audio',
            enabled: true,
            readyState: 'live',
            stop: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
          };
          return {
            active: true,
            getTracks: () => [track],
            getAudioTracks: () => [track],
            getVideoTracks: () => [],
            clone: function() { return this; },
          } as unknown as MediaStream;
        }
      };

      if (!navigator.mediaDevices) {
        (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
          getUserMedia: async () => createSyntheticStream(),
        };
      } else {
        navigator.mediaDevices.getUserMedia = async () => createSyntheticStream();
      }
    }
    // Camera controls apply only to video requests; existing audio-only mocks stay intact.
    const media: MediaMock = { audioStreams: [], cameraStreams: [], captureRoots: [], requests: [], tracks: [], resolveCamera: null };
    (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia = media;
    // Capture owns an analysis clone. Trace that clone to the exact retained root object,
    // rather than mistaking a processing clone for another physical acquisition.
    const origin = new WeakMap<MediaStream, MediaStream>();
    const nativeClone = MediaStream.prototype.clone;
    MediaStream.prototype.clone = function() {
      const clone = nativeClone.call(this); origin.set(clone, origin.get(this) ?? this); return clone;
    };
    const nativeSource = AudioCtx.prototype.createMediaStreamSource;
    AudioCtx.prototype.createMediaStreamSource = function(stream: MediaStream) { media.captureRoots.push(origin.get(stream) ?? stream); return nativeSource.call(this, stream); };
    const audioOnly = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let cameraRequests = 0;
    const canvases: HTMLCanvasElement[] = [];
    const audioContexts: AudioContext[] = [];
    const cameraStream = (constraints: MediaStreamConstraints) => {
      const tracks: MediaStreamTrack[] = [];
      if (camera !== 'NO_VIDEO') {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 48;
        canvas.getContext('2d')!.fillRect(0, 0, 64, 48);
        canvases.push(canvas);
        tracks.push(...canvas.captureStream(10).getVideoTracks());
      }
      if (constraints.audio && camera !== 'NO_AUDIO') {
        const ctx = new AudioCtx();
        const oscillator = ctx.createOscillator(), destination = ctx.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        audioContexts.push(ctx);
        tracks.push(...destination.stream.getAudioTracks());
      }
      for (const track of tracks) {
        const observed = { track, stopCalls: 0 }, stop = track.stop.bind(track);
        track.stop = () => { observed.stopCalls++; stop(); };
        media.tracks.push(observed);
      }
      const stream = new MediaStream(tracks); media.cameraStreams.push(stream); return stream;
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      media.requests.push(structuredClone(constraints ?? {}));
      if (!camera || !constraints?.video) { const stream = camera === 'NO_AUDIO' ? new MediaStream() : await audioOnly(constraints); media.audioStreams.push(stream); return stream; }
      if (camera === 'DENIED') throw new DOMException('Camera permission denied', 'NotAllowedError');
      cameraRequests++;
      if (camera === 'PENDING' && cameraRequests === 1) {
        return new Promise<MediaStream>(resolve => {
          media.resolveCamera = () => {
            media.resolveCamera = null;
            resolve(cameraStream(constraints));
          };
        });
      }
      return cameraStream(constraints);
    };
  }, { denyMic: Boolean(options.denyMicrophone), camera: options.camera });

  // Mock Score Detail
  await page.route(`**/api/v1/scores/${scoreId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        title: 'Continuous Review Score',
        head_revision_id: revisionId,
        version: 1,
        created_at: '2026-08-24T00:00:00Z',
        updated_at: '2026-08-24T00:00:00Z',
        in_library: true,
        input_assets: [],
        taxonomy_tags: [],
        metadata: null,
        publication: null,
        derived_assets: {
          preview: { status: 'ready', asset_id: null, revision_id: revisionId, is_fallback: false },
          audio: { status: 'unavailable', asset_id: null, revision_id: null, is_fallback: false },
        },
        capabilities: {
          can_view: true,
          can_edit: true,
          can_delete: true,
          can_manage_sharing: true,
          can_download: true,
          can_practice: true,
          can_publish: true,
          can_manage_members: true,
        },
      }),
    })
  );

  // Mock Score Detail for 0 fallback
  await page.route('**/api/v1/scores/0', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: 0,
        title: 'Continuous Review Score',
        head_revision_id: revisionId,
        version: 1,
        created_at: '2026-08-24T00:00:00Z',
        updated_at: '2026-08-24T00:00:00Z',
        in_library: true,
        input_assets: [],
        taxonomy_tags: [],
        metadata: null,
        publication: null,
        derived_assets: {
          preview: { status: 'ready', asset_id: null, revision_id: revisionId, is_fallback: false },
          audio: { status: 'unavailable', asset_id: null, revision_id: null, is_fallback: false },
        },
        capabilities: {
          can_view: true,
          can_edit: true,
          can_delete: true,
          can_manage_sharing: true,
        },
      }),
    })
  );

  // Mock Performance Takes Routes
  const takesDatabase: PerformanceTakeRead[] = [];
  const saveProtocol = { events: [] as string[], request: null as PerformanceTakeUploadReservationRequest | null };

  let reservedRequest: PerformanceTakeUploadReservationRequest;
  function acceptedPlan(request: PerformanceTakeUploadReservationRequest) {
    const scope = resolvePracticeScope(testArtifact, request.scope.kind === 'FULL'
      ? { kind: 'FULL' }
      : { kind: 'RANGE', startGroupId: request.scope.start_group_id, endGroupId: request.scope.end_group_id });
    return {
      resolved_scope: { kind: scope.kind, start_beat: scope.startBeat, terminal_beat: scope.terminalBeat,
        ...(scope.kind === 'RANGE' ? { start_group_id: scope.startGroupId, end_group_id: scope.endGroupId } : {}) },
      resolved_tempo_plan: resolvePracticeTempoPlan(testArtifact, request.tempo_selection),
    };
  }
  await page.route('**/api/v1/performance-takes/upload-reservations', route => {
    expect(route.request().method()).toBe('POST');
    reservedRequest = route.request().postDataJSON();
    // The public write contract carries selections and evidence only.
    expect(Object.keys(reservedRequest).sort()).toEqual(['client_request_id', 'media', 'recording_timebase', 'scope', 'source', 'tempo_selection']);
    expect(reservedRequest.source).toEqual({ source_id: 'source-1' });
    expect(Object.keys(reservedRequest.scope).sort()).toEqual(reservedRequest.scope.kind === 'FULL'
      ? ['kind'] : ['end_group_id', 'kind', 'start_group_id']);
    expect(Object.keys(reservedRequest.tempo_selection).sort()).toEqual(reservedRequest.tempo_selection.mode === 'SCORE' ? ['mode'] : ['bpm', 'mode']);
    expect(reservedRequest.client_request_id).toEqual(expect.any(String));
    expect(reservedRequest.media.byte_size).toBeGreaterThan(0);
    expect(reservedRequest.recording_timebase.activeSegments.length).toBeGreaterThan(0);
    saveProtocol.request = reservedRequest;
    saveProtocol.events.push('RESERVATION');
    const accepted = acceptedPlan(reservedRequest);
    if (options.reservationMismatch === 'SCOPE') accepted.resolved_scope.terminal_beat += 1;
    if (options.reservationMismatch === 'TEMPO') {
      accepted.resolved_tempo_plan = { ...accepted.resolved_tempo_plan,
        segments: accepted.resolved_tempo_plan.segments.map((segment, index) => index === 0 ? { ...segment, bpm: segment.bpm + 1 } : segment) };
    }
    const { source, media, scope, tempo_selection, recording_timebase } = reservedRequest;
    return route.fulfill({ status: 200, contentType: 'application/json', body: apiResponse({
      reservation_id: 'upload-res-e2e-1', take_id: 'take-e2e-1', status: 'RESERVED',
      metadata: { source, media, scope, tempo_selection, recording_timebase },
      ...accepted,
      upload_target: { url: '/api/v1/performance-takes/mock-upload/take-e2e-1', method: 'PUT',
        headers: { 'content-type': media.mime_type }, expires_in: 3600 },
    }) });
  });
  await page.route('**/api/v1/performance-takes/upload-reservations/upload-res-e2e-1/finalize', route => {
    expect(route.request().postData()).toBeNull();
    expect(saveProtocol.events).toEqual(['RESERVATION', 'MEDIA_PUT']);
    saveProtocol.events.push('FINALIZE');
    const { source, media, scope, recording_timebase } = reservedRequest;
    const { resolved_scope, resolved_tempo_plan } = acceptedPlan(reservedRequest);
    const take: PerformanceTakeRead = {
      take_id: 'take-e2e-1', source_id: source.source_id, source_score_id: testArtifact.scoreId, source_revision_id: testArtifact.revisionId,
      source_artifact_id: testArtifact.artifactId, score_title_snapshot: 'Continuous Review Score',
      media_kind: media.kind, media_mime_type: media.mime_type, media_byte_size: media.byte_size,
      duration_ms: media.duration_ms, scope_type: scope.kind, scope_start_beat: resolved_scope.start_beat,
      scope_terminal_beat: resolved_scope.terminal_beat,
      scope_start_group_id: scope.kind === 'RANGE' ? scope.start_group_id : null,
      scope_end_group_id: scope.kind === 'RANGE' ? scope.end_group_id : null,
      tempo_plan: { selection: resolved_tempo_plan.selection, segments: resolved_tempo_plan.segments.map(segment => ({ ...segment })) }, recording_timebase, created_at: '2026-09-20T12:00:00Z',
    };
    takesDatabase.push(take);
    return route.fulfill({ status: 200, contentType: 'application/json', body: apiResponse(take) });
  });

  await page.route('**/api/v1/performance-takes/mock-upload/*', route => {
    expect(route.request().method()).toBe('PUT');
    expect(saveProtocol.events).toEqual(['RESERVATION']);
    expect(route.request().postDataBuffer()?.byteLength).toBe(reservedRequest.media.byte_size);
    saveProtocol.events.push('MEDIA_PUT');
    return route.fulfill({ status: 200 });
  });
  await page.route('**/api/v1/performance-takes/upload-reservations/upload-res-e2e-1', route => {
    expect(route.request().method()).toBe('DELETE');
    expect(saveProtocol.events).toEqual(['RESERVATION']);
    saveProtocol.events.push('CANCEL');
    return route.fulfill({ status: 200, contentType: 'application/json', body: apiResponse({ cancelled: true }) });
  });

  await page.route('**/api/v1/performance-takes/take-e2e-1/playback-url', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        take_id: 'take-e2e-1',
        playback_url: 'https://mock-oss.noteverse.com/play.webm',
        download_url: 'https://mock-oss.noteverse.com/download.webm',
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 1024,
        duration_ms: 3000,
        expires_in: 3600,
      }),
    })
  );

  await page.route('**/api/v1/performance-takes/take-e2e-1', (route) => {
    if (route.request().method() === 'DELETE') {
      const idx = takesDatabase.findIndex((t) => t.take_id === 'take-e2e-1');
      if (idx !== -1) takesDatabase.splice(idx, 1);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: apiResponse({ deleted: true }),
      });
    }
    return route.continue();
  });

  await page.route(
    (url) => url.pathname === '/api/v1/performance-takes',
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: apiResponse({
            items: [...takesDatabase],
            total: takesDatabase.length,
            limit: 50,
            offset: 0,
            has_more: false,
          }),
        });
      }
      return route.continue();
    }
  );

  // One Practice Source envelope supplies the artifact and requested notation.
  await page.route(/\/api\/v1\/practice\/scores\/[^/]+\/revisions\/[^/]+\/source(?:\?.*)?$/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({ source_id: 'source-1', artifact: testArtifact, notation:
        new URL(route.request().url()).searchParams.get('include_notation') === 'true'
          ? { musicxml: sampleMusicXml, mime_type: 'application/vnd.recordare.musicxml+xml' } : null }),
    })
  );
  return saveProtocol;
}

function recordingOption(page: Page, mode: 'OFF' | 'AUDIO' | 'VIDEO') {
  return page.getByRole('button', { name: { OFF: /^不录制/, AUDIO: /^(录制音频|录音)/, VIDEO: /^(录制视频|录像)/ }[mode] });
}



test('first use requires explicit intent; full reload restores intent but requires live preparation', async ({ page }) => {
  await setupContinuousPracticeMocks(page);
  const sourceRequests: string[] = [];
  page.on('request',request=>{if(request.url().includes('/practice/')&&request.url().includes('/source'))sourceRequests.push(request.url());});
  await page.goto(`/zh/score/${scoreId}/practice/setup?practiceRevisionId=${revisionId}`);
  const setup = page.getByTestId('practice-setup');
  await expect(setup).toBeVisible();
  await expect(setup.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(setup.getByRole('button', { name: '开始练习', exact: true })).toBeDisabled();
  await setup.getByRole('button', { name: '连贯演奏', exact: true }).click();
  await setup.getByRole('button', { name: 'MIDI 键盘', exact: true }).click();
  await expect(setup.getByRole('button', { name: '开始练习', exact: true })).toBeDisabled();
  await setup.getByRole('button', { name: '不录制', exact: true }).click();
  await expect(setup.getByRole('checkbox')).toHaveCount(0);
  await expect(setup.getByRole('switch')).toHaveCount(0);
  await setup.getByRole('button', { name: '开始练习', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  sourceRequests.length=0;
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/practice\\?practiceRevisionId=${revisionId}$`));
  await expect(page.getByText('请先完成练习准备。')).toBeVisible();
  expect(sourceRequests).toEqual([]);expect((await deviceAndEnvironmentCounts(page)).media).toBe(0);expect((await deviceAndEnvironmentCounts(page)).midi).toBe(0);
  await page.getByRole('button', { name: '返回练习设置', exact: true }).click();
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('button', { name: '连贯演奏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(setup.getByRole('button', { name: 'MIDI 键盘', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(setup.getByRole('button', { name: '不录制', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  await expect(setup.getByRole('button', { name: '开始练习', exact: true })).toBeEnabled();
});

test('warm microphone engine survives STEP End, next Start, Continuous completion, Try Again and Review Retry', async ({ page }) => {
  await installAcousticCaptureFixture(page);
  await setupContinuousPracticeMocks(page);
  const engine = () => page.evaluate(() => {
    const { loads, sessions, retiredSessions, terminations } = (window as unknown as {
      __practiceAcousticEngineFixture: { loads: number; sessions: number; retiredSessions: number; terminations: number };
    }).__practiceAcousticEngineFixture;
    return { loads, sessions, retiredSessions, terminations };
  });
  let accessRequests = 0;
  page.on('request', request => { if (request.url().includes('/model-assets/practice-acoustic-robust-browser-v1/access')) accessRequests++; });
  await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page, 'STEP', 'MICROPHONE');
  await expect.poll(engine).toEqual({ loads: 1, sessions: 1, retiredSessions: 1, terminations: 0 });
  const start = page.getByRole('button', { name: '开始', exact: true });
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 2; i++) {
    await expect(start).toBeEnabled(); await start.click();
    await expect.poll(async () => (await engine()).sessions).toBe(2 + i);
    await expect(start).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toContainText('弹奏当前高亮音');
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect.poll(async () => (await engine()).retiredSessions).toBe(2 + i);
    await expect(dialog).toHaveCount(0);
  }
  await configurePractice(page, 'CONTINUOUS', 'MICROPHONE');
  for (let i = 0; i < 2; i++) {
    if (i === 0) { await expect(start).toBeEnabled(); await start.click(); }
    else {
      await dialog.getByRole('button', { name: '重弹一次', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    // BEGIN_SESSION proves this command started a new attempt, rather than observing
    // the previous completion dialog or the empty status of a preparing controller.
    await expect.poll(async () => (await engine()).sessions).toBe(4 + i);
    await expect(page.getByTestId('practice-status')).toContainText('预备拍');
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');
    await expect(dialog.getByRole('button', { name: '查看报告', exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await engine()).retiredSessions).toBe(4 + i);
  }
  await dialog.getByRole('button', { name: '查看报告', exact: true }).click();
  await page.waitForURL(`**/score/${scoreId}/practice/review`);
  await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();
  await page.getByRole('button', { name: '重弹一次', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/setup\\?practiceRevisionId=${revisionId}$`));
  expect(await preparePracticeSetup(page)).toBe('READY');
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(async () => (await engine()).sessions).toBe(6);
  await expect(page.getByTestId('practice-status')).toContainText('预备拍');
  await page.getByRole('button', { name: '结束', exact: true }).click();
  await expect.poll(engine).toEqual({ loads: 1, sessions: 6, retiredSessions: 6, terminations: 0 });
  expect(accessRequests).toBe(1);
  const capture = await acousticCaptureWitness(page);
  expect(capture.opened).toBe(8); expect(capture.closed).toBe(capture.opened);
  expect(capture.acknowledgedBlocks).toBeGreaterThan(0); expect(capture.maxInFlight).toBe(1);
});

test('live feedback is off by default, toggles without restarting, and Review retains completed feedback', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '实时演奏反馈' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await page.clock.runFor(2000);
  await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');
  await page.evaluate(() => (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100));
  await page.clock.runFor(800);
  await expect(page.locator('.practice-summary-note-supported')).toHaveCount(0);
  await expect(page.locator('[data-practice-playhead-cursor]')).toHaveCount(1);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const feedback = page.getByRole('switch', { name: '实时演奏反馈' });
  await feedback.check();
  await expect(page.locator('.practice-summary-note-supported')).toHaveCount(1);
  await feedback.uncheck();
  await expect(page.locator('.practice-summary-note-supported')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.clock.runFor(1500); await page.clock.resume();
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await page.waitForURL(`**/score/${scoreId}/practice/review`);
  await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();
  await expect(page.locator('.practice-summary-note-supported')).toHaveCount(1);
  await expect(page.getByText('正确', { exact: true })).toHaveCount(0);
});

test('Review Retry preserves committed section, custom tempo, metronome and preference intent with pinned revision', async ({ page }) => {
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '实时演奏反馈' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '分段', exact: true }).click();
  for (const note of ['note-c4', 'note-e4']) await page.locator(`[data-id="${note}"]`).first().locator('path, use').first().click();
  await page.getByRole('button', { name: '速度' }).click();
  await page.getByRole('button', { name: '+5 BPM', exact: true }).click();
  await page.getByRole('button', { name: '节拍器声音', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await page.getByRole('button', { name: '重弹一次', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/setup\\?practiceRevisionId=${revisionId}$`));
  expect(await preparePracticeSetup(page)).toBe('READY');
  await expect(page.locator('.practice-range-selected')).toHaveCount(3);
  await page.getByRole('button', { name: '速度' }).click();
  await expect(page.getByText('125 BPM', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '节拍器声音', exact: true })).toContainText('开');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('switch', { name: '实时演奏反馈' })).toBeChecked();
  await page.keyboard.press('Escape');
  await openPracticeSetup(page);
  await expect(page.getByRole('button', { name: '连贯演奏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'MIDI 键盘', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(recordingOption(page, 'OFF')).toHaveAttribute('aria-pressed', 'true');

});

async function mediaState(page: Page) {
  return page.evaluate(() => {
    const media = (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia;
    return { requests: media.requests, pending: media.resolveCamera !== null,
      tracks: media.tracks.map(({ track, stopCalls }) => ({ kind: track.kind, state: track.readyState, stopCalls })) };
  });
}

async function openCameraSetup(page: Page, input: 'MIDI' | 'MICROPHONE', camera: MockOptions['camera']) {
  await setupContinuousPracticeMocks(page, { camera });
  await openPreparedPractice(page, scoreId, revisionId);
  await openPracticeSetup(page);
  await selectPracticeConfiguration(page, 'CONTINUOUS', input, 'OFF');
  await expect(recordingOption(page, 'OFF')).toHaveAttribute('aria-pressed', 'true');
}

async function expectCameraReady(page: Page, audioTracks: number) {
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noteverse.practice.preferences.v1')!).continuous.recordingMode)).toBe('VIDEO');
  await expect(page.getByText('画面已就绪，开始后会录制视频和真实声音')).toHaveCount(0);
  for (const mode of ['OFF', 'AUDIO', 'VIDEO'] as const) await expect(recordingOption(page, mode)).toHaveCount(0);
  const preview = page.locator('video[aria-label="摄像头预览"]');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(element => {
    const stream = (element as HTMLVideoElement).srcObject as MediaStream | null;
    return { video: stream?.getVideoTracks().length, audio: stream?.getAudioTracks().length,
      live: stream?.getTracks().every(track => track.readyState === 'live') };
  })).toEqual({ video: 1, audio: audioTracks, live: true });
}

async function expectCameraStopped(page: Page, trackCount: number) {
  await expect.poll(async () => {
    const { tracks } = await mediaState(page);
    return tracks.length === trackCount && tracks.every(track => track.state === 'ended' && track.stopCalls > 0);
  }).toBe(true);
}

async function expectVideoIntentBlocked(page: Page) {
  await expect(recordingOption(page, 'VIDEO')).toHaveAttribute('aria-pressed', 'true');
  await expect(recordingOption(page, 'OFF')).toHaveAttribute('aria-pressed', 'false');
  await expect(recordingOption(page, 'VIDEO')).toBeEnabled();
  await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
  const start = page.getByRole('button', { name: '开始', exact: true });
  if (await start.count()) await expect(start).toBeDisabled();
  else await expect(start).toHaveCount(0);
}

test.describe('Continuous VIDEO camera preparation', () => {
  test('MIDI VIDEO retains admitted camera when further camera permission would be denied', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'READY'); await recordingOption(page, 'VIDEO').click();
    await page.evaluate(() => {
      const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let camera = 0;
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (constraints?.video && ++camera > 1) throw new DOMException('revoked', 'NotAllowedError');
        return native(constraints);
      };
    });
    expect(await preparePracticeSetup(page)).toBe('READY'); await expectCameraReady(page, 0);
    expect(await page.locator('video[aria-label="摄像头预览"]').evaluate(video =>
      (video as HTMLVideoElement).srcObject === (window as unknown as {__practiceMedia:MediaMock}).__practiceMedia.cameraStreams[0])).toBe(true);
    expect((await mediaState(page)).requests).toHaveLength(2);
    await page.getByRole('button',{name:'开始',exact:true}).click();
    await expect(page.getByTestId('recording-indicator')).toBeVisible();
    expect((await mediaState(page)).requests).toHaveLength(2);
  });

  test('MIDI AUDIO uses its admitted microphone without requesting recording permission again', async ({ page }) => {
    await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
    await openPracticeSetup(page); await selectPracticeConfiguration(page, 'CONTINUOUS', 'MIDI', 'AUDIO');
    await page.evaluate(() => {
      const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let requests = 0;
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (++requests > 1) throw new DOMException('revoked', 'NotAllowedError'); return native(constraints);
      };
    });
    expect(await preparePracticeSetup(page)).toBe('READY');
    await expect(page.getByRole('button',{name:'录制麦克风正常',exact:true})).toHaveAttribute('data-device-health','HEALTHY');
    await page.getByRole('button',{name:'开始',exact:true}).click(); await expect(page.getByTestId('recording-indicator')).toBeVisible();
    expect((await mediaState(page)).requests).toHaveLength(1);
    expect(await page.evaluate(() => (window as unknown as {__practiceAcousticEngineFixture:{loads:number}}).__practiceAcousticEngineFixture.loads)).toBe(0);
  });

  test('MIDI requests camera video and real audio, then installs a live ready preview', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'READY');
    expect((await mediaState(page)).requests).toEqual([]);
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expectCameraReady(page, 0);
    expect((await mediaState(page)).requests).toEqual([
      { video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
      { video: { facingMode: 'user' }, audio: false },
    ]);
  });

  test('MICROPHONE requests camera video only and accepts a live video-only preview', async ({ page }) => {
    await openCameraSetup(page, 'MICROPHONE', 'READY');
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expectCameraReady(page, 0);
    expect((await mediaState(page)).requests).toEqual([
      { video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } },
      { video: { facingMode: 'user' }, audio: false },
    ]);
  });

  test('camera permission denial preserves VIDEO intent and blocks readiness', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'DENIED');
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expect(page.getByTestId('practice-setup').getByRole('alert')).toBeVisible();
    await expectVideoIntentBlocked(page);
    expect((await mediaState(page)).tracks).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as {__practiceMedia:MediaMock}).__practiceMedia.audioStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
  });

  test('a stream without usable video is rejected and every acquired track is stopped', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'NO_VIDEO');
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expect(page.getByTestId('practice-setup').getByRole('alert')).toBeVisible();
    await expectVideoIntentBlocked(page);
    expect((await mediaState(page)).tracks).toEqual([]);
  });

  test('MIDI video without real audio is rejected and its video track is stopped', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'NO_AUDIO');
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expect(page.getByTestId('practice-setup').getByRole('alert')).toBeVisible();
    await expectVideoIntentBlocked(page);
    expect((await mediaState(page)).tracks.every(track => track.state === 'ended')).toBe(true);
  });

  for (const change of ['input', 'mode'] as const) {
    test(`${change} change releases the previous preview and preserves recording intent`, async ({ page }) => {
      await openCameraSetup(page, 'MIDI', 'READY');
      await recordingOption(page, 'VIDEO').click();
      await preparePracticeSetup(page);
      await expectCameraReady(page, 0);
      await openPracticeSetup(page);
      await page.getByRole('button', { name: change === 'input' ? '麦克风' : '逐音练习', exact: true }).click();
      await expectCameraStopped(page, 1);
      if (change === 'input') await expectVideoIntentBlocked(page);
      else await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noteverse.practice.preferences.v1')!).continuous.recordingMode)).toBe('VIDEO');
    });
  }

  test('leaving Setup during pending acquisition fences completion and stops late camera roots', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'PENDING'); await recordingOption(page, 'VIDEO').click();
    await page.getByRole('button',{name:'开始练习',exact:true}).click();
    await expect.poll(async () => (await mediaState(page)).pending).toBe(true);
    await expect(page.getByRole('button',{name:'麦克风',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'开始练习',exact:true})).toBeDisabled();
    await page.getByRole('link',{name:'NoteVerse Pro'}).click(); await expect(page).toHaveURL(/\/zh\/library/);
    await page.evaluate(() => (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.resolveCamera!());
    await expectCameraStopped(page,1);
    expect(await page.evaluate(() => (window as unknown as {__practiceMedia:MediaMock}).__practiceMedia.audioStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true);
    await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/zh\/library/);
  });

  test('client navigation unmounts Practice and stops the owned preview tracks', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'READY');
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expectCameraReady(page, 0);
    // Compile the destination before exercising the client-unmount privacy boundary.
    expect((await page.request.get('/zh/library')).ok()).toBe(true);
    await page.getByRole('link', { name: 'NoteVerse Pro' }).click();
    await expect(page).toHaveURL(/\/zh\/library/);
    await expectCameraStopped(page, 1);
    await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
  });

  test('completion retains page roots and Review navigation releases them', async ({ page }) => {
    await openCameraSetup(page, 'MIDI', 'READY');
    await recordingOption(page, 'VIDEO').click();
    await preparePracticeSetup(page);
    await expectCameraReady(page, 0);
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByTestId('recording-indicator')).toBeVisible();
    await expect(page.getByTestId('practice-status')).toHaveText('');
    // Allow the scope to complete naturally; End discards recordings.
    await expect(page.getByRole('button', { name: '查看报告' })).toBeVisible();
    await expectCameraReady(page, 0);
    await page.getByRole('button', { name: '查看报告' }).click();
    await page.waitForURL('**/practice/review');
    await expectCameraStopped(page, 1);
  });
});

test.describe('Continuous Performance Review & Audio Capture E2E', () => {
  test('STEP_BY_STEP: Completion dialog shows ONLY retry/range adjustment, NO report button', async ({
    page,
  }) => {
    await setupContinuousPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Switch input to MIDI
    await configurePractice(page, 'STEP', 'MIDI', 'OFF');

    // Explicit Start captures this STEP attempt.
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '跳过', exact: true })).toBeEnabled();

    // Reaching the final learning target naturally is the only dialog source.
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '跳过', exact: true }).click();

    // Verify dialog opened
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();

    // Assert "重弹一次" and "分段练习" (or "调整分段") exist
    await expect(page.getByRole('button', { name: /重弹一次|再弹一次/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /分段练习|调整分段/i })).toBeVisible();

    // Assert "查看报告" DOES NOT exist
    await expect(page.getByRole('button', { name: '查看报告' })).not.toBeVisible();
  });

  test('CONTINUOUS_PLAY + MIDI: Complete performance, navigate to review, replay metadata and completed annotations rendered', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/performance-takes') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupContinuousPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Open settings -> select CONTINUOUS_PLAY and MIDI
    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'OFF');

    // Freeze before starting: wall-clock/CI latency must not consume this 2-second scope.
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Advance exactly the four count-in beats at 120 BPM, leaving performance time at 0.
    await expect(page.getByRole('status')).toContainText('预备拍');
    await page.clock.runFor(2000);
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');

    // Emit notes
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100);
    });

    // Run through the scope terminal; user End must never generate this report.
    await page.clock.runFor(2200);
    await page.clock.resume();

    // Assert completion dialog opened with "查看报告"
    await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();
    const viewReportButton = page.getByRole('button', { name: '查看报告' });
    await expect(viewReportButton).toBeVisible();
    await viewReportButton.click();

    // Navigates to /review
    await page.waitForURL(`**/score/${scoreId}/practice/review`);
    await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();

    await expect(page.getByRole('region', { name: /目标音结果|目标音识别|额外演奏/ })).toHaveCount(0);

    // Verify factual cards
    await expect(page.getByText('演奏时长')).toBeVisible();
    await expect(page.getByText('演奏速度')).toBeVisible();
    await expect(page.getByText('练习范围')).toBeVisible();
    await expect(page.getByText('输入方式')).toBeVisible();
    for (const label of ['目标音', '正确', '漏弹', '错音', '额外音', '未完成']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.locator('.practice-summary-note-supported')).toHaveCount(1);
    await expect(page.locator('.practice-summary-note-unsupported')).toHaveCount(2);
    await expect(page.getByText('本次演奏未录制')).toBeVisible();

    // Zero backend session or take requests
    expect(disallowedRequests).toEqual([]);
  });

  test('CONTINUOUS_PLAY: Pause, resume, and complete session with synchronized audio review', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await setupContinuousPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Open settings -> select CONTINUOUS_PLAY and MIDI
    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    await startButton.click();
    await page.clock.runFor(2000);

    // Wait until running
    await expect(page.getByTestId('recording-indicator')).toBeVisible();
    await expect(page.getByTestId('practice-status')).toHaveText('');

    // Pause practice
    const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();

    // Verify paused state
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible();

    // Resume practice
    const resumeButton = page.getByRole('button', { name: '继续', exact: true });
    await resumeButton.click();
    await expect(page.getByRole('status')).toContainText('预备拍');
    const frozen = await page.getByTestId('recording-indicator').innerText();
    await page.clock.runFor(1999); await expect(page.getByTestId('recording-indicator')).toHaveText(frozen);
    await page.clock.runFor(1);
    await expect(page.getByTestId('practice-status')).toHaveText('');

    await page.clock.runFor(2200);
    await page.clock.resume();
    // Natural completion finishes this short scope without an End command.
    await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();

    // Click "查看报告"
    const viewReportButton = page.getByRole('button', { name: '查看报告' });
    await expect(viewReportButton).toBeVisible();
    await viewReportButton.click();

    // Navigates to /review
    await page.waitForURL(`**/score/${scoreId}/practice/review`);
    await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();

    // Verify player is present and ready to replay
    await expect(page.getByRole('button', { name: '回放' })).toBeVisible();
    await expect(page.getByRole('slider', { name: '回放位置' })).toBeVisible();
  });

  test('CONTINUOUS_PLAY + MIDI with microphone denied blocks AUDIO setup without fallback or a result', async ({ page }) => {
    await setupContinuousPracticeMocks(page, { denyMicrophone: true });
    await openPreparedPractice(page, scoreId, revisionId);
    expect(await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO')).toBe('BLOCKED');
    await expect(page.getByTestId('practice-setup').getByRole('alert')).toBeVisible();
    await expect(recordingOption(page, 'AUDIO')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noteverse.practice.preferences.v1')!).continuous.recordingMode)).toBe('AUDIO');
  });

  for (const state of ['COUNT_IN', 'PAUSED'] as const) test(`Continuous End during ${state} discards the session and returns Start without a dialog`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/performance-takes') && request.method() !== 'GET') writes.push(request.url());
    });
    await setupContinuousPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);
    await configurePractice(page);
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
    const start = page.getByRole('button', { name: '开始', exact: true });
    const end = page.getByRole('button', { name: '结束', exact: true });
    await start.click();
    await expect(page.getByRole('status')).toContainText('预备拍');
    if (state === 'PAUSED') {
      await page.clock.runFor(2000);
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('练习已暂停');
    }
    await end.click();
    await expect(start).toBeEnabled(); await expect(end).toBeDisabled();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
    await page.clock.runFor(10000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await start.click();
    await expect(page.getByRole('status')).toContainText('预备拍');
    await end.click(); await expect(start).toBeEnabled();
    expect(writes).toEqual([]);
  });

  test('Direct visit / Reload on Review Page: Renders expired state with zero server requests', async ({
    page,
  }) => {
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/performance-takes') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupContinuousPracticeMocks(page);

    // Visit review page directly without draft
    await page.goto(`/zh/score/${scoreId}/practice/review`);

    // Verify expired state
    await expect(page.getByText('本次临时报告已失效')).toBeVisible();
    const backButton = page.getByRole('button', { name: '返回练习' });
    await expect(backButton).toBeVisible();

    // Explicit navigation opens Setup without acquiring or admitting anything.
    await backButton.click();
    await page.waitForURL(`**/score/${scoreId}/practice/setup?practiceRevisionId=${revisionId}`);
    expect((await mediaState(page)).requests).toEqual([]);
    expect((await deviceAndEnvironmentCounts(page)).midi).toBe(0);

    // Assert 0 session or take requests
    expect(disallowedRequests).toEqual([]);
  });

  test('CONTINUOUS_PLAY + Audio: Save recording, direct upload, view in My Performances, and delete', async ({
    page,
  }, testInfo) => {
    const mediaWrites: { url: string; body: Record<string, unknown> | null }[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/performance-takes')) mediaWrites.push({ url: request.url(), body: request.postData() ? request.postDataJSON() : null });
    });
    const protocol = await setupContinuousPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Switch to continuous mode
    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait until running
    await expect(page.getByTestId('recording-indicator')).toBeVisible();
    await expect(page.getByTestId('practice-status')).toHaveText('');

    // Natural completion finishes this short scope without an End command.
    await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();

    // Click "查看报告"
    const viewReportButton = page.getByRole('button', { name: '查看报告' });
    await expect(viewReportButton).toBeVisible();
    await viewReportButton.click();

    // Navigates to /review
    await page.waitForURL(`**/score/${scoreId}/practice/review`);
    await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();

    // Verify "保存录制" button is visible and enabled
    const saveButton = page.getByRole('button', { name: '保存录制' });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Completion and Review mount never save a take.
    expect(mediaWrites).toEqual([]);
    // Only this explicit user action may persist media.
    await saveButton.click();

    // Verify button changes to "已保存"
    await expect(page.getByRole('button', { name: '已保存' })).toBeVisible({ timeout: 10_000 });

    expect(protocol.events).toEqual(['RESERVATION', 'MEDIA_PUT', 'FINALIZE']);
    expect(protocol.request?.scope).toEqual({ kind: 'FULL' });
    expect(protocol.request?.tempo_selection).toEqual({ mode: 'SCORE' });
    await testInfo.attach('save-protocol', { body: JSON.stringify(protocol, null, 2), contentType: 'application/json' });
    expect(mediaWrites).toHaveLength(2);
    expect(mediaWrites[0].body).toHaveProperty('source');
    expect(mediaWrites[1].body).toBeNull();

    // Click "查看我的演奏" button
    const viewMyPerformancesBtn = page.getByRole('button', { name: '查看我的演奏' }).first();
    await expect(viewMyPerformancesBtn).toBeVisible();
    await viewMyPerformancesBtn.click();

    // Navigates to /zh/my-performances
    await page.waitForURL('**/my-performances');
    await expect(page.getByRole('heading', { name: '我的演奏' })).toBeVisible();

    // Verify take card is rendered
    await expect(page.getByTestId('play-take-take-e2e-1')).toBeVisible();
    await expect(page.getByTestId('download-take-take-e2e-1')).toBeVisible();
    await expect(page.getByTestId('delete-take-take-e2e-1')).toBeVisible();

    // Click play
    await page.getByTestId('play-take-take-e2e-1').click();
    await expect(page.getByRole('slider', { name: '回放位置' })).toBeVisible({ timeout: 10_000 });

    // Click delete
    await page.getByTestId('delete-take-take-e2e-1').click();

    // Confirmation dialog appears
    await expect(page.getByText('确定要删除这条演奏记录吗？')).toBeVisible();

    // Confirm deletion
    const confirmDeleteBtn = page.getByRole('button', { name: '删除' });
    await confirmDeleteBtn.click();

    // Verify empty state is rendered
    await expect(page.getByText('暂无已保存的演奏')).toBeVisible({ timeout: 10_000 });
  });

  test('Legacy /summary route returns 404 and is not accessible', async ({ page }) => {
    await setupContinuousPracticeMocks(page);
    const response = await page.goto(`/zh/score/${scoreId}/practice/summary`);
    expect(response?.status()).toBe(404);
  });
});

async function observeNativeRecorders(page: Page) {
  await page.addInitScript(() => {
    const NativeRecorder = window.MediaRecorder;
    const recorders: MediaRecorder[] = [];
    (window as unknown as { __nativePracticeRecorders: MediaRecorder[] }).__nativePracticeRecorders = recorders;
    window.MediaRecorder = class extends NativeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) { super(stream, options); recorders.push(this); }
    };
  });
}
async function interruptRecordingTrack(page: Page, kind: 'audio' | 'video') {
  return page.evaluate(kind => {
    const recorders = (window as unknown as { __nativePracticeRecorders: MediaRecorder[] }).__nativePracticeRecorders;
    const active = recorders.findLast(recorder => recorder.state === 'recording');
    if (!active) throw new Error('No active recording pipeline');
    const track = active.stream.getTracks().find(track => track.kind === kind)!;
    track.stop(); track.dispatchEvent(new Event('ended')); return recorders.length;
  }, kind);
}

test('runtime AUDIO interruption pauses until explicit no-recording continuation, then natural Review preserves the result', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await observeNativeRecorders(page); await setupContinuousPracticeMocks(page);
  await openPreparedPractice(page, scoreId, revisionId); await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');
  for (const name of ['逐音练习', '连贯演奏', '麦克风', 'MIDI 键盘', '不录制', '录音', '录像', '开始练习']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('button', { name: '开始', exact: true }).click(); await page.clock.runFor(2200);
  await interruptRecordingTrack(page, 'audio');
  const dialog = page.getByRole('alertdialog'); await expect(dialog).toBeVisible();
  await expect(page.getByRole('status')).toContainText('录制已中断，练习已暂停');
  await expect(dialog.getByRole('button', { name: /检查/ })).toHaveCount(0);
  const cursor = await page.locator('[data-practice-playhead-cursor]').getAttribute('x');
  await page.clock.runFor(5000);
  await expect(page.locator('[data-practice-playhead-cursor]')).toHaveAttribute('x', cursor!);
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '不录制并继续', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('预备拍');
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noteverse.practice.preferences.v1')!).continuous.recordingMode)).toBe('AUDIO');
  await page.clock.runFor(2000); await page.clock.resume();
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await page.waitForURL(`**/score/${scoreId}/practice/review`);
  await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();
  await expect(page.getByText('本次录音不可用', { exact: true }).first()).toBeVisible();
});

test('hard VIDEO interruption offers no Restart and End discards the live paused attempt', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await observeNativeRecorders(page); await openCameraSetup(page, 'MIDI', 'READY');
  await recordingOption(page, 'VIDEO').click(); await preparePracticeSetup(page); await expectCameraReady(page, 0);
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('button', { name: '开始', exact: true }).click(); await page.clock.runFor(2100);
  const count = await interruptRecordingTrack(page, 'video');
  const dialog = page.getByRole('alertdialog'); await expect(dialog).toBeVisible();
  await expect(page.locator('video[aria-label="摄像头预览"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '重新开始', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button')).toHaveCount(2);
  await dialog.getByRole('button', { name: '结束', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __nativePracticeRecorders: MediaRecorder[] }).__nativePracticeRecorders.length)).toBe(count);
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
});

test('recording-only mute passively recovers but waits for explicit Continue, without any Check action', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await observeNativeRecorders(page); await setupContinuousPracticeMocks(page);
  await openPreparedPractice(page, scoreId, revisionId); await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');
  await expect(page.getByTestId('practice-status')).toHaveText(''); await expect(page.getByRole('button', { name: '更改练习配置', exact: true })).toHaveCount(0);
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('button', { name: '开始', exact: true }).click(); await page.clock.runFor(2200);
  await page.evaluate(() => {
    const recorder = (window as unknown as { __nativePracticeRecorders: MediaRecorder[] }).__nativePracticeRecorders.findLast(r => r.state === 'recording')!;
    const track = recorder.stream.getAudioTracks()[0]; Object.defineProperty(track, 'muted', { configurable: true, value: true }); track.dispatchEvent(new Event('mute'));
  });
  const dialog = page.getByRole('alertdialog'); await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole('heading', { name: '录制暂时中断' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /检查/ })).toHaveCount(0); await expect(dialog.getByRole('button', { name: '继续', exact: true })).toHaveCount(0);
  const time = await page.getByTestId('recording-indicator').innerText(); await page.clock.runFor(3000);
  await expect(page.getByTestId('recording-indicator')).toHaveText(time);
  await page.evaluate(() => {
    const recorder = (window as unknown as { __nativePracticeRecorders: MediaRecorder[] }).__nativePracticeRecorders.findLast(r => r.state === 'paused')!;
    const track = recorder.stream.getAudioTracks()[0]; Object.defineProperty(track, 'muted', { configurable: true, value: false }); track.dispatchEvent(new Event('unmute'));
  });
  await expect(dialog.getByRole('heading', { name: '录制设备已恢复' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '不录制并继续', exact: true })).toHaveCount(0);
  await page.clock.runFor(3000); await expect(page.getByTestId('recording-indicator')).toHaveText(time);
  await dialog.getByRole('button', { name: '继续', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('预备拍');
  await expect(page.getByTestId('recording-indicator')).toHaveText(time);
  await page.clock.runFor(1999); await expect(page.getByTestId('recording-indicator')).toHaveText(time);
  await page.clock.runFor(501);
  await page.getByRole('button', { name: '结束', exact: true }).click(); await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noteverse.practice.preferences.v1')!).continuous.recordingMode)).toBe('AUDIO');
});

test('shared microphone interruption requires input recovery and never offers no-recording continuation', async ({ page }) => {
  await observeNativeRecorders(page); await setupContinuousPracticeMocks(page);
  await openPreparedPractice(page, scoreId, revisionId); await configurePractice(page, 'CONTINUOUS', 'MICROPHONE', 'AUDIO');
  await page.getByRole('button', { name: '开始', exact: true }).click(); await expect(page.getByRole('status')).toContainText('预备拍');
  await page.evaluate(() => {
    const stream = (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.audioStreams.findLast(s => s.getAudioTracks().some(t => t.readyState === 'live'))!;
    const track = stream.getAudioTracks()[0]; Object.defineProperty(track, 'muted', { configurable: true, value: true }); track.dispatchEvent(new Event('mute'));
  });
  const dialog = page.getByRole('alertdialog'); await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole('heading', { name: '输入暂时中断' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '不录制并继续', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /检查/ })).toHaveCount(0);
  await page.evaluate(() => {
    const stream = (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.audioStreams.findLast(s => s.getAudioTracks().some(t => t.readyState === 'live'))!;
    const track = stream.getAudioTracks()[0]; Object.defineProperty(track, 'muted', { configurable: true, value: false }); track.dispatchEvent(new Event('unmute'));
  });
  await expect(dialog.getByRole('heading', { name: '输入设备已恢复' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('输入已中断，练习已暂停');
  await dialog.getByRole('button', { name: '继续', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    const stream = (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.audioStreams.findLast(s => s.getAudioTracks().some(t => t.readyState === 'live'))!;
    const track = stream.getAudioTracks()[0]; track.stop(); track.dispatchEvent(new Event('ended'));
  });
  await expect(dialog).toHaveCount(1); await expect(dialog.getByRole('heading', { name: '输入设备已断开' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '继续', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '不录制并继续', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '结束', exact: true }).click(); await expect(page.getByRole('button', { name: '开始', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toHaveCount(0);
});

test('temporary session AudioContext suspension retains the capture graph and waits for explicit Continue', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext, contexts: AudioContext[] = [];
    (window as unknown as { __sessionContexts: AudioContext[] }).__sessionContexts = contexts;
    window.AudioContext = class extends NativeContext { constructor(options?: AudioContextOptions) { super(options); contexts.push(this); } };
  });
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page, 'CONTINUOUS', 'MICROPHONE', 'OFF');
  await page.getByRole('button', { name: '开始', exact: true }).click(); await expect(page.getByRole('status')).toContainText('预备拍');
  const identity = await page.evaluate(async () => {
    const contexts = (window as unknown as { __sessionContexts: AudioContext[] }).__sessionContexts;
    const context = contexts.findLast(c => c.state === 'running')!; await context.suspend(); return contexts.indexOf(context);
  });
  const dialog = page.getByRole('alertdialog'); await expect(dialog.getByRole('heading', { name: '输入暂时中断' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '不录制并继续', exact: true })).toHaveCount(0);
  await page.evaluate(async index => { await (window as unknown as { __sessionContexts: AudioContext[] }).__sessionContexts[index].resume(); }, identity);
  await expect(dialog.getByRole('heading', { name: '输入设备已恢复' })).toBeVisible();
  await dialog.getByRole('button', { name: '继续', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: '结束', exact: true }).click(); await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  expect(await page.evaluate(index => (window as unknown as { __sessionContexts: AudioContext[] }).__sessionContexts[index].state, identity)).toBe('closed');
});

test('same-page VIDEO attempts reuse device roots; Review departure closes them and Retry reacquires only devices', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await observeNativeRecorders(page); await openCameraSetup(page, 'MIDI', 'READY');
  await recordingOption(page, 'VIDEO').click(); await preparePracticeSetup(page); await expectCameraReady(page, 0);
  const counts = () => page.evaluate(() => ({
    media: (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.requests.length,
    midi: (window as unknown as { __deviceCounts: { midi: number } }).__deviceCounts.midi,
  }));
  const opened = await counts();
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  const start = page.getByRole('button', { name: '开始', exact: true }), end = page.getByRole('button', { name: '结束', exact: true });
  await start.click(); await page.clock.runFor(2100); await expect(page.getByTestId('recording-indicator')).toBeVisible();
  await end.click(); await expect(start).toBeEnabled(); await expectCameraReady(page, 0); expect(await counts()).toEqual(opened);
  await start.click(); await page.clock.runFor(4200); await page.clock.resume();
  await expect(page.getByRole('button', { name: '查看报告' })).toBeVisible(); expect(await counts()).toEqual(opened);
  await page.getByRole('button', { name: '重弹一次', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('预备拍'); expect(await counts()).toEqual(opened);
  await expect(page.getByRole('button', { name: '查看报告' })).toBeVisible();
  await page.getByRole('button', { name: '查看报告' }).click(); await page.waitForURL('**/practice/review');
  expect((await mediaState(page)).tracks.every(track => track.state === 'ended')).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.audioStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.getByRole('button', { name: '重弹一次', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: '离开临时演奏报告？' })).toBeVisible();
  await page.getByRole('button', { name: '确认离开', exact: true }).click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  expect(await preparePracticeSetup(page)).toBe('READY');
  await expect(start).toBeEnabled(); await expectCameraReady(page, 0);
  expect(await counts()).toEqual({ media: opened.media + 2, midi: opened.midi + 1 });
  expect(await page.evaluate(() => (window as unknown as { __practiceAcousticEngineFixture: { loads: number } }).__practiceAcousticEngineFixture.loads)).toBe(0);
});

async function changeInputRoot(page: Page, condition: 'mute' | 'unmute' | 'ended') {
  await page.evaluate(condition => {
    const media = (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia;
    const track = media.audioStreams.findLast(stream => stream.getAudioTracks().some(track => track.readyState === 'live'))!.getAudioTracks()[0];
    if (condition === 'ended') track.stop();
    else Object.defineProperty(track, 'muted', { configurable: true, value: condition === 'mute' });
    track.dispatchEvent(new Event(condition));
  }, condition);
}

async function deviceAndEnvironmentCounts(page: Page) {
  return page.evaluate(() => {
    const engine = (window as unknown as { __practiceAcousticEngineFixture: { loads: number; sessions: number } }).__practiceAcousticEngineFixture;
    return { media: (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.requests.length,
      midi: (window as unknown as { __deviceCounts: { midi: number } }).__deviceCounts.midi,
      engine: { loads: engine.loads, sessions: engine.sessions } };
  });
}

test('STEP microphone temporary mute preserves the target and automatically re-arms after physical recovery without Setup', async ({ page }) => {
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page, 'STEP', 'MICROPHONE', 'OFF');
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  const status = page.getByTestId('practice-status');
  await status.evaluate(element => element.setAttribute('data-surface-probe', 'retained-status'));
  const cursor = page.locator('[data-practice-playhead-cursor]'); await expect(cursor).toHaveCount(1);
  const target = await cursor.getAttribute('x'), counts = await deviceAndEnvironmentCounts(page);
  await changeInputRoot(page, 'mute');
  await expect(page.getByTestId('practice-status')).toContainText('麦克风暂时不可用，恢复后即可继续练习。');
  await expect(status).toHaveAttribute('data-surface-probe', 'retained-status');
  await expect(status.locator('[data-device-resource="inputMicrophone"]')).toHaveAttribute('data-device-health', 'INTERRUPTED');
  await expect(page).toHaveURL(new RegExp(`/practice\\?practiceRevisionId=${revisionId}$`));
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(cursor).toHaveAttribute('x', target!);
  await changeInputRoot(page, 'unmute');
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  await expect(status).toHaveAttribute('data-surface-probe', 'retained-status');
  await expect(status.locator('[data-device-resource="inputMicrophone"]')).toHaveAttribute('data-device-health', 'HEALTHY');
  await expect(cursor).toHaveAttribute('x', target!); expect(await deviceAndEnvironmentCounts(page)).toEqual(counts);
  await page.evaluate(() => {
    (window as unknown as { __practiceAcousticEngineFixture: { pitches: string[] } }).__practiceAcousticEngineFixture.pitches = ['C4'];
  });
  await expect(cursor).not.toHaveAttribute('x', target!);
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toHaveCount(0);
});

async function observeStepContexts(page: Page) {
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext, contexts: AudioContext[] = [];
    (window as unknown as { __stepContexts: AudioContext[] }).__stepContexts = contexts;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); contexts.push(this); }
      createMediaStreamDestination() {
        // Synthetic microphone roots own source-generator contexts, outside the attempt.
        const index = contexts.indexOf(this); if (index >= 0) contexts.splice(index, 1);
        return super.createMediaStreamDestination();
      }
    };
  });
}
async function stepContextStates(page: Page) {
  return page.evaluate(() => (window as unknown as { __stepContexts: AudioContext[] }).__stepContexts.map(c => c.state));
}

for (const fault of ['root', 'context'] as const) test(`STEP ${fault} failure retains position until End; current root admission controls the next Start`, async ({ page }) => {
  await observeStepContexts(page);
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page, 'STEP', 'MICROPHONE', 'OFF');
  await page.getByRole('button', { name: '开始', exact: true }).click();
  const setupNav = page.getByRole('button', { name: '返回练习设置', exact: true }); await expect(setupNav).toBeVisible();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  const cursor = page.locator('[data-practice-playhead-cursor]'); await expect(cursor).toHaveCount(1);
  const initialTarget = await cursor.getAttribute('x');
  await page.evaluate(() => { (window as unknown as { __practiceAcousticEngineFixture: { pitches: string[] } }).__practiceAcousticEngineFixture.pitches = ['C4']; });
  await expect(cursor).not.toHaveAttribute('x', initialTarget!);
  await page.evaluate(() => { (window as unknown as { __practiceAcousticEngineFixture: { pitches: string[] } }).__practiceAcousticEngineFixture.pitches = []; });
  const target = await cursor.getAttribute('x'), counts = await deviceAndEnvironmentCounts(page), contexts = await stepContextStates(page);
  if (fault === 'root') await changeInputRoot(page, 'ended');
  else await page.evaluate(async () => { await (window as unknown as { __stepContexts: AudioContext[] }).__stepContexts.findLast(c => c.state === 'running')!.suspend(); });
  const dialog = page.getByRole('alertdialog', { name: '麦克风输入已停止' }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveCount(1); await expect(cursor).toHaveAttribute('x', target!);
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect.poll(async () => (await stepContextStates(page)).every(state => state === 'closed')).toBe(true);
  await dialog.getByRole('button', { name: '结束', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const start = page.getByRole('button', { name: '开始', exact: true });
  if (fault === 'root') await expect(start).toBeDisabled();
  else await expect(start).toBeEnabled();
  const status = page.getByTestId('practice-status');
  const mic = status.locator('[data-device-resource="inputMicrophone"]');
  await expect(mic).toHaveAttribute('data-device-health', fault === 'root' ? 'LOST' : 'HEALTHY');
  if (fault === 'root') await expect(status).toContainText('麦克风已断开');
  await mic.click(); await expect(page.getByRole('dialog', { name: '麦克风', exact: true }).getByRole('button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await deviceAndEnvironmentCounts(page)).toEqual(counts); await expect(cursor).toHaveCount(0);
  if (fault === 'context') {
    await start.click(); await expect(cursor).toHaveAttribute('x', initialTarget!);
    const fresh = await deviceAndEnvironmentCounts(page);
    expect(fresh.media).toBe(counts.media); expect(fresh.engine.sessions).toBe(counts.engine.sessions + 1);
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect(start).toBeEnabled(); return;
  }
  await setupNav.click();
  await expect(page).toHaveURL(new RegExp(`/practice/setup\\?practiceRevisionId=${revisionId}$`));
  await expect(page.getByRole('button', { name: '开始练习', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '进入练习', exact: true })).toHaveCount(0);
  expect(await deviceAndEnvironmentCounts(page)).toEqual(counts); // Navigation never qualifies or binds.
  await expect(page.getByTestId('practice-setup').getByRole('alert')).toHaveCount(0);
  expect(await preparePracticeSetup(page)).toBe('READY');
  await start.click();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  await expect(cursor).toHaveAttribute('x', initialTarget!);
  const fresh = await deviceAndEnvironmentCounts(page);
  expect(fresh.media).toBe(counts.media + 1); // One new retained binding acquired by Setup.
  expect(fresh.engine.sessions).toBe(counts.engine.sessions + 1);
  expect(await stepContextStates(page)).toHaveLength(contexts.length + 2); // Probe context + attempt context.
  await page.getByRole('button', { name: '结束', exact: true }).click();
  await expect(start).toBeEnabled();
});

test('Continuous idle mute recovers on the same root; hard loss is informational until Setup Prepare', async ({ page }) => {
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');
  const start = page.getByRole('button', { name: '开始', exact: true }); await expect(start).toBeEnabled();
  await start.click(); await page.getByRole('button', { name: '结束', exact: true }).click(); await expect(start).toBeEnabled();
  const counts = await deviceAndEnvironmentCounts(page), status = page.getByTestId('practice-status');
  await changeInputRoot(page, 'mute'); await expect(status).toContainText('暂时不可用'); await expect(start).toBeDisabled();
  await changeInputRoot(page, 'unmute'); await expect(start).toBeEnabled(); expect(await deviceAndEnvironmentCounts(page)).toEqual(counts);
  await changeInputRoot(page, 'ended'); await expect(status).toContainText('已断开'); await expect(start).toBeDisabled();
  await page.getByRole('button', { name: '录制麦克风不可用', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '录制麦克风', exact: true }).getByRole('button')).toHaveCount(0); await page.keyboard.press('Escape');
  expect(await deviceAndEnvironmentCounts(page)).toEqual(counts);
  await page.getByRole('button', { name: '返回练习设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始练习', exact: true })).toBeEnabled();
  expect(await preparePracticeSetup(page)).toBe('READY'); await expect(start).toBeEnabled();
  const fresh = await deviceAndEnvironmentCounts(page);
  expect(fresh.media).toBe(counts.media + 1); expect(fresh.midi).toBe(counts.midi + 1); expect(fresh.engine).toEqual(counts.engine);
  await expect(page.locator('[data-practice-playhead-cursor]')).toHaveCount(0);
});

test('denied Setup acquisition remains retryable only through its explicit command', async ({ page }) => {
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page,scoreId,revisionId);
  await openPracticeSetup(page); await selectPracticeConfiguration(page,'CONTINUOUS','MIDI','AUDIO');
  await page.evaluate(()=>{
    const state={calls:0,allowed:false};(window as unknown as {__setupPermission:typeof state}).__setupPermission=state;
    const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{state.calls++;if(!state.allowed)throw new DOMException('private','NotAllowedError');return native(constraints);};
  });
  expect(await preparePracticeSetup(page)).toBe('BLOCKED');
  const calls=()=>page.evaluate(()=>(window as unknown as {__setupPermission:{calls:number}}).__setupPermission.calls);
  expect(await calls()).toBe(1);await expect(page.getByTestId('practice-setup').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'开始练习',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:/^(重新连接|重试|更改练习配置)$/})).toHaveCount(0);
  await page.evaluate(()=>{(window as unknown as {__setupPermission:{allowed:boolean}}).__setupPermission.allowed=true;});expect(await calls()).toBe(1);
  expect(await preparePracticeSetup(page)).toBe('READY');expect(await calls()).toBe(2);
  await expect(page.getByRole('button',{name:'录制麦克风正常',exact:true})).toHaveAttribute('data-device-health','HEALTHY');
  await expect(page.getByRole('button',{name:'开始',exact:true})).toBeEnabled();await expect(page.locator('[data-practice-playhead-cursor]')).toHaveCount(0);
});

test('existing MIDIAccess recovers naturally; denied fresh access is requalified only by Setup Prepare', async ({ page }) => {
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page, scoreId, revisionId);
  const start = page.getByRole('button', { name: '开始', exact: true });
  await expect(start).toBeEnabled(); await start.click();
  await expect(page.locator('[data-practice-playhead-cursor]')).toHaveCount(1);
  const counts = await deviceAndEnvironmentCounts(page), cursor = page.locator('[data-practice-playhead-cursor]'), x = await cursor.getAttribute('x');
  const connect = async (connected: boolean) => page.evaluate(value => (window as unknown as {__practiceMidi:{connect(value:boolean):void}}).__practiceMidi.connect(value), connected);
  await connect(false); await expect(page.getByRole('button', {name:'MIDI 键盘不可用',exact:true})).toBeVisible();
  await expect(cursor).toHaveAttribute('x', x!);
  await connect(true); await expect(page.getByRole('button', {name:'MIDI 键盘正常',exact:true})).toBeVisible();
  expect(await deviceAndEnvironmentCounts(page)).toEqual(counts); await expect(cursor).toHaveAttribute('x', x!);
  await connect(false); await page.getByRole('button', {name:'结束',exact:true}).click();
  await page.getByRole('button', {name:'MIDI 键盘不可用',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'MIDI 键盘',exact:true}).getByRole('button')).toHaveCount(0); await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as unknown as {__practiceMidi:{denied:boolean}}).__practiceMidi.denied = true; });
  await page.getByRole('button',{name:'返回练习设置',exact:true}).click();
  await expect(page.getByTestId('practice-setup').getByRole('alert')).toHaveCount(0);
  expect(await preparePracticeSetup(page)).toBe('BLOCKED');
  expect((await deviceAndEnvironmentCounts(page)).midi).toBe(counts.midi + 1);
  await connect(true); await page.evaluate(() => { (window as unknown as {__practiceMidi:{denied:boolean}}).__practiceMidi.denied = false; });
  expect(await preparePracticeSetup(page)).toBe('READY');
  await expect(cursor).toHaveCount(0);
  await expect(start).toBeEnabled(); await start.click();
  await expect(cursor).toHaveCount(1); await expect(cursor).toHaveAttribute('x', x!);
  expect((await deviceAndEnvironmentCounts(page)).midi).toBe(counts.midi + 2);
});

for(const choice of ['End','navigation'] as const)test(`STEP terminal analysis intervention retains position until ${choice}, without auto-start`,async({page})=>{
  await setupContinuousPracticeMocks(page);await openPreparedPractice(page,scoreId,revisionId);
  await configurePractice(page,'STEP','MICROPHONE','OFF');
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  const cursor=page.locator('[data-practice-playhead-cursor]');await expect(cursor).toHaveCount(1);
  const x=await cursor.getAttribute('x'),before=await deviceAndEnvironmentCounts(page);
  await page.evaluate(()=>(window as unknown as {__practiceAcousticEngineFixture:{fail():void}}).__practiceAcousticEngineFixture.fail());
  const dialog=page.getByRole('alertdialog',{name:'音符分析已停止'});await expect(dialog).toBeVisible();
  await expect(page.getByTestId('practice-status').locator('[data-device-resource="inputMicrophone"]')).toHaveAttribute('data-device-health', 'HEALTHY');
  await expect(dialog.getByRole('button')).toHaveCount(1);await expect(cursor).toHaveAttribute('x',x!);
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  expect((await deviceAndEnvironmentCounts(page)).engine.sessions).toBe(before.engine.sessions);
  await expect(page.getByRole('button',{name:'查看报告',exact:true})).toHaveCount(0);
  if(choice==='End'){
    await dialog.getByRole('button',{name:'结束',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/practice\\?practiceRevisionId=${revisionId}$`));
    await expect(page.getByRole('button', { name: '返回练习设置', exact: true })).toBeVisible();
  }else{
    // Trigger actual client navigation, as a proxy for leaving through browser navigation while the dialog blocks pointer interaction.
    await page.getByRole('button',{name:'返回练习设置',includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());
    await expect(page).toHaveURL(/\/practice\/setup\?/);await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as {__practiceMedia:MediaMock}).__practiceMedia.audioStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  }
  expect((await deviceAndEnvironmentCounts(page)).engine.sessions).toBe(before.engine.sessions);
});

test('microphone Setup acquires one fresh retained binding through both navigation entries without reloading its warm engine', async ({page}) => {
  await setupContinuousPracticeMocks(page); await openPreparedPractice(page,scoreId,revisionId);
  await configurePractice(page,'CONTINUOUS','MICROPHONE','OFF');
  for(const entry of ['top','settings'] as const) {
    const before=await deviceAndEnvironmentCounts(page);
    await expect(page.getByRole('button',{name:'开始',exact:true})).toBeEnabled();
    if(entry==='top') await page.getByRole('button',{name:'返回练习设置',exact:true}).click();
    else await openPracticeSetup(page);
    await expect(page).toHaveURL(new RegExp(`/practice/setup\\?practiceRevisionId=${revisionId}$`));
    const setup=page.getByTestId('practice-setup');
    await expect(setup.getByRole('button',{name:'开始练习',exact:true})).toBeEnabled();
    await expect(setup.getByRole('button',{name:'进入练习',exact:true})).toHaveCount(0);
    await expect(setup.getByRole('alert')).toHaveCount(0);
    expect(await deviceAndEnvironmentCounts(page)).toEqual(before);
    expect(await preparePracticeSetup(page)).toBe('READY');
    const after=await deviceAndEnvironmentCounts(page);
    expect(after.media).toBe(before.media+1); // One live microphone for the explicit preparation command.
    expect(after.engine).toEqual(before.engine); // No new model load or inference session during qualification.
    await expect(page.getByRole('button',{name:'开始',exact:true})).toBeEnabled();
    await expect(page.locator('[data-practice-playhead-cursor]')).toHaveCount(0);
  }
});

test('Setup Start Practice waits for the previous microphone attempt retirement without failing or reloading', async ({page}) => {
  await setupContinuousPracticeMocks(page);
  let modelAccesses=0;
  page.on('request',request=>{if(request.url().includes('/model-assets/practice-acoustic-robust-browser-v1/access'))modelAccesses++;});
  await openPreparedPractice(page,scoreId,revisionId); await configurePractice(page,'STEP','MICROPHONE','OFF');
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  const before=await deviceAndEnvironmentCounts(page), accesses=modelAccesses;
  await page.evaluate(()=>{(window as unknown as {__practiceAcousticEngineFixture:{holdRetirement:boolean}}).__practiceAcousticEngineFixture.holdRetirement=true;});
  await page.getByRole('button',{name:'返回练习设置',exact:true}).click();
  const setup=page.getByTestId('practice-setup'), prepare=setup.getByRole('button',{name:'开始练习',exact:true});
  await prepare.click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__practiceAcousticEngineFixture:{pendingRetirements:number}}).__practiceAcousticEngineFixture.pendingRetirements)).toBe(1);
  await expect.poll(async()=>(await deviceAndEnvironmentCounts(page)).media).toBe(before.media+1);
  await expect(prepare).toBeDisabled(); await expect(prepare).toHaveAttribute('aria-busy','true');
  await expect(setup.getByRole('alert')).toHaveCount(0); await expect(setup.getByText('ACOUSTIC_ENGINE_NOT_IDLE',{exact:true})).toHaveCount(0);
  expect((await deviceAndEnvironmentCounts(page)).engine).toEqual(before.engine); expect(modelAccesses).toBe(accesses);
  await page.evaluate(()=>(window as unknown as {__practiceAcousticEngineFixture:{releaseRetirement():void}}).__practiceAcousticEngineFixture.releaseRetirement());
  await expect(page).toHaveURL(new RegExp(`/practice\\?practiceRevisionId=${revisionId}$`));
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  const after=await deviceAndEnvironmentCounts(page);
  expect(after.media).toBe(before.media+1); expect(after.engine.loads).toBe(before.engine.loads);
  expect(after.engine.sessions).toBe(before.engine.sessions+1); expect(modelAccesses).toBe(accesses);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

for (const mismatch of ['SCOPE', 'TEMPO'] as const) {
  test(`Review save rejects server ${mismatch} mismatch before media upload`, async ({ page }, testInfo) => {
    const protocol = await setupContinuousPracticeMocks(page, { reservationMismatch: mismatch });
    await openPreparedPractice(page, scoreId, revisionId);
    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看报告', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看报告', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存录制', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存录制', exact: true }).click();
    await expect(page.getByText('保存失败', { exact: true })).toBeVisible();
    expect(protocol.events).toEqual(['RESERVATION', 'CANCEL']);
    await expect(page.getByRole('button', { name: '已保存', exact: true })).toHaveCount(0);
    await testInfo.attach('save-protocol', { body: JSON.stringify(protocol, null, 2), contentType: 'application/json' });
  });
}

test('Review saves RANGE and CUSTOM selection with server planning agreement', async ({ page }, testInfo) => {
  const protocol = await setupContinuousPracticeMocks(page);
  await openPreparedPractice(page, scoreId, revisionId);
  await configurePractice(page, 'CONTINUOUS', 'MIDI', 'AUDIO');
  await page.getByRole('button', { name: '分段', exact: true }).click();
  for (const note of ['note-d4', 'note-e4']) await page.locator(`[data-id="${note}"]`).first().locator('path, use').first().click();
  await page.getByRole('button', { name: '速度' }).click();
  await page.getByRole('button', { name: '+5 BPM', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存录制', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存录制', exact: true }).click();
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible();
  expect(protocol.events).toEqual(['RESERVATION', 'MEDIA_PUT', 'FINALIZE']);
  expect(protocol.request?.scope).toEqual({ kind: 'RANGE', start_group_id: 'group-1', end_group_id: 'group-2' });
  expect(protocol.request?.tempo_selection).toEqual({ mode: 'CUSTOM_FIXED_BPM', bpm: 125 });
  await testInfo.attach('save-protocol', { body: JSON.stringify(protocol, null, 2), contentType: 'application/json' });
});


test('Setup microphone admission retains the exact stream across Start, End and natural Retry',async({page},testInfo)=>{
  const sourceRequests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/practice/')&&request.url().includes('/source'))sourceRequests.push(new URL(request.url()).pathname);});
  await setupContinuousPracticeMocks(page);
  await page.goto(`/zh/score/${scoreId}/practice/setup?practiceRevisionId=${revisionId}`);
  await selectPracticeConfiguration(page,'STEP','MICROPHONE','OFF');
  expect((await mediaState(page)).requests).toHaveLength(0);expect(sourceRequests).toEqual([]);
  expect(await preparePracticeSetup(page)).toBe('READY');
  const witness=()=>page.evaluate(()=>{const m=(window as unknown as {__practiceMedia:MediaMock}).__practiceMedia;return {acquisitions:m.requests.length,captures:m.captureRoots.length,same:m.captureRoots.every(s=>s===m.audioStreams[0]),live:m.audioStreams[0].getTracks().every(t=>t.readyState==='live')};});
  expect(await witness()).toMatchObject({acquisitions:1,captures:1,same:true,live:true});
  await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  await page.getByRole('button',{name:'结束',exact:true}).click();await expect(page.getByRole('button',{name:'开始',exact:true})).toBeEnabled();
  expect(await witness()).toMatchObject({acquisitions:1,captures:2,same:true,live:true});
  await page.getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'跳过',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'重弹一次',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('弹奏当前高亮音');
  expect(await witness()).toMatchObject({acquisitions:1,captures:4,same:true,live:true});
  expect(sourceRequests).toEqual([`/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/source`]);
  await testInfo.attach('same-microphone-source',{body:JSON.stringify({resources:await witness(),sourceRequests}),contentType:'application/json'});
});

test('one MIDI access supplies Setup validation and the exact Practice input object',async({page},testInfo)=>{
  await setupContinuousPracticeMocks(page);await openPreparedPractice(page,scoreId,revisionId);
  expect((await deviceAndEnvironmentCounts(page)).midi).toBe(1);
  await page.getByRole('button',{name:'开始',exact:true}).click();const cursor=page.locator('[data-practice-playhead-cursor]');await expect(cursor).toHaveCount(1);const x=await cursor.getAttribute('x');
  await page.evaluate(()=>(window as unknown as {__emitMidiNote(note:number,velocity:number):void}).__emitMidiNote(60,100));await expect(cursor).not.toHaveAttribute('x',x!);
  await page.getByRole('button',{name:'结束',exact:true}).click();await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(cursor).toHaveAttribute('x',x!);expect((await deviceAndEnvironmentCounts(page)).midi).toBe(1);
  await testInfo.attach('one-midi-access',{body:JSON.stringify(await deviceAndEnvironmentCounts(page)),contentType:'application/json'});
});

test('acoustic smoke failure rolls back the same acquired microphone before navigation',async({page})=>{
  await setupContinuousPracticeMocks(page);await page.goto(`/zh/score/${scoreId}/practice/setup?practiceRevisionId=${revisionId}`);
  await selectPracticeConfiguration(page,'STEP','MICROPHONE','OFF');
  await page.evaluate(()=>(window as unknown as {__practiceAcousticEngineFixture:{failNextInference:boolean}}).__practiceAcousticEngineFixture.failNextInference=true);
  expect(await preparePracticeSetup(page)).toBe('BLOCKED');
  expect((await mediaState(page)).requests).toHaveLength(1);
  expect(await page.evaluate(()=>{const m=(window as unknown as {__practiceMedia:MediaMock}).__practiceMedia;return m.captureRoots.length===1&&m.captureRoots[0]===m.audioStreams[0]&&m.audioStreams[0].getTracks().every(t=>t.readyState==='ended');})).toBe(true);
  await expect(page).toHaveURL(/\/practice\/setup\?/);await expect(page.getByRole('button',{name:'开始',exact:true})).toHaveCount(0);
});

test('one complete Setup admission survives Score deletion through Practice, Review and local export; reload expires it', async ({ page }, testInfo) => {
  await setupContinuousPracticeMocks(page, { camera: 'READY' });
  const sourceRequests: string[] = [], scoreRequests: string[] = [];
  page.on('request', request => {
    const url=new URL(request.url());
    if(url.pathname.startsWith('/api/v1/practice/') && url.pathname.includes('/source')) sourceRequests.push(request.url());
    if(url.pathname===`/api/v1/scores/${scoreId}`)scoreRequests.push(request.url());
  });
  await page.goto(`/zh/score/${scoreId}/practice/setup?practiceRevisionId=${revisionId}`);
  await selectPracticeConfiguration(page,'CONTINUOUS','MIDI','VIDEO');
  expect(sourceRequests).toEqual([]);
  expect(await preparePracticeSetup(page)).toBe('READY');
  expect(sourceRequests).toHaveLength(1);
  const admitted=new URL(sourceRequests[0]);
  expect(admitted.pathname).toBe(`/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/source`);
  expect(admitted.searchParams.get('include_notation')).toBe('true');
  const admittedScoreReads=scoreRequests.length;
  // Any new authorization/read fails: the current browser flow already owns its input.
  await page.route('**/api/v1/practice/**', route=>route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({success:false,public_code:'not_found'})}));
  await page.route(`**/api/v1/scores/${scoreId}`, route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({success:false,public_code:'not_found'})}));
  await expect(page.getByRole('button',{name:'开始',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'开始',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看报告',exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'查看报告',exact:true}).click();
  await expect(page.getByRole('heading',{name:'临时演奏报告'})).toBeVisible();
  await expect(page.locator('[data-practice-review-page] svg[overflow="visible"]')).toBeVisible();
  await expect(page.locator('.practice-summary-note-unsupported')).toHaveCount(3);
  await page.getByRole('button',{name:'回放',exact:true}).click();
  await expect.poll(()=>page.locator('video').first().evaluate(video=>(video as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  const exportWrites: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT'].includes(request.method())) exportWrites.push(request.url());
  });
  await page.getByTestId('open-video-export-studio').click();
  await expect(page.getByTestId('generate-video-export')).toBeEnabled();
  const download=page.waitForEvent('download');
  await page.getByTestId('generate-video-export').click();
  const exported=await download;
  expect(await exported.failure()).toBeNull();
  await expect(page.getByTestId('video-export-success')).toBeVisible();
  expect(exportWrites).toEqual([]);
  await expect(page.locator('.practice-summary-note-unsupported')).toHaveCount(3);
  expect(sourceRequests).toHaveLength(1);expect(scoreRequests).toHaveLength(admittedScoreReads);
  await testInfo.attach('admitted-source-flow',{body:JSON.stringify({sourceRequests,scoreRequests,exported:exported.suggestedFilename()}),contentType:'application/json'});
  await page.reload();
  await expect(page.getByText('本次临时报告已失效', { exact: true })).toBeVisible();
  expect(sourceRequests).toHaveLength(1);expect(scoreRequests).toHaveLength(admittedScoreReads);
});

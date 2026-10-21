import { expect, test, type Page } from '@playwright/test';
import {
  mockAuthenticatedSession,
  mockRealtimeEvents,
} from './support/api-mocks';

const scoreId = 'continuous-review-score';
const revisionId = 'continuous-review-revision';

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

const testArtifact = {
  schemaVersion: 1,
  artifactId: 'practice-score-artifact:continuous-test',
  scoreId,
  revisionId,
  firstPlayableBeat: 0.0,
  scoreEndBeat: 4.0,
  playableEvents: [],
  scoreTempoSegments: [
    { startBeat: 0.0, bpm: 120.0 },
  ],
  meterSegments: [
    {
      startBeat: 0.0,
      numerator: 4,
      denominator: 4,
      measureDurationBeats: 4.0,
      countInPulses: 4,
      source: 'MUSICXML',
    },
  ],
  expectedPracticeGroups: [
    {
      groupId: 'group-0',
      onsetBeat: 0.0,
      canonicalEndBeat: 1.0,
      pitches: ['C4'],
      renderNoteIds: ['note-c4'],
      measureNumbers: ['1'],
      eventIds: ['e-0'],
      expectedNotes: [{ expectedNoteId: 'note-0', eventId: 'e-0', pitch: 'C4', midiPitch: 60, measureNumbers: ['1'], renderNoteIds: ['note-c4'] }],
      strikeTargets: [{ strikeId: 'strike-0', pitch: 'C4', eventIds: ['e-0'], expectedNotes: [{ expectedNoteId: 'note-0', eventId: 'e-0', pitch: 'C4', midiPitch: 60, measureNumbers: ['1'], renderNoteIds: ['note-c4'] }], measureNumbers: ['1'], renderNoteIds: ['note-c4'] }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
    {
      groupId: 'group-1',
      onsetBeat: 1.0,
      canonicalEndBeat: 2.0,
      pitches: ['D4'],
      renderNoteIds: ['note-d4'],
      measureNumbers: ['1'],
      eventIds: ['e-1'],
      expectedNotes: [{ expectedNoteId: 'note-1', eventId: 'e-1', pitch: 'D4', midiPitch: 62, measureNumbers: ['1'], renderNoteIds: ['note-d4'] }],
      strikeTargets: [{ strikeId: 'strike-1', pitch: 'D4', eventIds: ['e-1'], expectedNotes: [{ expectedNoteId: 'note-1', eventId: 'e-1', pitch: 'D4', midiPitch: 62, measureNumbers: ['1'], renderNoteIds: ['note-d4'] }], measureNumbers: ['1'], renderNoteIds: ['note-d4'] }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
    {
      groupId: 'group-2',
      onsetBeat: 2.0,
      canonicalEndBeat: 3.0,
      pitches: ['E4'],
      renderNoteIds: ['note-e4'],
      measureNumbers: ['1'],
      eventIds: ['e-2'],
      expectedNotes: [{ expectedNoteId: 'note-2', eventId: 'e-2', pitch: 'E4', midiPitch: 64, measureNumbers: ['1'], renderNoteIds: ['note-e4'] }],
      strikeTargets: [{ strikeId: 'strike-2', pitch: 'E4', eventIds: ['e-2'], expectedNotes: [{ expectedNoteId: 'note-2', eventId: 'e-2', pitch: 'E4', midiPitch: 64, measureNumbers: ['1'], renderNoteIds: ['note-e4'] }], measureNumbers: ['1'], renderNoteIds: ['note-e4'] }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
  ],
  practiceAttackSteps: [
    {
      stepId: 'step-0',
      expectedGroupIndex: 0,
      onsetBeat: 0.0,
      attackTargets: [{ attackId: 'attack-0', pitch: 'C4', eventIds: ['e-0'], notes: [{ expectedNoteId: 'note-0', eventId: 'e-0', pitch: 'C4', midiPitch: 60, measureNumbers: ['1'], renderNoteIds: ['note-c4'] }], measureNumbers: ['1'], renderNoteIds: ['note-c4'] }],
      continuation: [],
    },
    {
      stepId: 'step-1',
      expectedGroupIndex: 1,
      onsetBeat: 1.0,
      attackTargets: [{ attackId: 'attack-1', pitch: 'D4', eventIds: ['e-1'], notes: [{ expectedNoteId: 'note-1', eventId: 'e-1', pitch: 'D4', midiPitch: 62, measureNumbers: ['1'], renderNoteIds: ['note-d4'] }], measureNumbers: ['1'], renderNoteIds: ['note-d4'] }],
      continuation: [],
    },
    {
      stepId: 'step-2',
      expectedGroupIndex: 2,
      onsetBeat: 2.0,
      attackTargets: [{ attackId: 'attack-2', pitch: 'E4', eventIds: ['e-2'], notes: [{ expectedNoteId: 'note-2', eventId: 'e-2', pitch: 'E4', midiPitch: 64, measureNumbers: ['1'], renderNoteIds: ['note-e4'] }], measureNumbers: ['1'], renderNoteIds: ['note-e4'] }],
      continuation: [],
    },
  ],
};

function apiResponse(data: unknown) {
  return JSON.stringify({ success: true, data });
}

type MockOptions = {
  denyMicrophone?: boolean;
  camera?: 'READY' | 'DENIED' | 'NO_VIDEO' | 'NO_AUDIO' | 'PENDING';
};

type MediaMock = {
  requests: MediaStreamConstraints[];
  tracks: Array<{ track: MediaStreamTrack; stopCalls: number }>;
  resolveCamera: (() => void) | null;
};

async function setupContinuousPracticeMocks(page: Page, options: MockOptions = {}) {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);

  await page.addInitScript(({ denyMic, camera }) => {
    // Mock Web MIDI
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

    (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess = async () => ({
      inputs: inputsMap,
      outputs: new Map(),
      onstatechange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

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
    const media: MediaMock = { requests: [], tracks: [], resolveCamera: null };
    (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia = media;
    const audioOnly = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
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
      return new MediaStream(tracks);
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      media.requests.push(structuredClone(constraints ?? {}));
      if (!camera || !constraints?.video) return audioOnly(constraints);
      if (camera === 'DENIED') throw new DOMException('Camera permission denied', 'NotAllowedError');
      if (camera === 'PENDING') {
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

  // Mock Practice Content
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        content: sampleMusicXml,
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
  const takesDatabase: Array<{
    take_id: string;
    score_id: number;
    revision_id: number | null;
    artifact_id: string | null;
    media_kind: string;
    media_mime_type: string;
    media_byte_size: number;
    duration_ms: number;
    scope_start_beat: number;
    scope_terminal_beat: number;
    created_at: string;
  }> = [];

  await page.route('**/api/v1/performance-takes/upload-authorizations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        take_id: 'take-e2e-1',
        upload_url: '/api/v1/performance-takes/mock-upload/take-e2e-1',
        upload_method: 'PUT',
        upload_headers: { 'content-type': 'audio/webm' },
        object_key: 'performance-takes/1/take-e2e-1/recording.webm',
        reservation_id: 'res-e2e-1',
        expires_in: 3600,
      }),
    })
  );

  await page.route('**/api/v1/performance-takes/mock-upload/*', (route) =>
    route.fulfill({ status: 200 })
  );

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
      if (route.request().method() === 'POST') {
        const postData = route.request().postDataJSON();
        const newTake = {
          take_id: 'take-e2e-1',
          score_id: postData.score_id,
          score_title: 'Continuous Review Score',
          revision_id: postData.revision_id ?? null,
          artifact_id: postData.artifact_id ?? null,
          media_kind: 'AUDIO',
          media_mime_type: 'audio/webm',
          media_byte_size: 1024,
          duration_ms: 3000,
          scope_start_beat: 0,
          scope_terminal_beat: 0,
          created_at: '2026-09-20T12:00:00Z',
        };
        takesDatabase.push(newTake);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: apiResponse(newTake),
        });
      }
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

  // Mock PracticeScoreArtifact
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/artifact`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(testArtifact),
    })
  );
}

function recordingOption(page: Page, mode: 'OFF' | 'AUDIO' | 'VIDEO') {
  return page.getByRole('button', { name: { OFF: /^不录制/, AUDIO: /^录制音频/, VIDEO: /^录制视频/ }[mode] });
}

async function mediaState(page: Page) {
  return page.evaluate(() => {
    const media = (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia;
    return { requests: media.requests, pending: media.resolveCamera !== null,
      tracks: media.tracks.map(({ track, stopCalls }) => ({ kind: track.kind, state: track.readyState, stopCalls })) };
  });
}

async function openCameraSettings(page: Page, input: 'MIDI' | 'MICROPHONE', camera: MockOptions['camera']) {
  await setupContinuousPracticeMocks(page, { camera });
  await page.goto(`/zh/score/${scoreId}/practice`);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /连贯演奏/ }).click();
  await page.getByRole('button', { name: input === 'MIDI' ? /MIDI/ : /^麦克风/ }).click();
  await expect(recordingOption(page, 'OFF')).toHaveAttribute('aria-pressed', 'true');
}

async function expectCameraReady(page: Page, audioTracks: number) {
  await expect(recordingOption(page, 'VIDEO')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('画面已就绪，开始后会录制视频和真实声音')).toBeVisible();
  for (const mode of ['OFF', 'AUDIO', 'VIDEO'] as const) await expect(recordingOption(page, mode)).toBeEnabled();
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

async function expectRecordingOff(page: Page) {
  await expect(recordingOption(page, 'OFF')).toHaveAttribute('aria-pressed', 'true');
  await expect(recordingOption(page, 'VIDEO')).toHaveAttribute('aria-pressed', 'false');
  await expect(recordingOption(page, 'VIDEO')).toBeEnabled();
  await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
}

test.describe('Continuous VIDEO camera preparation', () => {
  test('MIDI requests camera video and real audio, then installs a live ready preview', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'READY');
    expect((await mediaState(page)).requests).toEqual([]);
    await recordingOption(page, 'VIDEO').click();
    await expectCameraReady(page, 1);
    expect((await mediaState(page)).requests).toEqual([{ video: { facingMode: 'user' },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }]);
  });

  test('MICROPHONE requests camera video only and accepts a live video-only preview', async ({ page }) => {
    await openCameraSettings(page, 'MICROPHONE', 'READY');
    await recordingOption(page, 'VIDEO').click();
    await expectCameraReady(page, 0);
    expect((await mediaState(page)).requests).toEqual([{ video: { facingMode: 'user' }, audio: false }]);
  });

  test('camera permission denial leaves recording OFF and releases the preparation lock', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'DENIED');
    await recordingOption(page, 'VIDEO').click();
    await expect(page.getByText('请允许摄像头访问后再开启')).toBeVisible();
    await expectRecordingOff(page);
    expect((await mediaState(page)).tracks).toEqual([]);
  });

  test('a stream without usable video is rejected and every acquired track is stopped', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'NO_VIDEO');
    await recordingOption(page, 'VIDEO').click();
    await expect(page.getByText('未取得可用摄像头画面')).toBeVisible();
    await expectRecordingOff(page);
    await expectCameraStopped(page, 1);
    expect((await mediaState(page)).tracks[0].kind).toBe('audio');
  });

  test('MIDI video without real audio is rejected and its video track is stopped', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'NO_AUDIO');
    await recordingOption(page, 'VIDEO').click();
    await expect(page.getByText('视频录制需要真实音频输入')).toBeVisible();
    await expectRecordingOff(page);
    await expectCameraStopped(page, 1);
    expect((await mediaState(page)).tracks[0].kind).toBe('video');
  });

  for (const change of ['input', 'mode'] as const) {
    test(`${change} change releases a prepared preview and clears recording selection and status`, async ({ page }) => {
      await openCameraSettings(page, 'MIDI', 'READY');
      await recordingOption(page, 'VIDEO').click();
      await expectCameraReady(page, 1);
      await page.getByRole('button', { name: change === 'input' ? /^麦克风/ : /逐音练习/ }).click();
      await expectCameraStopped(page, 2);
      if (change === 'mode') await page.getByRole('button', { name: /连贯演奏/ }).click();
      await expectRecordingOff(page);
      await expect(recordingOption(page, 'VIDEO')).toContainText('可选摄像头录制，报告页本地回放');
    });
  }

  test('a pending acquisition cannot restore VIDEO, preview or ready status after input invalidation', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'PENDING');
    await recordingOption(page, 'VIDEO').click();
    await expect.poll(async () => (await mediaState(page)).pending).toBe(true);
    await expect(page.getByText('正在请求摄像头权限...')).toBeVisible();
    for (const mode of ['OFF', 'AUDIO', 'VIDEO'] as const) await expect(recordingOption(page, mode)).toBeDisabled();
    const microphone = page.getByRole('button', { name: /^麦克风/ });
    await expect(microphone).toBeEnabled();
    await microphone.click();
    await expectRecordingOff(page);
    await expect(recordingOption(page, 'VIDEO')).toContainText('可选摄像头录制，报告页本地回放');
    await page.evaluate(() => (window as unknown as { __practiceMedia: MediaMock }).__practiceMedia.resolveCamera!());
    await expectCameraStopped(page, 2);
    await expectRecordingOff(page);
    await expect(page.getByText('画面已就绪，开始后会录制视频和真实声音')).toHaveCount(0);
    await expect(recordingOption(page, 'VIDEO')).toContainText('可选摄像头录制，报告页本地回放');
  });

  test('client navigation unmounts Practice and stops the owned preview tracks', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'READY');
    // Compile the destination before testing client unmount, keeping route startup out of this boundary.
    expect((await page.request.get('/zh/library')).ok()).toBe(true);
    await recordingOption(page, 'VIDEO').click();
    await expectCameraReady(page, 1);
    await page.getByRole('button', { name: /close/i }).click();
    await page.getByRole('link', { name: 'NoteVerse Pro' }).click();
    await expect(page).toHaveURL(/\/zh\/library/);
    await expectCameraStopped(page, 2);
    await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
  });

  test('completion releases the owned VIDEO preview tracks', async ({ page }) => {
    await openCameraSettings(page, 'MIDI', 'READY');
    await recordingOption(page, 'VIDEO').click();
    await expectCameraReady(page, 1);
    await page.getByRole('button', { name: /close/i }).click();
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看报告' })).toBeVisible();
    await expect(page.locator('video[aria-label="摄像头预览"]')).toHaveCount(0);
    await expectCameraStopped(page, 2);
  });
});

test.describe('Continuous Performance Review & Audio Capture E2E', () => {
  test('STEP_BY_STEP: Completion dialog shows ONLY retry/range adjustment, NO report button', async ({
    page,
  }) => {
    await setupContinuousPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Switch input to MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice (default is STEP_BY_STEP)
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Finish practice
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    // Verify dialog opened
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();

    // Assert "重弹一次" and "分段练习" (or "调整分段") exist
    await expect(page.getByRole('button', { name: /重弹一次|再弹一次/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /分段练习|调整分段/i })).toBeVisible();

    // Assert "查看报告" DOES NOT exist
    await expect(page.getByRole('button', { name: '查看报告' })).not.toBeVisible();
  });

  test('CONTINUOUS_PLAY + MIDI: Complete performance, navigate to review, factual cards rendered', async ({
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
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Open settings -> select CONTINUOUS_PLAY and MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();

    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Freeze before starting: wall-clock/CI latency must not consume this 2-second scope.
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Advance exactly the four count-in beats at 120 BPM, leaving performance time at 0.
    await expect(page.getByRole('status')).toContainText('预备拍');
    await page.clock.runFor(2000);
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Emit notes
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100);
    });

    // Manually stop at the first target, before the targets at 500ms and 1000ms.
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();
    await page.clock.resume();

    // Assert completion dialog opened with "查看报告"
    await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();
    const viewReportButton = page.getByRole('button', { name: '查看报告' });
    await expect(viewReportButton).toBeVisible();
    await viewReportButton.click();

    // Navigates to /review
    await page.waitForURL(`**/score/${scoreId}/practice/review`);
    await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();

    // Verify factual cards
    await expect(page.getByText('演奏时长')).toBeVisible();
    await expect(page.getByText('演奏速度')).toBeVisible();
    await expect(page.getByText('练习范围')).toBeVisible();
    await expect(page.getByText('输入方式')).toBeVisible();
    for (const [label, value] of [
      ['目标音', '3'],
      ['正确击键', '1'],
      ['漏弹', '0'],
      ['额外演奏', '0'],
      ['未完成', '2'],
    ]) {
      const title = page.getByText(label, { exact: true });
      await expect(title).toBeVisible();
      const card = title.locator('..').locator('..');
      await expect(card.getByText(value, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('本次演奏未录制')).toBeVisible();

    // Zero backend session or take requests
    expect(disallowedRequests).toEqual([]);
  });

  test('CONTINUOUS_PLAY: Pause, resume, and complete session with synchronized audio review', async ({
    page,
  }) => {
    await setupContinuousPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Open settings -> select CONTINUOUS_PLAY and MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();

    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const audioRecordingOption = page.getByRole('button', { name: /录制音频/i });
    await expect(audioRecordingOption).toBeEnabled();
    await audioRecordingOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait until running
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Pause practice
    const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();

    // Verify paused state
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible();

    // Resume practice
    const resumeButton = page.getByRole('button', { name: '继续', exact: true });
    await resumeButton.click();
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Finish practice
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

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

  test('CONTINUOUS_PLAY + MIDI with Mic Denied: Graceful degradation, shows unavailable notice', async ({
    page,
  }) => {
    await setupContinuousPracticeMocks(page, { denyMicrophone: true });
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Switch to continuous mode and MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();

    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const audioRecordingOption = page.getByRole('button', { name: /录制音频/i });
    await expect(audioRecordingOption).toBeEnabled();
    await audioRecordingOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait until running
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Finish practice
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    // Click "查看报告"
    const viewReportButton = page.getByRole('button', { name: '查看报告' });
    await expect(viewReportButton).toBeVisible();
    await viewReportButton.click();

    // Navigates to /review
    await page.waitForURL(`**/score/${scoreId}/practice/review`);
    await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();

    // Verify audio recording unavailable notice
    await expect(page.getByText('本次录音不可用')).toBeVisible();
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

    // Click back to practice
    await backButton.click();
    await page.waitForURL(`**/score/${scoreId}/practice`);

    // Assert 0 session or take requests
    expect(disallowedRequests).toEqual([]);
  });

  test('CONTINUOUS_PLAY + Audio: Save performance, direct upload, view in My Performances, and delete', async ({
    page,
  }) => {
    await setupContinuousPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Switch to continuous mode
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();

    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const audioRecordingOption = page.getByRole('button', { name: /录制音频/i });
    await expect(audioRecordingOption).toBeEnabled();
    await audioRecordingOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait until running
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Finish practice
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    // Click "查看报告"
    const viewReportButton = page.getByRole('button', { name: '查看报告' });
    await expect(viewReportButton).toBeVisible();
    await viewReportButton.click();

    // Navigates to /review
    await page.waitForURL(`**/score/${scoreId}/practice/review`);
    await expect(page.getByRole('heading', { name: '临时演奏报告' })).toBeVisible();

    // Verify "保存演奏" button is visible and enabled
    const saveButton = page.getByRole('button', { name: '保存演奏' });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Click "保存演奏"
    await saveButton.click();

    // Verify button changes to "已保存"
    await expect(page.getByRole('button', { name: '已保存' })).toBeVisible({ timeout: 10_000 });

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

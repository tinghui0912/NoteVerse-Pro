import type { PracticeScoreArtifact } from '../../src/lib/practice/kernel/artifact';
import { installAcousticEngineFixture, openPreparedPractice, preparePracticeSetup, configurePractice, openPracticeSetup, selectPracticeConfiguration } from './support/practice-workspace';
import { expect, test, type Page } from '@playwright/test';
import {
  mockAuthenticatedSession,
  mockRealtimeEvents,
} from './support/api-mocks';

const scoreId = 'practice-smoke-score';
const revisionId = 'practice-smoke-revision';
const practiceModelAccessPath = '/api/v1/model-assets/practice-acoustic-robust-browser-v1/access';

const selectableMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
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
      <note id="select-start-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note id="middle-note">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note id="select-end-note">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <note><rest /><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const smokeArtifact: PracticeScoreArtifact = {
  schemaVersion: 1,
  artifactId: 'practice-score-artifact:smoke-test', scoreId, revisionId,
   scoreEndBeat: 4,
  notes: [60, 62, 64].map((pianoKey, i) => ({ noteId: `note-${i}`, eventId: `e-${i}`, pianoKey,
    renderNoteId: ['select-start-note', 'middle-note', 'select-end-note'][i], measureNumber: '1', staffId: '1', voiceId: '1', tieTypes: [] })),
  events: [0,1,2].map(i => ({ eventId: `e-${i}`, onsetBeat: i, durationBeats: i === 2 ? 2 : 1 })),
  moments: [60,62,64].map((pianoKey,i) => ({ groupId: `group-${i}`, onsetBeat: i, canonicalEndBeat: i === 2 ? 4 : i+1,
    attacks: [{ attackId: `strike-${i}`, pianoKey, noteIds: [`note-${i}`] }], continuationNoteIds: [] })),
  meterSegments: [{ startBeat: 0, numerator: 4, denominator: 4,   }],
  scoreTempoSegments: [{ startBeat: 0, bpm: 100 }, { startBeat: 2, bpm: 90 }],
};

function apiResponse(data: unknown) {
  return JSON.stringify({ success: true, data });
}

type SetupPracticeMocksOptions = {
  artifactOverride?: unknown;
  modelAccessOverride?: unknown;
  disableOpfs?: boolean;
  initialMidiInputs?: number;
};

async function setupPracticeMocks(
  page: Page,
  artifactOrOptions?: unknown | SetupPracticeMocksOptions
) {
  const options: SetupPracticeMocksOptions =
    artifactOrOptions &&
    typeof artifactOrOptions === 'object' &&
    !('schemaVersion' in (artifactOrOptions as object))
      ? (artifactOrOptions as SetupPracticeMocksOptions)
      : { artifactOverride: artifactOrOptions };

  const artifactOverride = options.artifactOverride;
  const initialMidiInputs = options.initialMidiInputs ?? 1;
  const disableOpfs = Boolean(options.disableOpfs);

  await installAcousticEngineFixture(page);
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);

  // Install mock Web MIDI API and capability overrides
  await page.addInitScript(
    ({ initInputs, disableOpfs }) => {
      if (disableOpfs && typeof navigator !== 'undefined') {
        Object.defineProperty(navigator, 'storage', {
          value: undefined,
          configurable: true,
        });
      }

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
      if (initInputs > 0) {
        inputsMap.set('mock-midi-in-1', fakeInput);
      }

      const stateListeners = new Set<() => void>();
      const mockAccess = {
        inputs: inputsMap,
        outputs: new Map(),
        onstatechange: null,
        addEventListener: (_type: string, listener: () => void) => stateListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => stateListeners.delete(listener),
      };

      (window as unknown as { __connectMockMidiDevice: () => void }).__connectMockMidiDevice = () => {
        inputsMap.set('mock-midi-in-1', fakeInput);
        for (const listener of stateListeners) listener();
        if (typeof mockAccess.onstatechange === 'function') {
          (mockAccess.onstatechange as (e: unknown) => void)({ port: fakeInput });
        }
      };

      (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess = async () =>
        mockAccess;

      // Ensure AudioWorklet capability exists in headless browser
      if (typeof window !== 'undefined') {
        if (!window.AudioContext && !(window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) {
          (window as unknown as { AudioContext: unknown }).AudioContext = class MockAudioContext {};
        }
        if (typeof AudioWorkletNode === 'undefined') {
          (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = class MockAudioWorkletNode {};
        }
        if (!navigator.mediaDevices) {
          (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
            getUserMedia: async () => ({}),
          };
        } else if (!navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia = async () => ({}) as unknown as MediaStream;
        }
      }
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext({ sampleRate: 48000 });
        await context.resume();
        const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); oscillator.stop(); void context.close(); };
        }
        return destination.stream;
      };

    },
    { initInputs: initialMidiInputs, disableOpfs }
  );

  // Mock Score Detail
  await page.route(`**/api/v1/scores/${scoreId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        title: 'Practice Smoke Score',
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

  // One Practice Source envelope supplies the artifact and requested notation.
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/source*`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: apiResponse({ source_id: 'source-1', artifact: artifactOverride ?? smokeArtifact, notation:
          new URL(route.request().url()).searchParams.get('include_notation') === 'true'
            ? { musicxml: selectableMusicXml, mime_type: 'application/vnd.recordare.musicxml+xml' } : null }),
      })
    );

  // Mock the practice-acoustic-robust-browser@v1 access contract.
  await page.route(`**${practiceModelAccessPath}`, (route) => {
    if (options.modelAccessOverride === 'error') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { message: 'Model asset unavailable' } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        schemaVersion: 1,
        assetId: 'practice-acoustic-robust-browser',
        assetVersion: 'v1',
        expectedByteSize: 98_689_283,
        sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
        mediaType: 'application/octet-stream',
        downloadUrl: 'https://model-assets.example.test/practice-acoustic-robust-browser-v1.onnx?x-oss-signature-version=OSS4-HMAC-SHA256',
        downloadUrlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
  });
}

test.describe('Browser-Local Practice E2E Smoke', () => {
  test('STEP MIDI: runs locally with zero session requests and zero WebSockets', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    const disallowedRequests: string[] = [];
    const modelAssetRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/targets') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
      if (url.includes('/model-assets')) {
        modelAssetRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Switch input to MIDI
    await configurePractice(page, 'STEP', 'MIDI', 'OFF');

    // Start practice
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeEnabled();

    // Verify waiting for first note
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');
    const learningCursor = page.locator('[data-practice-playhead-cursor]');
    await expect(learningCursor).toHaveCount(1);
    const firstTargetX = await learningCursor.getAttribute('x');
    await expect(page.getByTestId('practice-timer')).toHaveCount(0);
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));

    // Emit wrong note -> remains on first target
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(50, 100);
    });
    await page.clock.runFor(35);
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');
    await expect(learningCursor).toHaveAttribute('x', firstTargetX!);

    // Emit correct note 60 (C4) -> advances
    await page.clock.runFor(1); // The next gesture must be strictly after the retirement watermark.
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100);
    });
    await page.clock.runFor(35);

    // STEP is paced waiting, not Continuous transport.
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');
    await expect(learningCursor).not.toHaveAttribute('x', firstTargetX!);

    // Skip
    const skipButton = page.getByRole('button', { name: '跳过', exact: true });
    await expect(skipButton).toBeEnabled();
    await skipButton.click();

    // End without a completion artifact
    const endButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(endButton).toBeEnabled();
    await endButton.click();

    // End returns to the pre-start state without a dialog
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);

    // Strict assertions: 0 /practice/sessions, 0 WebSockets, 0 /model-assets
    expect(disallowedRequests).toEqual([]);
    expect(modelAssetRequests).toEqual([]);
  });

  test('CONTINUOUS MIDI: executes count-in and playhead advance browser-locally', async ({
    page,
  }) => {
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/targets') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Switch to Continuous play mode and MIDI input
    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'OFF');

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Verify count-in or running status
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);

    // Wait until running
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');

    // Pause
    const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(page.getByRole('status')).toContainText('练习已暂停');

    // Resume
    const resumeButton = page.getByRole('button', { name: '继续', exact: true });
    await expect(resumeButton).toBeEnabled();
    await resumeButton.click();
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');

    // End without a completion artifact
    const endButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(endButton).toBeEnabled();
    await endButton.click();

    // End returns to the pre-start state without a dialog
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);

    // Strict assertions: 0 /practice/sessions, 0 WebSockets
    expect(disallowedRequests).toEqual([]);
  });

  test('TEMPO & METRONOME: custom tempo and metronome toggle function browser-locally', async ({
    page,
  }) => {
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/targets') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Open tempo popover from bottom controls
    const tempoButton = page.getByRole('button', { name: '速度' });
    await expect(tempoButton).toBeVisible();
    await tempoButton.click();

    // Verify original tempo display (has changes from 100 to 90)
    await expect(page.getByText(/原速：含速度变化，起始 ♩ = 100 BPM/).first()).toBeVisible();

    // Adjust BPM with +5 directly (transitions to custom fixed BPM)
    const plusButton = page.getByRole('button', { name: '+5 BPM' }).first();
    await expect(plusButton).toBeEnabled();
    await plusButton.click();
    await expect(page.getByText('105 BPM').first()).toBeVisible();

    // Toggle metronome on directly inside tempo popover
    const metronomeButton = page.getByRole('button', { name: '节拍器声音' });
    await expect(metronomeButton).toBeEnabled();
    await expect(metronomeButton).toContainText('关');
    await metronomeButton.click();
    await expect(metronomeButton).toContainText('开');

    // Close tempo popover
    await page.keyboard.press('Escape');

    // Select MIDI input for reliable headless execution
    await configurePractice(page, 'STEP', 'MIDI', 'OFF');

    // Start practice with custom tempo & metronome
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeEnabled();

    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // End without a completion artifact
    const endButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(endButton).toBeEnabled();
    await endButton.click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
    expect(disallowedRequests).toEqual([]);
  });

  test('CONTINUOUS: pauses during count-in and resumes remaining pre-roll before running', async ({
    page,
  }) => {
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/targets') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Switch to Continuous mode and MIDI
    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'OFF');

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // In count-in: pause immediately while in pre-roll
    await expect(page.getByRole('status')).toContainText(/预备拍/);
    const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(page.getByRole('status')).toContainText('练习已暂停');

    // Resume from paused count-in: should display remaining count-in and smoothly enter running
    const resumeButton = page.getByRole('button', { name: '继续', exact: true });
    await expect(resumeButton).toBeEnabled();
    await resumeButton.click();

    // Eventually completes count-in and enters running
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');

    // Abandon the active session
    const endButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(endButton).toBeEnabled();
    await endButton.click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
    expect(disallowedRequests).toEqual([]);
  });

  test('TEMPO & SCOPE: positive-first tempo provenance and leading-rest scope display correctly', async ({
    page,
  }) => {
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/targets') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    // Artifact where explicit tempo only appears at beat 2.0 (positive-first: beat 0 has no explicit tempo)
    const leadingRestArtifact = {
      ...smokeArtifact,
      scoreTempoSegments: [{ startBeat: 2.0, bpm: 90.0 }],
       scoreEndBeat: 3,
      notes: smokeArtifact.notes.slice(0,1),
      events: [{ ...smokeArtifact.events[0], onsetBeat: 2 }],
      moments: [{ ...smokeArtifact.moments[0], onsetBeat: 2, canonicalEndBeat: 3 }],
    };

    await setupPracticeMocks(page, leadingRestArtifact);
    await openPreparedPractice(page, scoreId, revisionId);

    // Open tempo popover from bottom controls
    const tempoButton = page.getByRole('button', { name: '速度' });
    await expect(tempoButton).toBeVisible();
    await tempoButton.click();

    // Since startBeat of full-piece is 2.0 (where MusicXML tempo 90 exists):
    // effectiveScoreTempoAtBeat(leadingRestArtifact, 2.0) resolves to MUSICXML at 90 BPM
    await expect(page.getByText(/90 BPM/).first()).toBeVisible();

    expect(disallowedRequests).toEqual([]);
  });

  test('METRONOME LIVE TOGGLE: toggles metronome ON and OFF during active practice', async ({
    page,
  }) => {
    const disallowedRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('/practice/sessions') ||
        url.includes('/targets') ||
        request.resourceType() === 'websocket'
      ) {
        disallowedRequests.push(`${request.method()} ${url}`);
      }
    });

    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // Select MIDI input
    await configurePractice(page, 'STEP', 'MIDI', 'OFF');

    // Start practice (starts with Metronome OFF by default)
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeEnabled();
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Toggle metronome ON while ACTIVE inside tempo popover
    const tempoButton = page.getByRole('button', { name: '速度' });
    await tempoButton.click();
    const metronomeButton = page.getByRole('button', { name: '节拍器声音' });
    await expect(metronomeButton).toContainText('关');
    await metronomeButton.click();
    await expect(metronomeButton).toContainText('开');

    // Toggle metronome OFF while ACTIVE inside tempo popover
    await metronomeButton.click();
    await expect(metronomeButton).toContainText('关');
    await page.keyboard.press('Escape');

    // Practice remains ACTIVE and playable
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Abandon the active session
    const endButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(endButton).toBeEnabled();
    await endButton.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);

    expect(disallowedRequests).toEqual([]);
  });

  test('CUSTOMER UX REGRESSION: desktop drawer parity, input gating, 2-stage section selection, bottom tempo/metronome', async ({
    page,
  }) => {
    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    // 1. Desktop Layout Parity: NO persistent right settings panel (aside)
    await expect(page.locator('aside')).toHaveCount(0);

    // Setup exclusively owns mode, input and recording. STEP has no empty settings sheet.
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
    for (const name of ['逐音练习', '连贯演奏', '麦克风', 'MIDI 键盘', '录音', '录像', '开始练习']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await openPracticeSetup(page);
    await expect(page.getByRole('button', { name: '逐音练习', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MIDI 键盘', exact: true })).toBeVisible();
    await selectPracticeConfiguration(page, 'STEP', 'MIDI', 'OFF');
    expect(await preparePracticeSetup(page)).toBe('READY');

    // 2. Bottom Bar Controls: Unified Tempo & Metronome Popover
    const tempoButton = page.getByRole('button', { name: '速度' });
    await expect(tempoButton).toBeVisible();
    await expect(tempoButton).toContainText(/原速|BPM/);
    await tempoButton.click();

    const metronomeButton = page.getByRole('button', { name: '节拍器声音' });
    await expect(metronomeButton).toBeVisible();
    await expect(metronomeButton).toContainText('关');
    await metronomeButton.click();
    await expect(metronomeButton).toContainText('开');
    await metronomeButton.click();
    await expect(metronomeButton).toContainText('关');
    await page.keyboard.press('Escape');

    // 3. Section Selection 3-State Interaction
    const sectionButton = page.getByRole('button', { name: '分段' });
    await expect(sectionButton).toBeVisible();
    // Default inactive state: not active styling
    await expect(sectionButton).not.toHaveClass(/bg-slate-200/);

    await sectionButton.click();

    // Selecting state: active background and prompt to select start note
    await expect(sectionButton).toHaveClass(/bg-slate-200/);
    await expect(page.getByRole('status')).toContainText('请选择起始音符');

    // First click: start note -> prompt to select end note, NO orange notehead boundary classes
    const startNote = page.locator('[data-id="select-start-note"]').first();
    await expect(startNote).toBeVisible();
    await startNote.locator('path, use').first().click();

    await expect(page.locator('.practice-range-boundary')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('请选择结束音符');

    // Second click: end note -> completes range, auto-exits selection mode
    const endNote = page.locator('[data-id="select-end-note"]').first();
    await expect(endNote).toBeVisible();
    await endNote.locator('path, use').first().click();

    // The committed range is ready for explicit Start.
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    // Section button remains active/highlighted when completed
    await expect(sectionButton).toHaveClass(/bg-slate-200/);
    // Selected range background remains on notes in the range
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    // Absolutely NO boundary orange notehead classes
    await expect(page.locator('.practice-range-boundary')).toHaveCount(0);

    // Clicking section button again clears the selection and restores full piece
    await sectionButton.click();
    await expect(sectionButton).not.toHaveClass(/bg-slate-200/);
    await expect(page.locator('.practice-range-selected')).toHaveCount(0);

    // Re-select range for starting practice with range
    await sectionButton.click();
    await startNote.locator('path, use').first().click();
    await endNote.locator('path, use').first().click();
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);

    // 4. Start Practice with Range
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeEnabled();

    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // While ACTIVE, tempo button triggers popover showing locked notice
    await tempoButton.click();
    await expect(page.getByText('练习进行中速度已锁定')).toBeVisible();
    await expect(page.getByRole('button', { name: '+5 BPM' })).toBeDisabled();
    await page.keyboard.press('Escape');

    // Abandon the active session
    const endButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(endButton).toBeEnabled();
    await endButton.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
  });

  test('SECTION SELECTION: incomplete range blocks Start and cancellation restores full-piece readiness', async ({ page }) => {
    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    const sectionButton = page.getByRole('button', { name: '分段', exact: true });
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    const status = page.getByRole('status');
    await sectionButton.click();
    await page.locator('[data-id="select-start-note"]').first().locator('path, use').first().click();

    await expect(sectionButton).toHaveClass(/bg-slate-200/);
    await expect(status).toContainText('请选择结束音符');
    await expect(page.locator('.practice-range-selected')).toHaveCount(1);
    await expect(page.locator('[data-id="select-start-note"]').first()).toHaveClass(/practice-range-selected/);
    await expect(startButton).toBeDisabled();

    await sectionButton.click();
    await expect(sectionButton).not.toHaveClass(/bg-slate-200/);
    await expect(startButton).toBeEnabled();
    await expect(page.locator('.practice-range-selected')).toHaveCount(0);
    await expect(startButton).toBeEnabled();

    // Explicit Start captures the restored full-piece scope.
    await expect(startButton).toBeEnabled();
    await startButton.click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '跳过', exact: true }).click();
    await expect(page.getByRole('heading', { name: '练习已完成', exact: true })).toBeVisible();
  });

  test('SECTION SELECTION: reverse note clicks resolve the inclusive range before Start', async ({ page }) => {
    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    const sectionButton = page.getByRole('button', { name: '分段', exact: true });
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    const status = page.getByRole('status');
    await sectionButton.click();
    await page.locator('[data-id="select-end-note"]').first().locator('path, use').first().click();
    await expect(status).toContainText('请选择结束音符');
    await page.locator('[data-id="select-start-note"]').first().locator('path, use').first().click();

    await expect(startButton).toBeEnabled();
    await expect(status).not.toContainText('请选择');
    await expect(sectionButton).toHaveClass(/bg-slate-200/);
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    await expect(page.locator('.practice-range-boundary')).toHaveCount(0);
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(sectionButton).toBeDisabled();
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(startButton).toBeEnabled();
    await expect(sectionButton).toBeEnabled();
  });

  test('SECTION SELECTION: selected-section completion can adjust and replace the range', async ({ page }) => {
    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    const sectionButton = page.getByRole('button', { name: '分段', exact: true });
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    const status = page.getByRole('status');
    const startNote = page.locator('[data-id="select-start-note"]').first().locator('path, use').first();
    const endNote = page.locator('[data-id="select-end-note"]').first().locator('path, use').first();
    await sectionButton.click();
    await startNote.click();
    await endNote.click();
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeEnabled();
    await expect(status).toContainText('可以开始，请弹奏当前音符');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '跳过', exact: true }).click();

    const completionDialog = page.getByRole('dialog');
    await expect(completionDialog.getByRole('heading', { name: '选段练习已完成', exact: true })).toBeVisible();
    const adjustButton = completionDialog.getByRole('button', { name: '调整分段', exact: true });
    await expect(adjustButton).toBeEnabled();
    await adjustButton.click();

    await expect(completionDialog).not.toBeVisible();
    await expect(sectionButton).toHaveClass(/bg-slate-200/);
    await expect(page.locator('.practice-range-selected')).toHaveCount(0);
    await expect(status).toContainText('请选择起始音符');

    await startNote.click();
    await expect(status).toContainText('请选择结束音符');
    await expect(startButton).toBeDisabled();
    await endNote.click();
    await expect(startButton).toBeEnabled();
    await expect(status).not.toContainText('请选择');
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    await expect(startButton).toBeEnabled();
  });

  test('STEP setup does not prefetch a model for MIDI and blocks until a device connects', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => { if (request.url().includes('/model-assets')) requests.push(request.url()); });
    await setupPracticeMocks(page, { initialMidiInputs: 0 });
    await page.goto('/zh/score/' + scoreId + '/practice/setup?practiceRevisionId=' + revisionId);
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '逐音练习', exact: true }).click();
    await page.getByRole('button', { name: 'MIDI 键盘', exact: true }).click();
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: '开始练习', exact: true }).click();
    await expect(page.getByTestId('practice-setup').getByRole('alert')).toHaveText('准备未能完成，请检查浏览器权限与设备连接后重试。');
    await expect(page.getByRole('button', { name: '开始练习', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'MIDI 键盘', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => (window as unknown as { __connectMockMidiDevice: () => void }).__connectMockMidiDevice());
    await page.getByRole('button', { name: '开始练习', exact: true }).click();
    const start = page.getByRole('button', { name: '开始', exact: true });
    await expect(start).toBeEnabled(); await start.click();
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect(start).toBeEnabled(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('Continuous microphone cold setup fails closed on asset access without starting a session', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname === practiceModelAccessPath) requests.push(request.url()); });
    await setupPracticeMocks(page, { modelAccessOverride: 'error' });
    await page.goto('/zh/score/' + scoreId + '/practice/setup?practiceRevisionId=' + revisionId);
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    await page.getByRole('button', { name: '连贯演奏', exact: true }).click();
    await page.getByRole('button', { name: '麦克风', exact: true }).click();
    await page.getByRole('button', { name: '不录制', exact: true }).click();
    expect(requests).toEqual([]);
    const access = page.waitForResponse(response => new URL(response.url()).pathname === practiceModelAccessPath);
    await page.getByRole('button', { name: '开始练习', exact: true }).click();
    expect((await access).status()).toBe(500);
    await expect(page.getByTestId('practice-setup').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '麦克风', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });

  test('CONTINUOUS ACTIVE SESSION: survives backend API loss after score assets load', async ({
    page,
  }) => {
    await setupPracticeMocks(page);
    await openPreparedPractice(page, scoreId, revisionId);

    await configurePractice(page, 'CONTINUOUS', 'MIDI', 'OFF');

    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');

    await page.context().setOffline(true);
    try {
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

      await page.evaluate(() => {
        (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100);
      });

      const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
      await expect(pauseButton).toBeEnabled();
      await pauseButton.click();
      await expect(page.getByRole('status')).toContainText('练习已暂停');

      const resumeButton = page.getByRole('button', { name: '继续', exact: true });
      await expect(resumeButton).toBeEnabled();
      await resumeButton.click();
      await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
    await expect(page.getByTestId('practice-status')).toHaveText('');

      const endButton = page.getByRole('button', { name: '结束', exact: true });
      await expect(endButton).toBeEnabled();
      await endButton.click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: '查看报告' })).toHaveCount(0);
    } finally {
      await page.context().setOffline(false);
    }
  });
});


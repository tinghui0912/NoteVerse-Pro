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

const smokeArtifact = {
  schemaVersion: 1,
  artifactId: 'practice-score-artifact:smoke-test',
  scoreId,
  revisionId,
  firstPlayableBeat: 0.0,
  scoreEndBeat: 4.0,
  playableEvents: [],
  scoreTempoSegments: [
    { startBeat: 0.0, bpm: 100.0 },
    { startBeat: 2.0, bpm: 90.0 },
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
      renderNoteIds: ['select-start-note'],
      measureNumbers: ['1'],
      eventIds: ['e-0'],
      expectedNotes: [{ expectedNoteId: 'note-0', eventId: 'e-0', pitch: 'C4', midiPitch: 60, measureNumbers: ['1'], renderNoteIds: ['select-start-note'] }],
      strikeTargets: [{ strikeId: 'strike-0', pitch: 'C4', eventIds: ['e-0'], expectedNotes: [{ expectedNoteId: 'note-0', eventId: 'e-0', pitch: 'C4', midiPitch: 60, measureNumbers: ['1'], renderNoteIds: ['select-start-note'] }], measureNumbers: ['1'], renderNoteIds: ['select-start-note'] }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
    {
      groupId: 'group-1',
      onsetBeat: 1.0,
      canonicalEndBeat: 2.0,
      pitches: ['D4'],
      renderNoteIds: ['middle-note'],
      measureNumbers: ['1'],
      eventIds: ['e-1'],
      expectedNotes: [{ expectedNoteId: 'note-1', eventId: 'e-1', pitch: 'D4', midiPitch: 62, measureNumbers: ['1'], renderNoteIds: ['middle-note'] }],
      strikeTargets: [{ strikeId: 'strike-1', pitch: 'D4', eventIds: ['e-1'], expectedNotes: [{ expectedNoteId: 'note-1', eventId: 'e-1', pitch: 'D4', midiPitch: 62, measureNumbers: ['1'], renderNoteIds: ['middle-note'] }], measureNumbers: ['1'], renderNoteIds: ['middle-note'] }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
    {
      groupId: 'group-2',
      onsetBeat: 2.0,
      canonicalEndBeat: 3.0,
      pitches: ['E4'],
      renderNoteIds: ['select-end-note'],
      measureNumbers: ['1'],
      eventIds: ['e-2'],
      expectedNotes: [{ expectedNoteId: 'note-2', eventId: 'e-2', pitch: 'E4', midiPitch: 64, measureNumbers: ['1'], renderNoteIds: ['select-end-note'] }],
      strikeTargets: [{ strikeId: 'strike-2', pitch: 'E4', eventIds: ['e-2'], expectedNotes: [{ expectedNoteId: 'note-2', eventId: 'e-2', pitch: 'E4', midiPitch: 64, measureNumbers: ['1'], renderNoteIds: ['select-end-note'] }], measureNumbers: ['1'], renderNoteIds: ['select-end-note'] }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
  ],
  practiceAttackSteps: [
    {
      stepId: 'step-0',
      expectedGroupIndex: 0,
      onsetBeat: 0.0,
      attackTargets: [{ attackId: 'attack-0', pitch: 'C4', eventIds: ['e-0'], notes: [{ expectedNoteId: 'note-0', eventId: 'e-0', pitch: 'C4', midiPitch: 60, measureNumbers: ['1'], renderNoteIds: ['select-start-note'] }], measureNumbers: ['1'], renderNoteIds: ['select-start-note'] }],
      continuation: [],
    },
    {
      stepId: 'step-1',
      expectedGroupIndex: 1,
      onsetBeat: 1.0,
      attackTargets: [{ attackId: 'attack-1', pitch: 'D4', eventIds: ['e-1'], notes: [{ expectedNoteId: 'note-1', eventId: 'e-1', pitch: 'D4', midiPitch: 62, measureNumbers: ['1'], renderNoteIds: ['middle-note'] }], measureNumbers: ['1'], renderNoteIds: ['middle-note'] }],
      continuation: [],
    },
    {
      stepId: 'step-2',
      expectedGroupIndex: 2,
      onsetBeat: 2.0,
      attackTargets: [{ attackId: 'attack-2', pitch: 'E4', eventIds: ['e-2'], notes: [{ expectedNoteId: 'note-2', eventId: 'e-2', pitch: 'E4', midiPitch: 64, measureNumbers: ['1'], renderNoteIds: ['select-end-note'] }], measureNumbers: ['1'], renderNoteIds: ['select-end-note'] }],
      continuation: [],
    },
  ],
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

      const mockAccess = {
        inputs: inputsMap,
        outputs: new Map(),
        onstatechange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      (window as unknown as { __connectMockMidiDevice: () => void }).__connectMockMidiDevice = () => {
        inputsMap.set('mock-midi-in-1', fakeInput);
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

  // Mock Practice Content
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        content: selectableMusicXml,
      }),
    })
  );

  // Mock PracticeScoreArtifact
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/artifact`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(artifactOverride ?? smokeArtifact),
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
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Switch input to MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    // Close settings if sheet opened
    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Verify waiting for first note
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Emit wrong note -> remains on first target
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(50, 100);
    });
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Emit correct note 60 (C4) -> advances
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100);
    });

    // STEP is paced waiting, not Continuous transport.
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Skip
    const skipButton = page.getByRole('button', { name: '跳过', exact: true });
    await expect(skipButton).toBeEnabled();
    await skipButton.click();

    // Finish
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    // Assert dialog opened
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();

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
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Switch to Continuous play mode and MIDI input
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

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Verify count-in or running status
    await expect(page.getByRole('status')).toContainText(/预备拍|连贯演奏中/);

    // Wait until running
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Pause
    const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(page.getByRole('status')).toContainText('练习已暂停');

    // Resume
    const resumeButton = page.getByRole('button', { name: '继续', exact: true });
    await expect(resumeButton).toBeEnabled();
    await resumeButton.click();
    await expect(page.getByRole('status')).toContainText('连贯演奏中');

    // Finish
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    // Assert dialog opened
    await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();

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
    await page.goto(`/zh/score/${scoreId}/practice`);

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
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    const midiInputOption = page.getByRole('button', { name: /MIDI/i }).first();
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    // Close settings if sheet opened
    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice with custom tempo & metronome
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Finish
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();
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
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Switch to Continuous mode and MIDI
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
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Finish session cleanly
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

    await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();
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
      expectedPracticeGroups: [
        {
          ...smokeArtifact.expectedPracticeGroups[0],
          onsetBeat: 2.0,
          canonicalEndBeat: 3.0,
        },
      ],
      practiceAttackSteps: [
        {
          ...smokeArtifact.practiceAttackSteps[0],
          onsetBeat: 2.0,
        },
      ],
    };

    await setupPracticeMocks(page, leadingRestArtifact);
    await page.goto(`/zh/score/${scoreId}/practice`);

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
    await page.goto(`/zh/score/${scoreId}/practice`);

    // Select MIDI input
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    const midiInputOption = page.getByRole('button', { name: /MIDI/i }).first();
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    // Start practice (starts with Metronome OFF by default)
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();
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

    // Finish session cleanly
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();

    expect(disallowedRequests).toEqual([]);
  });

  test('CUSTOMER UX REGRESSION: desktop drawer parity, input gating, 2-stage section selection, bottom tempo/metronome', async ({
    page,
  }) => {
    await setupPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);

    // 1. Desktop Layout Parity: NO persistent right settings panel (aside)
    await expect(page.locator('aside')).toHaveCount(0);

    // Click Settings: opens single Sheet
    const settingsButton = page.getByRole('button', { name: '设置' });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // Sheet contains Mode and Input options
    await expect(page.getByText('逐音练习')).toBeVisible();
    await expect(page.getByText('连贯演奏')).toBeVisible();
    await expect(page.getByText('麦克风', { exact: true })).toBeVisible();
    await expect(page.getByText('MIDI 键盘', { exact: true })).toBeVisible();

    // Sheet does NOT contain Tempo and Metronome
    await expect(page.getByText('速度与节拍器')).toHaveCount(0);

    // Select MIDI input
    const midiInput = page.getByRole('button', { name: /MIDI/i }).first();
    await midiInput.click();

    // Close Sheet
    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    }
    await expect(page.getByText('逐音练习')).not.toBeVisible();

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

    // Range selection mode should auto-exit
    await expect(page.getByRole('status')).toContainText('第 1 小节');
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
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // While ACTIVE, tempo button triggers popover showing locked notice
    await tempoButton.click();
    await expect(page.getByText('练习进行中速度已锁定')).toBeVisible();
    await page.keyboard.press('Escape');

    // Finish session cleanly
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();
  });

  test('SECTION SELECTION: incomplete range disables Start and cancellation restores full-piece practice', async ({ page }) => {
    await setupPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: /MIDI/i }).click();
    await page.getByRole('button', { name: /close/i }).click();

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
    await expect(status).not.toContainText('请选择');
    await expect(status).not.toContainText('第 1 小节');
    await expect(page.locator('.practice-range-selected')).toHaveCount(0);
    await expect(startButton).toBeEnabled();

    // The restored scope completes as full-piece practice, not a partial range.
    await startButton.click();
    await expect(status).toContainText('可以开始，请弹奏当前音符');
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect(page.getByRole('heading', { name: '练习已完成', exact: true })).toBeVisible();
  });

  test('SECTION SELECTION: reverse note clicks complete the inclusive range and lock selection during practice', async ({ page }) => {
    await setupPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: /MIDI/i }).click();
    await page.getByRole('button', { name: /close/i }).click();

    const sectionButton = page.getByRole('button', { name: '分段', exact: true });
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    const status = page.getByRole('status');
    await sectionButton.click();
    await page.locator('[data-id="select-end-note"]').first().locator('path, use').first().click();
    await expect(status).toContainText('请选择结束音符');
    await page.locator('[data-id="select-start-note"]').first().locator('path, use').first().click();

    await expect(status).toContainText('第 1 小节');
    await expect(status).not.toContainText('请选择');
    await expect(sectionButton).toHaveClass(/bg-slate-200/);
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    await expect(page.locator('.practice-range-boundary')).toHaveCount(0);
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(status).toContainText('可以开始，请弹奏当前音符');
    await expect(sectionButton).toBeDisabled();
    await page.getByRole('button', { name: '结束', exact: true }).click();
    await expect(page.getByRole('heading', { name: '选段练习已完成', exact: true })).toBeVisible();
  });

  test('SECTION SELECTION: selected-section completion can adjust and replace the range', async ({ page }) => {
    await setupPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: /MIDI/i }).click();
    await page.getByRole('button', { name: /close/i }).click();

    const sectionButton = page.getByRole('button', { name: '分段', exact: true });
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    const status = page.getByRole('status');
    const startNote = page.locator('[data-id="select-start-note"]').first().locator('path, use').first();
    const endNote = page.locator('[data-id="select-end-note"]').first().locator('path, use').first();
    await sectionButton.click();
    await startNote.click();
    await endNote.click();
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(status).toContainText('可以开始，请弹奏当前音符');
    await page.getByRole('button', { name: '结束', exact: true }).click();

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
    await expect(status).toContainText('第 1 小节');
    await expect(status).not.toContainText('请选择');
    await expect(page.locator('.practice-range-selected')).toHaveCount(3);
    await expect(startButton).toBeEnabled();
  });

  test('STEP microphone is capability-available without prefetch; MIDI retries after a device connects without acoustic loading', async ({
    page,
  }) => {
    const modelAssetRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/model-assets')) {
        modelAssetRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await setupPracticeMocks(page, {
      initialMidiInputs: 0,
    });

    await page.goto(`/zh/score/${scoreId}/practice`);

    // Microphone capability is ready before any model access or session preparation.
    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('已准备就绪，请点击开始');

    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    expect(modelAssetRequests).toEqual([]);

    // 2. Open Settings, switch to MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    await settingsButton.click();
    const microphoneOption = page.getByRole('button', { name: /^麦克风/ });
    await expect(microphoneOption).toBeEnabled();
    await expect(microphoneOption).toHaveAttribute('aria-pressed', 'true');
    await expect(microphoneOption).toContainText('使用浏览器默认麦克风');
    expect(modelAssetRequests).toEqual([]);
    const midiOption = page.getByRole('button', { name: /MIDI/i }).first();
    await midiOption.click();

    // Close Settings Sheet
    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    } else {
      await page.keyboard.press('Escape');
    }

    // 3. MIDI selected: Start button is enabled (since Web MIDI is supported in browser)
    await expect(startButton).toBeEnabled();

    // Click Start: fails because 0 devices connected
    await startButton.click();

    // Practice does NOT enter ACTIVE, stays READY, displays 0-device error
    await expect(status).toContainText('未检测到 MIDI 输入设备，请连接 MIDI 键盘后重试');
    await expect(status).not.toContainText('可以开始，请弹奏当前音符');
    expect(modelAssetRequests).toEqual([]);

    // 4. User plugs in MIDI keyboard
    await page.evaluate(() => {
      (window as unknown as { __connectMockMidiDevice: () => void }).__connectMockMidiDevice();
    });

    // Re-click Start to retry
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Practice becomes ACTIVE
    await expect(status).toContainText('可以开始，请弹奏当前音符');

    // Finish session cleanly
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();
    expect(modelAssetRequests).toEqual([]);
  });

  test('Continuous microphone is capability-available without prefetch and fails closed if asset access fails during preparation', async ({
    page,
  }) => {
    const modelAssetRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/model-assets')) {
        modelAssetRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await setupPracticeMocks(page, { modelAccessOverride: 'error' });
    await page.goto(`/zh/score/${scoreId}/practice`);

    const status = page.getByRole('status');
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(status).toContainText('已准备就绪，请点击开始');
    await expect(startButton).toBeEnabled();
    expect(modelAssetRequests).toEqual([]);

    const settingsButton = page.getByRole('button', { name: '设置' });
    await settingsButton.click();
    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();
    const microphoneOption = page.getByRole('button', { name: /^麦克风/ });
    await expect(microphoneOption).toBeEnabled();
    await microphoneOption.click();
    await expect(microphoneOption).toHaveAttribute('aria-pressed', 'true');
    await expect(microphoneOption).toContainText('使用浏览器默认麦克风');
    expect(modelAssetRequests).toEqual([]);

    const sheetClose = page.getByRole('button', { name: /close/i });
    await expect(sheetClose).toBeVisible();
    await sheetClose.click();

    await expect(status).toContainText('已准备就绪，请点击开始');
    await expect(startButton).toBeEnabled();
    expect(modelAssetRequests).toEqual([]);

    const assetAccessResponse = page.waitForResponse(
      response => new URL(response.url()).pathname === practiceModelAccessPath
    );
    await startButton.click();
    expect((await assetAccessResponse).status()).toBe(500);
    await expect(status).toContainText('无法加载已校验的分析模型。请开始新会话重试。');
    await expect(status).not.toContainText(/预备拍|连贯演奏中/);
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '结束', exact: true })).toBeDisabled();
    expect(modelAssetRequests).toEqual([`GET ${practiceModelAccessPath}`]);
  });

  test('CONTINUOUS ACTIVE SESSION: survives backend API loss after score assets load', async ({
    page,
  }) => {
    await setupPracticeMocks(page);
    await page.goto(`/zh/score/${scoreId}/practice`);

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

    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

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
      await expect(page.getByRole('status')).toContainText('连贯演奏中');

      const finishButton = page.getByRole('button', { name: '结束', exact: true });
      await expect(finishButton).toBeEnabled();
      await finishButton.click();
      await expect(page.getByRole('heading', { name: /演奏已完成|练习已完成/i })).toBeVisible();
      await expect(page.getByRole('button', { name: '查看报告' })).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });
});


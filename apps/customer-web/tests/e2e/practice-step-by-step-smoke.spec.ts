import { expect, test, type Page } from '@playwright/test';
import {
  mockAuthenticatedSession,
  mockRealtimeEvents,
} from './support/api-mocks';

const scoreId = 'practice-smoke-score';
const revisionId = 'practice-smoke-revision';

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
  schemaVersion: 2,
  artifactId: 'practice-score-artifact-v2:smoke-test',
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
      expectedNotes: [{ pitch: 'C4', midiPitch: 60 }],
      strikeTargets: [{ pitch: 'C4', midiPitch: 60 }],
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
      expectedNotes: [{ pitch: 'D4', midiPitch: 62 }],
      strikeTargets: [{ pitch: 'D4', midiPitch: 62 }],
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
      expectedNotes: [{ pitch: 'E4', midiPitch: 64 }],
      strikeTargets: [{ pitch: 'E4', midiPitch: 64 }],
      staffIds: ['1'],
      voiceIds: ['1'],
    },
  ],
  practiceAttackSteps: [
    {
      stepId: 'step-0',
      expectedGroupIndex: 0,
      onsetBeat: 0.0,
      attackTargets: [{ pitch: 'C4', midiPitch: 60 }],
      continuation: [],
    },
    {
      stepId: 'step-1',
      expectedGroupIndex: 1,
      onsetBeat: 1.0,
      attackTargets: [{ pitch: 'D4', midiPitch: 62 }],
      continuation: [],
    },
    {
      stepId: 'step-2',
      expectedGroupIndex: 2,
      onsetBeat: 2.0,
      attackTargets: [{ pitch: 'E4', midiPitch: 64 }],
      continuation: [],
    },
  ],
};

function apiResponse(data: unknown) {
  return JSON.stringify({ success: true, data });
}

async function setupPracticeMocks(page: Page, artifactOverride?: unknown) {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);

  // Install mock Web MIDI API
  await page.addInitScript(() => {
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

    const mockAccess = {
      inputs: new Map([['mock-midi-in-1', fakeInput]]),
      outputs: new Map(),
      onstatechange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
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
  });

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
}

test.describe('Browser-Local Practice E2E Smoke', () => {
  test('STEP MIDI: runs locally with zero session requests and zero WebSockets', async ({
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

    // Switch input to MIDI
    const settingsButton = page.getByRole('button', { name: '设置' });
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }
    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    // Close settings if sheet opened
    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    }

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

    // Pause
    const pauseButton = page.getByRole('button', { name: '暂停', exact: true });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(page.getByRole('status')).toContainText('练习已暂停');

    // Resume
    const resumeButton = page.getByRole('button', { name: '继续', exact: true });
    await expect(resumeButton).toBeEnabled();
    await resumeButton.click();
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

    // Strict assertions: 0 /practice/sessions, 0 WebSockets
    expect(disallowedRequests).toEqual([]);
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
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }

    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();

    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    }

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

    // Open settings
    const settingsButton = page.getByRole('button', { name: '设置' });
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }

    // Verify original tempo display (has changes from 100 to 90)
    await expect(page.getByText(/原速：含速度变化，起始 ♩ = 100 BPM/).first()).toBeVisible();

    // Switch to custom tempo
    const customButton = page.getByRole('button', { name: '自定义' }).first();
    await expect(customButton).toBeEnabled();
    await customButton.click();

    // Verify initial custom BPM matches score starting BPM (100)
    await expect(page.getByText('100 BPM').first()).toBeVisible();

    // Adjust BPM with +5
    const plusButton = page.getByRole('button', { name: '+5 BPM' }).first();
    await expect(plusButton).toBeEnabled();
    await plusButton.click();
    await expect(page.getByText('105 BPM').first()).toBeVisible();

    // Toggle metronome on
    const metronomeToggle = page.getByRole('button', { name: '关' }).first();
    await expect(metronomeToggle).toBeEnabled();
    await metronomeToggle.click();
    await expect(page.getByRole('button', { name: '开' }).first()).toBeVisible();

    // Select MIDI input for reliable headless execution
    const midiInputOption = page.getByRole('button', { name: /MIDI/i }).first();
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    // Close settings if sheet opened
    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    }

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
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }
    const continuousOption = page.getByRole('button', { name: /连贯演奏/i });
    await expect(continuousOption).toBeEnabled();
    await continuousOption.click();

    const midiInputOption = page.getByRole('button', { name: /MIDI/i });
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    }

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

    // Open settings
    const settingsButton = page.getByRole('button', { name: '设置' });
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }

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
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
    }
    const midiInputOption = page.getByRole('button', { name: /MIDI/i }).first();
    await expect(midiInputOption).toBeEnabled();
    await midiInputOption.click();

    // Start practice (starts with Metronome OFF by default)
    const sheetClose = page.getByRole('button', { name: /close/i });
    if (await sheetClose.isVisible()) {
      await sheetClose.click();
    }

    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Open settings while practice is ACTIVE
    const activeSettingsButton = page.getByRole('button', { name: '设置' });
    if (await activeSettingsButton.isVisible()) {
      await activeSettingsButton.click();
    }

    // Toggle metronome ON while ACTIVE
    const metronomeToggleOff = page.getByRole('button', { name: '关' }).first();
    await expect(metronomeToggleOff).toBeEnabled();
    await metronomeToggleOff.click();
    await expect(page.getByRole('button', { name: '开' }).first()).toBeVisible();

    // Toggle metronome OFF while ACTIVE
    const metronomeToggleOn = page.getByRole('button', { name: '开' }).first();
    await expect(metronomeToggleOn).toBeEnabled();
    await metronomeToggleOn.click();
    await expect(page.getByRole('button', { name: '关' }).first()).toBeVisible();

    // Close settings
    const activeSheetClose = page.getByRole('button', { name: /close/i });
    if (await activeSheetClose.isVisible()) {
      await activeSheetClose.click();
    }

    // Practice remains ACTIVE and playable
    await expect(page.getByRole('status')).toContainText('可以开始，请弹奏当前音符');

    // Finish session cleanly
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();
    await expect(page.getByRole('heading', { name: /练习已完成|选段练习已完成/i })).toBeVisible();

    expect(disallowedRequests).toEqual([]);
  });
});

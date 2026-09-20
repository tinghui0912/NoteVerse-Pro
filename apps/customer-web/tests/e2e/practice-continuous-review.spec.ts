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
      renderNoteIds: ['note-d4'],
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
      renderNoteIds: ['note-e4'],
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

type MockOptions = {
  denyMicrophone?: boolean;
};

async function setupContinuousPracticeMocks(page: Page, options: MockOptions = {}) {
  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);

  await page.addInitScript(({ denyMic }) => {
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
  }, { denyMic: Boolean(options.denyMicrophone) });

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

  await page.route('**/api/v1/performance-takes', (route) => {
    if (route.request().method() === 'POST') {
      const postData = route.request().postDataJSON();
      const newTake = {
        take_id: 'take-e2e-1',
        score_id: postData.score_id,
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
        }),
      });
    }
    return route.continue();
  });

  // Mock PracticeScoreArtifact
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/artifact`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(testArtifact),
    })
  );
}

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

    // Start practice
    const startButton = page.getByRole('button', { name: '开始', exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait until running
    await expect(page.getByRole('status')).toContainText('连贯演奏中', { timeout: 10_000 });

    // Emit notes
    await page.evaluate(() => {
      (window as unknown as { __emitMidiNote: (n: number, v: number) => void }).__emitMidiNote(60, 100);
    });

    // Finish practice
    const finishButton = page.getByRole('button', { name: '结束', exact: true });
    await expect(finishButton).toBeEnabled();
    await finishButton.click();

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
    await expect(page.getByText('音符匹配结果')).toBeVisible();
    await expect(page.getByText('已匹配音符组')).toBeVisible();
    await expect(page.getByText('总目标音符组')).toBeVisible();
    await expect(page.getByRole('button', { name: '回放' })).toBeVisible();

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
});

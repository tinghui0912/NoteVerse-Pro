import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  mockAuthenticatedSession,
  mockRealtimeEvents,
} from './support/api-mocks';
import type { PracticeAlignmentUpdateMessage } from '../../src/lib/practice/protocol';

const scoreId = 'practice-smoke-score';
const revisionId = 'practice-smoke-revision';
const sessionId = 'practice-smoke-session';
const musicXml = readFileSync(
  resolve(process.cwd(), '../../backend/tests/fixtures/musicxml/score-domain-metadata.musicxml'),
  'utf8'
);
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

function apiResponse(data: unknown) {
  return JSON.stringify({ success: true, data });
}

const defaultPracticeTargets = [
  {
    index: 0,
    group_id: 'entry-start',
    onset_beat: 1,
    event_ids: ['event-start'],
    render_note_ids: ['select-start-note'],
    pitches: ['C4'],
    measure_numbers: ['1'],
    staff_ids: ['1'],
    voice_ids: ['1'],
  },
  {
    index: 1,
    group_id: 'entry-middle',
    onset_beat: 2,
    event_ids: ['event-middle'],
    render_note_ids: ['middle-note'],
    pitches: ['D4'],
    measure_numbers: ['1'],
    staff_ids: ['1'],
    voice_ids: ['1'],
  },
  {
    index: 2,
    group_id: 'entry-end',
    onset_beat: 3,
    event_ids: ['event-end'],
    render_note_ids: ['select-end-note'],
    pitches: ['E4'],
    measure_numbers: ['1'],
    staff_ids: ['1'],
    voice_ids: ['1'],
  },
];

async function mockPracticeTargets(page: Page, targets = defaultPracticeTargets) {
  await page.route(
    `**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/targets`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: apiResponse({
          score_id: scoreId,
          revision_id: revisionId,
          targets,
        }),
      })
  );
}

function practiceSessionDetail(
  state: 'CREATED' | 'STREAMING' | 'FINISHED' = 'CREATED',
  inputSource: 'MICROPHONE' | 'MIDI' = 'MICROPHONE'
) {
  return {
    session_id: sessionId,
    score_id: scoreId,
    revision_id: revisionId,
    sample_rate: 16000,
    channels: 1,
    frame_format: 'pcm_s16le',
    state,
    access_origin: 'OWNER',
    progression_mode: 'WAIT_FOR_NOTE',
    realtime_guidance: 'GUIDED',
    evaluation_profile: 'LEARNING',
    input_source: inputSource,
    started_at: null,
    finished_at: null,
    last_beat_position: null,
    last_confidence: null,
    summary_status: state === 'FINISHED' ? 'READY' : 'NOT_REQUESTED',
    completion_outcome: state === 'FINISHED' ? selectedSectionCompletionOutcome() : null,
  };
}

function selectedSectionCompletionOutcome() {
  return {
    kind: 'SELECTED_SECTION',
    scope_kind: 'SELECTED_RANGE',
    summary_artifact_kind: 'SECTION_SUMMARY',
    playback_expected: true,
    summary_available: false,
  };
}

function practiceSummarySessionDetail() {
  return {
    ...practiceSessionDetail('STREAMING', 'MIDI'),
    session_id: 'summary-source-session',
    state: 'FINISHED',
    summary_status: 'READY',
  };
}

function practiceSessionSummaryPayload() {
  return {
    session_id: 'summary-source-session',
    summary_status: 'READY',
    summary_payload: {
      summary: 'Measure 2 needs another focused pass.',
      recommendations: ['Practice this spot slowly.'],
      metrics: {
        attempt_count: 3,
        completed_targets: 1,
        interrupted_attempts: 0,
        match_rate: 0.5,
        scorable_attempt_count: 3,
        scorable_target_completion_rate: 0.5,
        scorable_target_count: 2,
        scoring_coverage: 1,
        scoring_policy_version: 'practice-session-summary-scoring-v1',
        target_completion_rate: 0.5,
        target_count: 2,
      },
      attempts: [
        {
          action: 'hold',
          attempt_index: 1,
          attempt_uid: 'attempt-1',
          beat_position: 2,
          completion_status: 'COMPLETED',
          confidence: 0.35,
          correctness_scope: 'entry',
          evidence_profile: 'MIDI_STRICT',
          expected_group_id: 'entry-start',
          input_source: 'MIDI',
          measure_numbers: ['2'],
          render_note_ids: ['note-start'],
          resolution_reason: 'entry_mismatch',
          result: 'MISMATCH',
          scoring_included: true,
        },
      ],
      targets: [
        {
          expected_group_id: 'entry-start',
          measure_numbers: ['2'],
          render_note_ids: ['note-start'],
          attempt_count: 1,
          scorable_attempt_count: 1,
          interrupted_attempt_count: 0,
          matched_attempt_count: 0,
          partial_attempt_count: 0,
          mismatch_attempt_count: 1,
          completed: false,
          completion_status: 'incomplete',
          last_result: 'MISMATCH',
          last_confidence: 0.35,
        },
        {
          expected_group_id: 'entry-end',
          measure_numbers: ['2'],
          render_note_ids: ['note-end'],
          attempt_count: 1,
          scorable_attempt_count: 1,
          interrupted_attempt_count: 0,
          matched_attempt_count: 1,
          partial_attempt_count: 0,
          mismatch_attempt_count: 0,
          completed: true,
          completion_status: 'completed',
          last_result: 'MATCH',
          last_confidence: 0.94,
        },
      ],
      difficult_measures: [
        {
          measure_number: '2',
          target_count: 2,
          completed_target_count: 1,
          incomplete_target_count: 1,
          attempt_count: 2,
          scorable_attempt_count: 2,
          interrupted_attempt_count: 0,
          partial_attempt_count: 0,
          mismatch_attempt_count: 1,
          average_confidence: 0.65,
          difficulty_score: 7.5,
        },
      ],
    },
  };
}

function alignmentUpdate(): PracticeAlignmentUpdateMessage {
  return {
    protocol_version: 1,
    type: 'alignment.update',
    payload: {
      beat_position: 3,
      confidence: 0.94,
      alignment_confidence: 0.94,
      audio_confidence: 0.91,
      continuity_confidence: 0.95,
      visual_confidence: 1,
      timestamp_ms: 640,
      scope_completed: false,
      completion_reason: null,
      audio_active: true,
      input_rms: 0.12,
      input_peak: 0.32,
      input_health: {
        available: true,
        level: 'good',
        noise: 'good',
        confidence: 1,
      },
      match_state: 'matched',
      feature_confidence: 0.9,
      beat_delta: 0,
      stream_state: 'matched',
      frame_class: 'tonal',
      gate_reason: 'wait_for_note_event',
      queue_decision: 'evaluate',
      tonal_signal: true,
      onset_signal: true,
      spectral_flatness: 0.2,
      peak_prominence: 0.8,
      spectral_flux: 0.3,
      alignment_state: 'confirmed',
      continuity_state: 'stable',
      beat_velocity: null,
      validation_confidence: 0.93,
      input_weight: 1,
      input_policy_confidence: 0.94,
      decision: {
        action: 'advance',
        reason: 'stable_match',
        experience_state: 'following',
        display_anchor: {
          beat: 3,
          event_id: 'event-1',
          group_id: 'group-1',
          render_note_ids: ['note-1'],
        },
        confidence_summary: {
          visual: 1,
          alignment: 0.94,
          audio: 0.91,
          continuity: 0.95,
          validation: 0.93,
          input_policy: 0.94,
        },
      },
    },
  };
}

async function installRealtimeAudioMock(page: Page) {
  await page.addInitScript(() => {
    type PortHandler = ((event: MessageEvent<Float32Array>) => void) | null;

    class FakeAudioContext {
      sampleRate = 48000;
      currentTime = 0;
      state = 'running';
      destination = {};
      audioWorklet = {
        addModule: async () => undefined,
      };

      async resume() {
        this.state = 'running';
      }

      async close() {
        this.state = 'closed';
      }

      createMediaStreamSource() {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }

      createGain() {
        return {
          gain: { value: 0 },
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }
    }

    class FakeAudioWorkletNode {
      port: { onmessage: PortHandler };
      private intervalId: number;

      constructor() {
        this.port = { onmessage: null };
        this.intervalId = window.setInterval(() => {
          const samples = new Float32Array(1920);
          for (let index = 0; index < samples.length; index += 1) {
            samples[index] = Math.sin(index / 8) * 0.25;
          }
          this.port.onmessage?.(new MessageEvent('message', { data: samples }));
        }, 80);
      }

      connect() {
        return undefined;
      }

      disconnect() {
        window.clearInterval(this.intervalId);
      }
    }

    class FakeMediaRecorder {
      state: 'inactive' | 'recording' | 'paused' = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {
        this.state = 'recording';
      }

      pause() {
        this.state = 'paused';
      }

      resume() {
        this.state = 'recording';
      }

      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => new MediaStream(),
      },
    });
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
    window.AudioWorkletNode = FakeAudioWorkletNode as unknown as typeof AudioWorkletNode;
    window.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
  });
}

async function installMidiMock(page: Page) {
  await page.addInitScript(() => {
    type MidiMessageHandler = ((event: MIDIMessageEvent) => void) | null;
    type MidiTestWindow = Window & {
      __emitPracticeMidi?: (data: number[]) => void;
      __practiceMidiHandlerAttached?: () => boolean;
      __practiceMidiEmitCount?: number;
    };

    let midiMessageHandler: MidiMessageHandler = null;
    const midiInput = {
      id: 'practice-midi-input',
      manufacturer: 'NoteVerse',
      name: 'Practice Test MIDI',
      type: 'input',
      state: 'connected',
      connection: 'open',
      get onmidimessage() {
        return midiMessageHandler;
      },
      set onmidimessage(handler: MidiMessageHandler) {
        midiMessageHandler = handler;
      },
    };
    const inputs = new Map<string, typeof midiInput>([[midiInput.id, midiInput]]);

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => ({
        inputs,
        outputs: new Map(),
        onstatechange: null,
      }),
    });

    (window as MidiTestWindow).__practiceMidiEmitCount = 0;
    (window as MidiTestWindow).__practiceMidiHandlerAttached = () => midiMessageHandler !== null;
    (window as MidiTestWindow).__emitPracticeMidi = (data: number[]) => {
      (window as MidiTestWindow).__practiceMidiEmitCount =
        ((window as MidiTestWindow).__practiceMidiEmitCount ?? 0) + 1;
      midiMessageHandler?.({
        data: new Uint8Array(data),
      } as MIDIMessageEvent);
    };
  });
}

test('step-by-step practice streams microphone frames and reacts to alignment updates', async ({
  page,
}) => {
  let clientInitReceived = false;
  let pcmFrameCount = 0;
  let alignmentSent = false;

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await installRealtimeAudioMock(page);

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
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        mime_type: 'application/vnd.recordare.musicxml+xml',
        content: musicXml,
      }),
    })
  );
  await page.route('**/api/v1/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        session_id: sessionId,
        state: 'CREATED',
        ws_url: `/api/v1/practice/sessions/${sessionId}/stream`,
      }),
    });
  });
  await page.route(`**/api/v1/practice/sessions/${sessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(practiceSessionDetail()),
    })
  );
  await mockPracticeTargets(page);

  await page.routeWebSocket(`**/api/v1/practice/sessions/${sessionId}/stream`, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') {
        pcmFrameCount += 1;
        if (clientInitReceived && !alignmentSent) {
          alignmentSent = true;
          ws.send(JSON.stringify(alignmentUpdate()));
        }
        return;
      }

      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === 'client.init') {
        clientInitReceived = true;
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.ready',
          payload: { session_id: sessionId, state: 'STREAMING' },
        }));
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.armed',
          payload: {
            session_id: sessionId,
            input_health: {
              available: true,
              level: 'good',
              noise: 'good',
              confidence: 1,
            },
          },
        }));
      }
    });
  });

  await page.goto(`/zh/score/${scoreId}/practice`);

  const startButton = page.getByRole('button', { name: '开始练习' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect
    .poll(() => clientInitReceived)
    .toBe(true);
  await expect
    .poll(() => pcmFrameCount)
    .toBeGreaterThan(0);
  await expect(page.getByRole('status')).toContainText('正在实时跟随');
  await expect(page.getByRole('button', { name: '暂停练习' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '结束练习' })).toBeEnabled();
});

test('step-by-step practice can use MIDI input events instead of microphone frames', async ({
  page,
}) => {
  let clientInitInputSource: string | null = null;
  let createdInputSource: string | null = null;
  let midiNoteOnReceived = false;
  let binaryFrameCount = 0;
  let alignmentSent = false;

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await installRealtimeAudioMock(page);
  await installMidiMock(page);

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
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        mime_type: 'application/vnd.recordare.musicxml+xml',
        content: musicXml,
      }),
    })
  );
  await page.route('**/api/v1/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as { input_source?: string };
    createdInputSource = body.input_source ?? null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        session_id: sessionId,
        state: 'CREATED',
        ws_url: `/api/v1/practice/sessions/${sessionId}/stream`,
      }),
    });
  });
  await page.route(`**/api/v1/practice/sessions/${sessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(practiceSessionDetail('CREATED', 'MIDI')),
    })
  );
  await mockPracticeTargets(page);

  await page.routeWebSocket(`**/api/v1/practice/sessions/${sessionId}/stream`, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') {
        binaryFrameCount += 1;
        return;
      }

      const parsed = JSON.parse(message) as {
        type?: string;
        payload?: { input_source?: string; event_type?: string; note_number?: number };
      };
      if (parsed.type === 'client.init') {
        clientInitInputSource = parsed.payload?.input_source ?? null;
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.ready',
          payload: { session_id: sessionId, state: 'STREAMING', input_source: 'MIDI' },
        }));
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.armed',
          payload: {
            session_id: sessionId,
            input_health: {
              available: true,
              level: 'good',
              noise: 'good',
              confidence: 1,
            },
          },
        }));
      }
      if (
        parsed.type === 'client.midi_event' &&
        parsed.payload?.event_type === 'note_on' &&
        parsed.payload.note_number === 60
      ) {
        midiNoteOnReceived = true;
        if (!alignmentSent) {
          alignmentSent = true;
          ws.send(JSON.stringify(alignmentUpdate()));
        }
      }
    });
  });

  await page.goto(`/zh/score/${scoreId}/practice`);
  await page.getByRole('button', { name: '练习设置' }).click();
  await page.getByRole('button', { name: /MIDI 键盘/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  const startButton = page.getByRole('button', { name: '开始练习' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page.getByRole('status')).toContainText('可以开始，请弹奏第一个音符');
  await expect
    .poll(() => createdInputSource)
    .toBe('MIDI');
  await expect
    .poll(() => clientInitInputSource)
    .toBe('MIDI');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as Window & { __practiceMidiHandlerAttached?: () => boolean }).__practiceMidiHandlerAttached?.())
      )
    )
    .toBe(true);

  await page.evaluate(() => {
    (window as Window & { __emitPracticeMidi?: (data: number[]) => void }).__emitPracticeMidi?.([
      0x90,
      60,
      96,
    ]);
  });

  await expect
    .poll(() => midiNoteOnReceived)
    .toBe(true);
  await expect
    .poll(() => binaryFrameCount)
    .toBe(0);
  await expect(page.getByRole('status')).toContainText('正在实时跟随');
});

test('summary focuses problem positions without creating selected-section practice', async ({
  page,
}) => {
  let createdPracticeSession = false;

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);

  await page.route(`**/api/v1/practice/sessions/summary-source-session`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(practiceSummarySessionDetail()),
    })
  );
  await page.route(`**/api/v1/practice/sessions/summary-source-session/summary`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse(practiceSessionSummaryPayload()),
    })
  );
  await page.route(`**/api/v1/scores/${scoreId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        title: 'Practice Smoke Score',
        head_revision_id: 'newer-head-revision',
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
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        mime_type: 'application/vnd.recordare.musicxml+xml',
        content: musicXml,
      }),
    })
  );
  await page.route('**/api/v1/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    createdPracticeSession = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        session_id: sessionId,
        state: 'CREATED',
        ws_url: `/api/v1/practice/sessions/${sessionId}/stream`,
      }),
    });
  });

  await page.goto(`/zh/score/${scoreId}/practice/summary?sessionId=summary-source-session`);
  await expect(page.getByRole('heading', { name: '学习总结' })).toBeVisible();
  await expect(page.getByText('第 2 小节')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: '练此处' })).toHaveCount(0);

  await page.getByRole('button', { name: '定位' }).click();
  await expect(page).toHaveURL(
    `/zh/score/${scoreId}/practice/summary?sessionId=summary-source-session`
  );
  await expect
    .poll(() => createdPracticeSession)
    .toBe(false);
});

test('practice page creates selected-section scope from score note clicks', async ({
  page,
}) => {
  const createRequests: Array<{
    practice_scope?: unknown;
    progression_mode?: string;
    realtime_guidance?: string;
    evaluation_profile?: string;
    input_source?: string;
  }> = [];

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await installRealtimeAudioMock(page);

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
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        mime_type: 'application/vnd.recordare.musicxml+xml',
        content: selectableMusicXml,
      }),
    })
  );
  await mockPracticeTargets(page);
  await page.route('**/api/v1/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    createRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        session_id: sessionId,
        state: 'CREATED',
        ws_url: `/api/v1/practice/sessions/${sessionId}/stream`,
      }),
    });
  });
  await page.route(`**/api/v1/practice/sessions/${sessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        ...practiceSessionDetail(),
        practice_scope: createRequests.at(-1)?.practice_scope ?? null,
      }),
    })
  );

  await page.routeWebSocket(`**/api/v1/practice/sessions/${sessionId}/stream`, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') {
        return;
      }
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === 'client.init') {
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.ready',
          payload: { session_id: sessionId, state: 'STREAMING' },
        }));
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.armed',
          payload: {
            session_id: sessionId,
            input_health: {
              available: true,
              level: 'good',
              noise: 'good',
              confidence: 1,
            },
          },
        }));
        setTimeout(() => {
          const completedUpdate = alignmentUpdate();
          ws.send(JSON.stringify({
            ...completedUpdate,
            payload: {
              ...completedUpdate.payload,
              scope_completed: true,
              completion_reason: 'FINAL_EXPECTED_GROUP_MATCHED',
            },
          }));
          ws.send(JSON.stringify({
            protocol_version: 1,
            type: 'session.finished',
            payload: {
              state: 'FINISHED',
              completion_outcome: selectedSectionCompletionOutcome(),
            },
          }));
        }, 50);
      }
    });
  });

  await page.goto(`/zh/score/${scoreId}/practice`);

  const selectSectionButton = page.getByRole('button', { name: '选段' });
  await expect(selectSectionButton).toBeEnabled();
  await selectSectionButton.click();
  await expect(page.getByText('点击谱面上的音符，设置选段开始位置。')).toBeVisible();

  await page.locator('#select-start-note, [data-id="select-start-note"]').first().click();
  await expect(page.getByText('已选择开始位置。请点击谱面上的音符，设置结束位置。')).toBeVisible();
  await expect(page.locator('[data-practice-range-start-note-ids]')).toHaveAttribute(
    'data-practice-range-start-note-ids',
    'select-start-note'
  );

  await page.locator('#select-end-note, [data-id="select-end-note"]').first().click();
  await expect(page.getByText('已选择范围：第 1 小节。点击开始练习即可练习这个选段。')).toBeVisible();
  await expect(page.locator('[data-practice-range-end-note-ids]')).toHaveAttribute(
    'data-practice-range-end-note-ids',
    'select-end-note'
  );
  await expect(page.locator('[data-practice-range-note-ids]')).toHaveAttribute(
    'data-practice-range-note-ids',
    'select-start-note,middle-note,select-end-note'
  );

  await expect
    .poll(() => createRequests.at(-1)?.practice_scope)
    .toEqual({
      start_expected_group_id: 'entry-start',
      end_expected_group_id: 'entry-end',
      start_measure_number: '1',
      end_measure_number: '1',
    });
  const createRequestCountBeforeStart = createRequests.length;

  const startButton = page.getByRole('button', { name: '开始练习' });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(page.getByRole('heading', { name: '选段练习已完成' })).toBeVisible();
  const completionDialog = page.getByRole('dialog');
  await expect(completionDialog.getByRole('button', { name: '重弹一次' })).toBeVisible();
  await expect(completionDialog.getByRole('button', { name: '调整选段' })).toBeVisible();
  await expect(
    completionDialog.getByRole('button', { name: '开始完整演奏' })
  ).toHaveCount(0);
  await expect
    .poll(() => createRequests.length)
    .toBe(createRequestCountBeforeStart);
});

test('selected-section completion recovers from a missed session.finished websocket event', async ({
  page,
}) => {
  const createRequests: Array<{
    practice_scope?: unknown;
  }> = [];
  let recoverFinishedSession = false;

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await installRealtimeAudioMock(page);

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
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        mime_type: 'application/vnd.recordare.musicxml+xml',
        content: selectableMusicXml,
      }),
    })
  );
  await mockPracticeTargets(page);
  await page.route('**/api/v1/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    createRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        session_id: sessionId,
        state: 'CREATED',
        ws_url: `/api/v1/practice/sessions/${sessionId}/stream`,
      }),
    });
  });
  await page.route(`**/api/v1/practice/sessions/${sessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        ...practiceSessionDetail(recoverFinishedSession ? 'FINISHED' : 'CREATED'),
        practice_scope: createRequests.at(-1)?.practice_scope ?? null,
      }),
    })
  );

  await page.routeWebSocket(`**/api/v1/practice/sessions/${sessionId}/stream`, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') {
        return;
      }
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type === 'client.init') {
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.ready',
          payload: { session_id: sessionId, state: 'STREAMING' },
        }));
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.armed',
          payload: {
            session_id: sessionId,
            input_health: {
              available: true,
              level: 'good',
              noise: 'good',
              confidence: 1,
            },
          },
        }));
        setTimeout(() => {
          const completedUpdate = alignmentUpdate();
          recoverFinishedSession = true;
          ws.send(JSON.stringify({
            ...completedUpdate,
            payload: {
              ...completedUpdate.payload,
              scope_completed: true,
              completion_reason: 'FINAL_EXPECTED_GROUP_MATCHED',
            },
          }));
          ws.close();
        }, 50);
      }
    });
  });

  await page.goto(`/zh/score/${scoreId}/practice`);

  await page.getByRole('button', { name: '选段' }).click();
  await page.locator('#select-start-note, [data-id="select-start-note"]').first().click();
  await page.locator('#select-end-note, [data-id="select-end-note"]').first().click();

  await expect(page.getByRole('button', { name: '开始练习' })).toBeEnabled();
  await page.getByRole('button', { name: '开始练习' }).click();

  await expect(page.getByRole('status')).toContainText('正在保存练习结果');
  await expect(page.getByRole('heading', { name: '选段练习已完成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '调整选段' })).toBeVisible();
});

test('selected-section continuous practice creates a bounded microphone session', async ({
  page,
}) => {
  let createdScope: unknown = null;
  let createdInputSource: string | null = null;
  let createdProgressionMode: string | null = null;
  let createdRealtimeGuidance: string | null = null;
  let createdEvaluationProfile: string | null = null;
  let clientInitInputSource: string | null = null;

  await mockAuthenticatedSession(page);
  await mockRealtimeEvents(page);
  await installRealtimeAudioMock(page);

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
  await page.route(`**/api/v1/practice/scores/${scoreId}/revisions/${revisionId}/content`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        score_id: scoreId,
        revision_id: revisionId,
        mime_type: 'application/vnd.recordare.musicxml+xml',
        content: musicXml,
      }),
    })
  );
  await page.route('**/api/v1/practice/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as {
      evaluation_profile?: string;
      input_source?: string;
      practice_scope?: unknown;
      progression_mode?: string;
      realtime_guidance?: string;
    };
    createdEvaluationProfile = body.evaluation_profile ?? null;
    createdInputSource = body.input_source ?? null;
    createdProgressionMode = body.progression_mode ?? null;
    createdRealtimeGuidance = body.realtime_guidance ?? null;
    createdScope = body.practice_scope ?? null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        session_id: sessionId,
        state: 'CREATED',
        ws_url: `/api/v1/practice/sessions/${sessionId}/stream`,
      }),
    });
  });
  await page.route(`**/api/v1/practice/sessions/${sessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: apiResponse({
        ...practiceSessionDetail('CREATED', 'MICROPHONE'),
        progression_mode: 'CONTINUOUS',
        realtime_guidance: 'STATUS_ONLY',
        evaluation_profile: 'PERFORMANCE',
        practice_scope: {
          start_expected_group_id: 'entry-start',
          end_expected_group_id: 'entry-end',
          start_measure_number: '2',
          end_measure_number: '2',
        },
      }),
    })
  );
  await mockPracticeTargets(page);
  await page.routeWebSocket(`**/api/v1/practice/sessions/${sessionId}/stream`, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string') {
        return;
      }
      const parsed = JSON.parse(message) as {
        type?: string;
        payload?: { input_source?: string };
      };
      if (parsed.type === 'client.init') {
        clientInitInputSource = parsed.payload?.input_source ?? null;
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.ready',
          payload: { session_id: sessionId, state: 'STREAMING', input_source: 'MICROPHONE' },
        }));
        ws.send(JSON.stringify({
          protocol_version: 1,
          type: 'session.armed',
          payload: {
            session_id: sessionId,
            input_health: {
              available: true,
              level: 'good',
              noise: 'good',
              confidence: 1,
            },
          },
        }));
      }
    });
  });

  await page.goto(
    `/zh/score/${scoreId}/practice?practicePreset=CONTINUOUS_PLAY&practiceRevisionId=${revisionId}&practiceStartGroup=entry-start&practiceStartMeasure=2&practiceInputSource=MIDI&practiceEndGroup=entry-end&practiceEndMeasure=2`
  );
  await expect(page.getByText('选段练习')).toBeVisible();

  const startButton = page.getByRole('button', { name: '开始练习' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect
    .poll(() => createdScope)
    .toEqual({
      start_expected_group_id: 'entry-start',
      end_expected_group_id: 'entry-end',
      start_measure_number: '2',
      end_measure_number: '2',
    });
  await expect
    .poll(() => createdProgressionMode)
    .toBe('CONTINUOUS');
  await expect
    .poll(() => createdRealtimeGuidance)
    .toBe('STATUS_ONLY');
  await expect
    .poll(() => createdEvaluationProfile)
    .toBe('PERFORMANCE');
  await expect
    .poll(() => createdInputSource)
    .toBe('MICROPHONE');
  await expect
    .poll(() => clientInitInputSource)
    .toBe('MICROPHONE');
});

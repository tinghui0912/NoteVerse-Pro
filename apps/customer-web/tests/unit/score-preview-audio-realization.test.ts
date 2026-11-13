// @vitest-environment jsdom
import { VerovioScoreAdapter } from '@/lib/score/verovio';
import { parseMidi } from 'midi-file';
import * as Soundfont from 'soundfont-player';
import { beforeEach, expect, it, vi } from 'vitest';

import { LocalSoundfontAudioEngine } from '@/lib/score-preview/local-soundfont-audio-engine';
import { VerovioScorePreviewController } from '@/lib/score-preview/verovio-score-preview-controller';
import { decodePerformancePlan } from '@/lib/score/performance/plan';
import { createScorePerformanceTimeline } from '@/lib/score/performance/timeline';
import { readWrittenRealization } from '@/lib/score/performance/written-realization';
import { linearPlan } from '../support/performance-plan';
import { writtenRealizationSources as sources } from '../support/written-realization-sources';

vi.mock('soundfont-player', () => ({ instrument: vi.fn() }));
const planRequest = vi.hoisted(() => vi.fn<(
  options: Parameters<typeof import('@/generated/api').playbackPerformancePlanCreate>[0]
) => Promise<import('@/generated/api').PerformancePlanRead>>());
vi.mock('@/generated/api', async (original) => ({
  ...(await original<typeof import('@/generated/api')>()),
  playbackPerformancePlanCreate: async (options: Parameters<typeof import('@/generated/api').playbackPerformancePlanCreate>[0]) =>
    ({ data: await planRequest(options) }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(Soundfont.instrument).mockReset();
  vi.mocked(Soundfont.instrument).mockResolvedValue({
    play: vi.fn(),
    stop: vi.fn(),
  } as unknown as Soundfont.Player);
});
const context = () => ({
  currentTime: 0,
  state: 'suspended',
  resume: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
});

async function render(xml: string) {
  const adapter = new VerovioScoreAdapter();
  await adapter.loadMusicXml(xml, { toolkitOptions: { expandNever: true } });
  const midi = adapter.renderMidi();
  const timemap = adapter.renderTimemap();
  const raw = parseMidi(Uint8Array.from(atob(midi), (c) => c.charCodeAt(0)));
  return { adapter, midi, timemap, raw };
}

it('real piano has one static music stream and prepares/schedules local audio', async () => {
  const { adapter, midi, timemap, raw } = await render(sources.piano);
  const engine = new LocalSoundfontAudioEngine(
    context() as unknown as AudioContext
  );
  try {
    expect(raw.tracks).toHaveLength(2);
    const events = raw.tracks[1].filter(
      (e) => 'channel' in e && !('meta' in e)
    );
    expect(events.map((e) => e.type)).toEqual([
      'programChange',
      'noteOn',
      'noteOff',
      'noteOn',
      'noteOff',
    ]);
    expect(
      new Set(events.map((e) => ('channel' in e ? e.channel : null)))
    ).toEqual(new Set([0]));
    expect(events[0]).toMatchObject({
      type: 'programChange',
      programNumber: 0,
      deltaTime: 0,
    });
    const plan = decodePerformancePlan({
      ...linearPlan(4),
      musicxml: sources.piano,
    });
    const timeline = createScorePerformanceTimeline(plan, midi, timemap);
    await engine.prepare(timeline.instruments);
    for (const note of timeline.notes)
      engine.schedule(note, note.time, note.duration);
    const player = await vi.mocked(Soundfont.instrument).mock.results.at(-1)!
      .value;
    expect(player.play).toHaveBeenCalledTimes(2);
  } finally {
    adapter.dispose();
    await engine.close();
  }
});

it('real duet retains piano/violin in the timeline but local assets reject violin before loading', async () => {
  const { adapter, midi, timemap, raw } = await render(sources.duet);
  const engine = new LocalSoundfontAudioEngine(
    context() as unknown as AudioContext
  );
  try {
    expect(
      raw.tracks.map((track) =>
        track
          .filter((e) => e.type === 'programChange')
          .map((e) => e.programNumber)
      )
    ).toEqual([[], [0], [40]]);
    const timeline = createScorePerformanceTimeline(
      decodePerformancePlan({ ...linearPlan(4), musicxml: sources.duet }),
      midi,
      timemap
    );
    expect(
      timeline.notes.map((n) => [n.sourceTrackIdentity, n.instrument, n.midi])
    ).toEqual([
      [0, 'acoustic_grand_piano', 60],
      [1, 'violin', 60],
      [0, 'acoustic_grand_piano', 60],
      [1, 'violin', 60],
    ]);
    await expect(engine.prepare(timeline.instruments)).rejects.toThrow(
      'unsupported_score_preview_instrument: violin'
    );
    expect(Soundfont.instrument).not.toHaveBeenCalled();
  } finally {
    adapter.dispose();
    await engine.close();
  }
});

it('the default local engine rejects a real duet at load without installing SVG or playback', async () => {
  planRequest.mockResolvedValue({
    ...linearPlan(4),
    musicxml: sources.duet,
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      currentTime = 0;
      state = 'suspended';
      async resume() {}
      async close() {
        this.state = 'closed';
      }
    }
  );
  const container = document.createElement('div');
  const controller = new VerovioScorePreviewController({ container });
  try {
    await expect(controller.loadScore(sources.duet)).rejects.toThrow(
      'unsupported_score_preview_instrument: violin'
    );
    expect(container.childElementCount).toBe(0);
    expect(controller.getPlaybackSnapshot()).toMatchObject({
      state: 'IDLE',
      duration: 0,
      totalSteps: 0,
    });
    await expect(controller.play()).rejects.toThrow('not ready');
  } finally {
    controller.dispose();
    vi.unstubAllGlobals();
  }
});

it('real note dynamics fold into velocity, without an additional MIDI controller', async () => {
  const { adapter, midi, timemap, raw } = await render(sources.dynamics);
  try {
    expect(
      raw.tracks
        .flat()
        .filter((e) => e.type === 'noteOn')
        .map((e) => e.velocity)
    ).toEqual([27, 81]);
    expect(raw.tracks.flat().some((e) => e.type === 'controller')).toBe(false);
    expect(
      readWrittenRealization(midi, timemap).notes.map((n) => n.velocity)
    ).toEqual([27 / 127, 81 / 127]);
  } finally {
    adapter.dispose();
  }
});

it('characterizes direction dynamics separately: the renderer emits its default note velocities', async () => {
  const { adapter, raw } = await render(sources.directionDynamics);
  try {
    expect(
      raw.tracks
        .flat()
        .filter((e) => e.type === 'noteOn')
        .map((e) => e.velocity)
    ).toEqual([90, 90]);
    expect(raw.tracks.flat().some((e) => e.type === 'controller')).toBe(false);
  } finally {
    adapter.dispose();
  }
});

it('real pedal emits CC64 and is explicitly outside Browser note realization', async () => {
  const { adapter, midi, timemap, raw } = await render(sources.pedal);
  try {
    expect(
      raw.tracks
        .flat()
        .filter((e) => e.type === 'controller')
        .map((e) => [e.controllerType, e.value])
    ).toEqual([
      [64, 127],
      [64, 0],
    ]);
    expect(() => readWrittenRealization(midi, timemap)).toThrow(
      'unsupported_score_preview_midi_state: controller'
    );
  } finally {
    adapter.dispose();
  }
});

it('characterizes the microtonal renderer gap: quarter-sharp does not yield pitch bend', async () => {
  const { adapter, raw } = await render(sources.microtonal);
  try {
    expect(raw.tracks.flat().some((e) => e.type === 'pitchBend')).toBe(false);
    expect(
      raw.tracks
        .flat()
        .filter((e) => e.type === 'noteOn')
        .map((e) => e.noteNumber)
    ).toEqual([60, 60]);
  } finally {
    adapter.dispose();
  }
});

it('characterizes instrument assignment inside one part: one origin program, no instrument switch', async () => {
  const { adapter, raw } = await render(sources.multipleInstruments);
  try {
    const events = raw.tracks
      .flat()
      .filter((e) => 'channel' in e && !('meta' in e));
    expect(
      new Set(events.map((e) => ('channel' in e ? e.channel : null)))
    ).toEqual(new Set([0]));
    expect(events.filter((e) => e.type === 'programChange')).toEqual([
      { deltaTime: 0, channel: 0, type: 'programChange', programNumber: 0 },
    ]);
    expect(
      events.filter((e) => e.type === 'noteOn').map((e) => e.noteNumber)
    ).toEqual([60, 60]);
  } finally {
    adapter.dispose();
  }
});

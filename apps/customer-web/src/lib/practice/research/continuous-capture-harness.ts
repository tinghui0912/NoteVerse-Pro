import type { PracticeScope } from '../local-core/artifact';
import type { PracticeTempoSelection } from '../local-core/practice-tempo';

type ContinuousCaptureMidiEvent = {
  eventId: string;
  type: 'NOTE_ON' | 'NOTE_OFF' | 'CC';
  midiNote?: number;
  pitch?: string;
  velocity?: number;
  controller?: number;
  value?: number;
  captureClockMs: number;
  performanceTimeMs?: number;
};

export type ContinuousCaptureBundle = {
  schemaVersion: 1;
  artifact: 'continuous_research_capture_bundle';
  productAccuracyMetric: false;
  captureClock: {
    clockId: string;
    monotonicClock: 'performance.now';
    sampleBoundaryConvention: '[start,end)';
  };
  score: {
    practiceScoreArtifactPath: string;
    practiceScoreArtifactSha256: string;
  };
  practice: {
    tempoSelection: PracticeTempoSelection;
    scope: PracticeScope;
    completion: { kind: 'NATURAL' | 'MANUAL'; performanceTimeMs: number };
  };
  audio: {
    wavEncoding: 'PCM16';
    sampleRateHz: number;
    channelCount: number;
    sampleFrameCount: number;
    sha256?: string;
  };
  midi: {
    eventLogKind: 'BROWSER_CAPTURE_EVENT_LOG';
    sameTake: true;
    events: readonly ContinuousCaptureMidiEvent[];
  };
  segments: readonly {
    segmentId: string;
    sourcePerformanceStartSampleBoundary: number;
    sourcePerformanceEndSampleBoundary: number;
    sourceContextTailEndSampleBoundary: number;
    performanceStartMs: number;
    performanceEndMs: number;
  }[];
  status: 'SYNTHETIC_CAPTURE_SMOKE_ONLY' | 'REAL_CAPTURE_EXPORT';
};

export type DeviceMockedCaptureExport = {
  bundle: ContinuousCaptureBundle;
  wavBytes: Uint8Array;
  midiEventLogJson: string;
};

export function createSyntheticContinuousCaptureBundle(input: {
  practiceScoreArtifactPath: string;
  practiceScoreArtifactSha256: string;
  tempoSelection: PracticeTempoSelection;
  scope: PracticeScope;
  sampleRateHz?: number;
  preRollMs?: number;
  performanceDurationMs?: number;
  postRollMs?: number;
}): ContinuousCaptureBundle {
  const sampleRateHz = input.sampleRateHz ?? 48_000;
  const preRollMs = input.preRollMs ?? 2_000;
  const performanceDurationMs = input.performanceDurationMs ?? 1_000;
  const postRollMs = input.postRollMs ?? 2_000;
  const preRollSamples = msToSamples(preRollMs, sampleRateHz);
  const performanceSamples = msToSamples(performanceDurationMs, sampleRateHz);
  const postRollSamples = msToSamples(postRollMs, sampleRateHz);
  return {
    schemaVersion: 1,
    artifact: 'continuous_research_capture_bundle',
    productAccuracyMetric: false,
    captureClock: {
      clockId: 'synthetic-capture-clock',
      monotonicClock: 'performance.now',
      sampleBoundaryConvention: '[start,end)',
    },
    score: {
      practiceScoreArtifactPath: input.practiceScoreArtifactPath,
      practiceScoreArtifactSha256: input.practiceScoreArtifactSha256,
    },
    practice: {
      tempoSelection: input.tempoSelection,
      scope: input.scope,
      completion: { kind: 'MANUAL', performanceTimeMs: performanceDurationMs },
    },
    audio: {
      wavEncoding: 'PCM16',
      sampleRateHz,
      channelCount: 1,
      sampleFrameCount: preRollSamples + performanceSamples + postRollSamples,
    },
    midi: {
      eventLogKind: 'BROWSER_CAPTURE_EVENT_LOG',
      sameTake: true,
      events: [],
    },
    segments: [{
      segmentId: 'segment-0',
      sourcePerformanceStartSampleBoundary: preRollSamples,
      sourcePerformanceEndSampleBoundary: preRollSamples + performanceSamples,
      sourceContextTailEndSampleBoundary: preRollSamples + performanceSamples + postRollSamples,
      performanceStartMs: 0,
      performanceEndMs: performanceDurationMs,
    }],
    status: 'SYNTHETIC_CAPTURE_SMOKE_ONLY',
  };
}

export function createDeviceMockedCaptureExport(input: {
  practiceScoreArtifactPath: string;
  practiceScoreArtifactSha256: string;
  tempoSelection: PracticeTempoSelection;
  scope: PracticeScope;
  sampleRateHz?: number;
  preRollMs?: number;
  performanceDurationMs?: number;
  postRollMs?: number;
  midiEvents?: readonly ContinuousCaptureMidiEvent[];
}): DeviceMockedCaptureExport {
  const bundle = createSyntheticContinuousCaptureBundle(input);
  return {
    bundle,
    wavBytes: createPcm16WavBytes({
      sampleRateHz: bundle.audio.sampleRateHz,
      channelCount: bundle.audio.channelCount,
      sampleFrameCount: bundle.audio.sampleFrameCount,
    }),
    midiEventLogJson: `${JSON.stringify({
      schemaVersion: 1,
      artifact: 'continuous_browser_midi_capture_event_log',
      captureClockId: bundle.captureClock.clockId,
      events: input.midiEvents ?? bundle.midi.events,
    }, null, 2)}\n`,
  };
}

export function exportCaptureBundleJson(bundle: ContinuousCaptureBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function createPcm16WavBytes(input: {
  sampleRateHz: number;
  channelCount: number;
  sampleFrameCount: number;
}): Uint8Array {
  const dataBytes = input.sampleFrameCount * input.channelCount * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channelCount, true);
  view.setUint32(24, input.sampleRateHz, true);
  view.setUint32(28, input.sampleRateHz * input.channelCount * 2, true);
  view.setUint16(32, input.channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function msToSamples(ms: number, sampleRateHz: number): number {
  return Math.round((ms / 1000) * sampleRateHz);
}

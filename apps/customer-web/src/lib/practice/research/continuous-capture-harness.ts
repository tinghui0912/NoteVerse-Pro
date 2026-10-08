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

export function exportCaptureBundleJson(bundle: ContinuousCaptureBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function msToSamples(ms: number, sampleRateHz: number): number {
  return Math.round((ms / 1000) * sampleRateHz);
}

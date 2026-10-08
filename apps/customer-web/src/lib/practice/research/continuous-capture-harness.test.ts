import { describe, expect, it } from 'vitest';

import { createSyntheticContinuousCaptureBundle, exportCaptureBundleJson } from './continuous-capture-harness';

describe('Continuous research capture harness contract', () => {
  it('exports a syntactically valid synthetic bundle without counting as a real take', () => {
    const bundle = createSyntheticContinuousCaptureBundle({
      practiceScoreArtifactPath: 'score/practice-score-artifact.json',
      practiceScoreArtifactSha256: 'a'.repeat(64),
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
      scope: { kind: 'FULL' },
    });
    expect(bundle.status).toBe('SYNTHETIC_CAPTURE_SMOKE_ONLY');
    expect(bundle.productAccuracyMetric).toBe(false);
    expect(bundle.segments[0]).toMatchObject({
      sourcePerformanceStartSampleBoundary: 96_000,
      sourcePerformanceEndSampleBoundary: 144_000,
      sourceContextTailEndSampleBoundary: 240_000,
      performanceStartMs: 0,
      performanceEndMs: 1_000,
    });
    expect(JSON.parse(exportCaptureBundleJson(bundle)).artifact).toBe('continuous_research_capture_bundle');
  });
});

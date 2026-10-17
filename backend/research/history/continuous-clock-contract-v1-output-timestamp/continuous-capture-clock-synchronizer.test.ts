import { expect, it } from 'vitest';
import { ContinuousCaptureClockSynchronizer as Mapper } from './continuous-capture-clock-synchronizer';
import { continuousAcousticModelManifest } from '../acoustic-inference/continuous/acoustic-model-manifest';

for (const rate of [44100, 48000] as const) {
  it(`${rate} affine mapping uses absolute sample identity and <=half-sample quantization`, () => {
    const mapper = new Mapper(rate, 128, { contextTime: 2, performanceTime: 5000 });
    for (const time of [5000, 5000.01, 5500, 7000]) {
      const mapped = mapper.mapRuntimeTime(time);
      expect(Math.abs(mapped.quantizationErrorSamples)).toBeLessThanOrEqual(.5);
      expect(mapped.sourceSample).toBe(Math.round((2 + (time - 5000) / 1000) * rate) - 128);
    }
  });
  it(`${rate} witness drift fails the one-source-sample contract without moving the anchor`, () => {
    const mapper = new Mapper(rate, 0, { contextTime: 2, performanceTime: 5000 });
    const anchor = mapper.snapshot().anchor;
    expect(mapper.observeTimestamp({ contextTime: 3, performanceTime: 6000 }).withinOneSourceSample).toBe(true);
    expect(mapper.observeTimestamp({ contextTime: 3 + 2 / rate, performanceTime: 6000 }).withinOneSourceSample).toBe(false);
    expect(() => mapper.assertQualified()).toThrow('AUDIO_AND_RUNTIME_CLOCKS_EXCEED_ONE_SOURCE_SAMPLE');
    expect(mapper.snapshot().anchor).toBe(anchor);
  });
}
it('invalid rates/timestamps/backward commands fail closed', () => {
  expect(() => new Mapper(32000 as 48000, 0, { contextTime: 2, performanceTime: 5000 })).toThrow('INVALID_CAPTURE_CLOCK_ORIGIN');
  expect(() => new Mapper(48000, 0, { contextTime: NaN, performanceTime: 5000 })).toThrow('INVALID_AUDIO_OUTPUT_TIMESTAMP');
  const mapper = new Mapper(48000, 0, { contextTime: 2, performanceTime: 5000 }); mapper.mapRuntimeTime(5100);
  expect(() => mapper.mapRuntimeTime(5099)).toThrow('NONMONOTONIC_CAPTURE_CLOCK_COMMAND');
});
it('Continuous manifest identifies only the actual immutable robust artifact, never the historical model', () => {
  const manifest = continuousAcousticModelManifest('https://example.invalid/model');
  expect(manifest.asset).toMatchObject({ assetId: 'continuous-robust-browser', assetVersion: 'v1', expectedByteSize: 98689283,
    sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3' });
  expect(manifest).toMatchObject({ ortVersion: '1.20.1', provider: 'webgpu', automaticFallback: false,
    input: { name: 'audio', dtype: 'float32', shape: [1, 29120] }, decoder: { identity: 'A', onsetThreshold: .30, frameThreshold: .05 } });
  expect(JSON.stringify(manifest)).not.toContain('CRNN_note_F1');
});

export type CaptureClockAnchor = Readonly<{ contextTime: number; performanceTime: number }>;
export type CaptureClockMapping = Readonly<{
  runtimeTimeMs: number; sourceSample: number; exactSourceSample: number; quantizationErrorSamples: number;
}>;

export class CaptureClockContractError extends Error {
  readonly code = 'CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED';
  constructor(readonly observedErrorSamples: number, reason: string) { super(reason); this.name = 'CaptureClockContractError'; }
}

/** One frozen unit-slope affine anchor. No refitting, smoothing, score or transport authority. */
export class ContinuousCaptureClockSynchronizer {
  private readonly anchor: CaptureClockAnchor;
  private lastRuntime = -Infinity;
  private lastSource = -Infinity;
  private maximumObservedErrorSamples = 0;
  constructor(readonly sourceRateHz: 44100 | 48000, readonly sourceOriginContextFrame: number, anchor: CaptureClockAnchor) {
    this.validatePair(anchor);
    if (![44100, 48000].includes(sourceRateHz) || !Number.isSafeInteger(sourceOriginContextFrame) || sourceOriginContextFrame < 0) {
      throw new CaptureClockContractError(Infinity, 'INVALID_CAPTURE_CLOCK_ORIGIN');
    }
    this.anchor = Object.freeze({ ...anchor });
  }
  mapRuntimeTime(runtimeTimeMs: number): CaptureClockMapping {
    if (!Number.isFinite(runtimeTimeMs) || runtimeTimeMs < this.lastRuntime) throw new CaptureClockContractError(Infinity, 'NONMONOTONIC_CAPTURE_CLOCK_COMMAND');
    const exactSourceSample = (this.anchor.contextTime + (runtimeTimeMs - this.anchor.performanceTime) / 1000) * this.sourceRateHz - this.sourceOriginContextFrame;
    const sourceSample = Math.round(exactSourceSample);
    if (!Number.isSafeInteger(sourceSample) || sourceSample < 0 || sourceSample < this.lastSource) throw new CaptureClockContractError(Infinity, 'INVALID_CAPTURE_CLOCK_MAPPING');
    this.lastRuntime = runtimeTimeMs; this.lastSource = sourceSample;
    return Object.freeze({ runtimeTimeMs, sourceSample, exactSourceSample, quantizationErrorSamples: sourceSample - exactSourceSample });
  }
  /** A subsequent browser timestamp is a witness, never permission to move the anchor. */
  observeTimestamp(pair: CaptureClockAnchor): Readonly<{ errorSamples: number; errorMs: number; withinOneSourceSample: boolean }> {
    this.validatePair(pair);
    const predictedContext = this.anchor.contextTime + (pair.performanceTime - this.anchor.performanceTime) / 1000;
    const errorSamples = (pair.contextTime - predictedContext) * this.sourceRateHz;
    this.maximumObservedErrorSamples = Math.max(this.maximumObservedErrorSamples, Math.abs(errorSamples));
    return Object.freeze({ errorSamples, errorMs: errorSamples * 1000 / this.sourceRateHz, withinOneSourceSample: Math.abs(errorSamples) <= 1 });
  }
  assertQualified(): void {
    if (this.maximumObservedErrorSamples > 1) throw new CaptureClockContractError(this.maximumObservedErrorSamples, 'AUDIO_AND_RUNTIME_CLOCKS_EXCEED_ONE_SOURCE_SAMPLE');
  }
  snapshot() { return Object.freeze({ anchor: this.anchor, sourceRateHz: this.sourceRateHz, sourceOriginContextFrame: this.sourceOriginContextFrame,
    maximumObservedErrorSamples: this.maximumObservedErrorSamples }); }
  private validatePair(pair: CaptureClockAnchor): void {
    if (!Number.isFinite(pair.contextTime) || pair.contextTime <= 0 || !Number.isFinite(pair.performanceTime) || pair.performanceTime <= 0) {
      throw new CaptureClockContractError(Infinity, 'INVALID_AUDIO_OUTPUT_TIMESTAMP');
    }
  }
}

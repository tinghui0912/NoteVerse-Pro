import { PerformancePcmTimeline, validatePcmCaptureBlock, type PcmCaptureBlock } from '../audio-analysis/capture/performance-pcm-timeline';
import { XC4, assertXc4Identity, onlyFields, requireSourceRate } from './xc4-robust-runtime-contract';
import { Xc4StreamingResampler } from './xc4-robust-streaming-resampler';
import { xc4Window, owns, Xc4TargetRing, type Xc4Window } from './xc4-robust-window-planner';
import type { Xc4InferencePort } from './xc4-robust-worker-adapter';
import { AcousticSegmentMetadataLedger, MAX_OUTSTANDING_ACOUSTIC_WINDOWS, MAX_DIAGNOSTIC_WINDOWS,
  MAX_ACOUSTIC_EVENTS_PER_WINDOW, MODEL_INPUT_BYTES, retainDiagnostic } from './xc7-resource-policy';

export type Xc4State = 'CAPTURING_PREROLL' | 'READY_FOR_PERFORMANCE' | 'RUNNING' | 'TAIL_CAPTURE' | 'SEALED' | 'FAILED' | 'DISPOSED';
export type Xc4Observation = Readonly<{
  observationId: string; midiPitch: number; pitch: string; confidence: number; onsetScore: number; frameScore: number;
  performanceTimeMs: number; availabilityTimeMs: number; sourceSamplePosition: number;
  sourceSampleNumerator: number; sourceSampleDenominator: number; sourceSampleRateHz: number;
}>;
export type Xc4Publication = Readonly<{
  publicationId: string; engineeringIdentitySha256: string; window: Xc4Window;
  analyzedThroughPerformanceMs: number; availabilityTimeMs: number;
  observations: readonly Xc4Observation[];
}>;
export type Xc4Options = {
  engineeringOnly: true; sessionId: string; sourceSampleRateHz: number;
  mode: 'CAPTURE' | 'ALREADY_16K_TEST_INJECTION'; coefficientBytes?: Uint8Array;
  worker: Xc4InferencePort; performanceClock: { nowMs(): number };
  resourcePolicy?: 'XC7_BOUNDED';
  onAcousticPublication?: (publication: Xc4Publication) => void;
  onFailure?: (error: Error) => void;
};

/** Disabled internal boundary. No microphone acquisition, score, cursor or verdict dependency. */
export class Xc4RobustAcousticRuntime {
  readonly engineeringIdentityName = XC4.engineeringIdentityName;
  readonly engineeringIdentitySha256 = XC4.engineeringIdentitySha256;
  private currentState: Xc4State = 'CAPTURING_PREROLL';
  get state(): Xc4State { return this.currentState; }
  private readonly ring = new Xc4TargetRing();
  private readonly timeline: PerformancePcmTimeline | AcousticSegmentMetadataLedger;
  private sourceBase: number | null = null;
  private nextSource = 0;
  private performanceSourceOrigin = 0;
  private originTarget = 0;
  private terminalEndMs: number | undefined;
  private nextWindowIndex = 0;
  private queuedOwnedEndMs = 0;
  private outstanding = 0;
  private maxOutstanding = 0;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown;
  private lastPublicationClock = -Infinity;
  private readonly publications: Xc4Publication[] = [];
  private readonly timings: Readonly<Record<string, number>>[] = [];
  private delivering = false;
  private readonly counters = { totalWindowsQueued: 0, totalWindowsStarted: 0, totalWindowsPublished: 0,
    totalObservationsPublished: 0, totalBackpressureFailures: 0, publicationDeliveryAttempts: 0 };

  private constructor(private readonly options: Xc4Options, private readonly filter: Xc4StreamingResampler | null) {
    this.timeline = options.resourcePolicy === 'XC7_BOUNDED' ? new AcousticSegmentMetadataLedger() : new PerformancePcmTimeline();
  }

  static async create(options: Xc4Options): Promise<Xc4RobustAcousticRuntime> {
    onlyFields(options, ['engineeringOnly', 'sessionId', 'sourceSampleRateHz', 'mode', 'coefficientBytes', 'worker', 'performanceClock',
      'resourcePolicy', 'onAcousticPublication', 'onFailure']);
    if (options.resourcePolicy !== undefined && options.resourcePolicy !== 'XC7_BOUNDED') throw new Error('XC7_RESOURCE_POLICY');
    options = Object.freeze({ ...options, coefficientBytes: options.coefficientBytes ? new Uint8Array(options.coefficientBytes) : undefined,
      performanceClock: Object.freeze({ nowMs: options.performanceClock.nowMs.bind(options.performanceClock) }) });
    if (options.engineeringOnly !== true || !/^[A-Za-z0-9_.-]{1,96}$/.test(options.sessionId)) throw new Error('XC4_INTERNAL_ENGINEERING_ONLY');
    requireSourceRate(options.sourceSampleRateHz, options.mode);
    await assertXc4Identity();
    const filter = options.mode === 'CAPTURE' ? await Xc4StreamingResampler.create(options.coefficientBytes ?? new Uint8Array()) : null;
    return new Xc4RobustAcousticRuntime(options, filter);
  }

  append(block: PcmCaptureBlock): void {
    onlyFields(block, ['sourceSampleRateHz', 'sourceStartSampleIndex', 'sourceEndSampleIndex', 'samples']);
    this.requireHealthy();
    if (!['CAPTURING_PREROLL', 'READY_FOR_PERFORMANCE', 'RUNNING', 'TAIL_CAPTURE'].includes(this.state)) throw new Error('XC4_CAPTURE_STATE');
    validatePcmCaptureBlock(block);
    if (block.sourceSampleRateHz !== this.options.sourceSampleRateHz
      || !Number.isSafeInteger(block.sourceStartSampleIndex) || !Number.isSafeInteger(block.sourceEndSampleIndex)
      || block.samples.some(v => !Number.isFinite(v))) throw new Error('XC4_CAPTURE_IDENTITY');
    if (this.sourceBase === null) { this.sourceBase = block.sourceStartSampleIndex; this.nextSource = this.sourceBase; }
    if (block.sourceStartSampleIndex !== this.nextSource) throw new Error('XC4_NONCHRONOLOGICAL_SOURCE');
    try { this.appendRetainedPcm(block); }
    catch (error) { this.fail(error); throw error; }
  }

  private appendRetainedPcm(block: PcmCaptureBlock): void {
    if (this.sourceBase === null) throw new Error('XC4_CAPTURE_IDENTITY');
    if (this.state === 'RUNNING') this.timeline.appendRunningPcm(block);
    if (this.state === 'TAIL_CAPTURE') this.timeline.appendContextTail(block);
    this.nextSource = block.sourceEndSampleIndex;
    // Feed bounded slices so a large injected block cannot overwrite a ready queued input.
    for (let offset = 0; offset < block.samples.length; offset += 2048) {
      const source = block.samples.subarray(offset, offset + 2048);
      this.ring.append(this.filter ? this.filter.push(source) : source);
      this.planAvailable();
    }
    if (this.state === 'CAPTURING_PREROLL' || this.state === 'READY_FOR_PERFORMANCE') {
      const origin = (this.nextSource - this.sourceBase) * 16000 / this.options.sourceSampleRateHz;
      const first = xc4Window(0, origin).startSample;
      this.currentState = first >= Math.max(this.filter?.firstFullyRealOutputIndex ?? 0, this.ring.firstRetained)
        ? 'READY_FOR_PERFORMANCE' : 'CAPTURING_PREROLL';
    }
  }

  startPerformance(input: { sourceStartSampleIndex: number }): void {
    onlyFields(input, ['sourceStartSampleIndex']); this.requireHealthy();
    if (this.state !== 'READY_FOR_PERFORMANCE' || input.sourceStartSampleIndex !== this.nextSource || this.sourceBase === null) {
      throw new Error('XC4_REAL_PREROLL_REQUIRED');
    }
    this.performanceSourceOrigin = input.sourceStartSampleIndex;
    this.originTarget = (this.performanceSourceOrigin - this.sourceBase) * 16000 / this.options.sourceSampleRateHz;
    this.timeline.beginRunningSegment({ performanceStartMs: 0, sourceSampleRateHz: this.options.sourceSampleRateHz,
      sourceStartSampleIndex: this.performanceSourceOrigin });
    this.currentState = 'RUNNING'; this.planAvailable();
  }

  stopPerformance(input: { sourceEndSampleIndex: number }): void {
    onlyFields(input, ['sourceEndSampleIndex']); this.requireHealthy();
    if (this.state !== 'RUNNING' || input.sourceEndSampleIndex !== this.nextSource) throw new Error('XC4_STOP_IDENTITY');
    this.terminalEndMs = (this.nextSource - this.performanceSourceOrigin) / this.options.sourceSampleRateHz * 1000;
    this.currentState = 'TAIL_CAPTURE';
    try { this.planAvailable(); }
    catch (error) { this.fail(error); throw error; }
  }

  async seal(): Promise<void> {
    this.requireHealthy();
    if (this.state !== 'TAIL_CAPTURE' || this.queuedOwnedEndMs !== this.terminalEndMs) throw new Error('XC4_REAL_TAIL_CONTEXT_REQUIRED');
    await this.drain(); this.timeline.sealRunningSegment(); this.currentState = 'SEALED';
  }

  async drain(): Promise<void> { await this.chain; this.requireHealthy(); }

  async dispose(): Promise<void> {
    if (this.state === 'DISPOSED') return;
    if (this.delivering) throw new Error('XC7_PUBLICATION_CALLBACK_REENTRANCY');
    // Failed sessions discard queued results; a noncancellable active run is drained before release.
    await this.chain;
    try { await this.options.worker.dispose(); }
    finally { this.currentState = 'DISPOSED'; }
  }

  async resetPreRoll(): Promise<Xc4RobustAcousticRuntime> {
    this.requireHealthy();
    if (!['CAPTURING_PREROLL', 'READY_FOR_PERFORMANCE'].includes(this.state) || this.outstanding) throw new Error('XC4_RESET_REQUIRES_UNSTARTED_CAPTURE');
    this.currentState = 'DISPOSED';
    return Xc4RobustAcousticRuntime.create(this.options);
  }

  snapshot() {
    return { state: this.state, engineeringIdentityName: this.engineeringIdentityName,
      engineeringIdentitySha256: this.engineeringIdentitySha256,
      publications: [...this.publications], timings: [...this.timings], outstandingDepth: this.outstanding,
      maxOutstandingDepth: this.maxOutstanding, queuedOwnedEndMs: this.queuedOwnedEndMs,
      sourceSampleRateHz: this.options.sourceSampleRateHz, sourceBase: this.sourceBase,
      performanceSourceOrigin: this.performanceSourceOrigin, nextSourceSampleIndex: this.nextSource,
      performanceSegments: this.timeline.snapshot(), error: this.failure ? String(this.failure) : null,
      counters: { ...this.counters }, resources: { policy: this.options.resourcePolicy ?? 'HISTORICAL_FULL_RETENTION',
        timelinePcmBytes: this.timeline instanceof AcousticSegmentMetadataLedger ? 0 : null,
        targetRingBytes: 65536 * 4, outstandingInputBytes: this.outstanding * MODEL_INPUT_BYTES,
        maximumOutstandingInputBytes: this.options.resourcePolicy ? MAX_OUTSTANDING_ACOUSTIC_WINDOWS * MODEL_INPUT_BYTES : null,
        maximumDiagnosticWindows: this.options.resourcePolicy ? MAX_DIAGNOSTIC_WINDOWS : null } };
  }

  /** Capture-side failures invalidate any active/queued results before they can publish. */
  failSession(error: Error): void {
    if (this.delivering) throw new Error('XC7_PUBLICATION_CALLBACK_REENTRANCY');
    this.fail(error);
  }

  private fail(error: unknown): void {
    if (this.failure || this.state === 'DISPOSED') return;
    this.failure = error instanceof Error ? error : new Error(String(error)); this.currentState = 'FAILED';
    try { this.options.onFailure?.(this.failure as Error); }
    catch { /* Preserve the original session error even if cleanup itself fails. */ }
  }

  private requireHealthy(): void {
    if (this.delivering) throw new Error('XC7_PUBLICATION_CALLBACK_REENTRANCY');
    if (this.failure) throw this.failure;
    if (this.state === 'DISPOSED') throw new Error('XC4_RUNTIME_DISPOSED');
  }

  private planAvailable(): void {
    if (this.state !== 'RUNNING' && this.state !== 'TAIL_CAPTURE') return;
    while (this.terminalEndMs === undefined || this.nextWindowIndex * 600 < this.terminalEndMs) {
      const window = xc4Window(this.nextWindowIndex, this.originTarget, this.terminalEndMs);
      if (window.endSample > this.ring.length) return;
      if (window.startSample < (this.filter?.firstFullyRealOutputIndex ?? 0)) throw new Error('XC4_REAL_PREROLL_REQUIRED');
      // Check before allocating/copying the fifth input, never drop or skip ownership.
      if (this.options.resourcePolicy && this.outstanding >= MAX_OUTSTANDING_ACOUSTIC_WINDOWS) {
        this.counters.totalBackpressureFailures++;
        const error = new Error('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED'); this.fail(error); throw error;
      }
      const pcm = this.ring.extract(window.startSample, window.endSample);
      const queuedAt = this.clock(), depth = ++this.outstanding;
      this.maxOutstanding = Math.max(this.maxOutstanding, depth);
      this.counters.totalWindowsQueued++;
      this.nextWindowIndex++; this.queuedOwnedEndMs = window.ownedEndMs;
      this.chain = this.chain.then(async () => {
        try {
          if (this.failure) return;
          const inferenceStart = this.clock();
          this.counters.totalWindowsStarted++;
          const result = await this.options.worker.run({ window, pcm });
          if (this.failure) return;
          const inferenceEnd = this.clock();
          if (this.options.resourcePolicy && result.events.length > MAX_ACOUSTIC_EVENTS_PER_WINDOW) throw new Error('XC7_WORKER_EVENT_BOUND');
          // Window indices are unique; only same-window duplicate detection needs storage.
          const observationIds = new Set<string>();
          if (inferenceStart < queuedAt || inferenceEnd < inferenceStart) throw new Error('XC4_NONMONOTONIC_AVAILABILITY');
          const observations = result.events.filter(e => owns(window, e.onsetTime.ms)).map(e => {
            const targetSample = e.onsetTime.sampleIndex;
            if (!Number.isInteger(targetSample) || targetSample === undefined || !Number.isFinite(e.confidence)
              || !Number.isFinite(e.onsetScore) || !Number.isFinite(e.frameScore)
              || !Number.isInteger(e.midiPitch) || e.midiPitch < 21 || e.midiPitch > 108
              || Math.abs(e.onsetTime.ms - (targetSample - this.originTarget) / 16) > 1e-6) throw new Error('XC4_EVENT_IDENTITY_DRIFT');
            const numerator = this.sourceBase! * 16000 + targetSample * this.options.sourceSampleRateHz;
            if (!Number.isSafeInteger(numerator)) throw new Error('XC4_SOURCE_COORDINATE_OVERFLOW');
            const observationId = `${this.options.sessionId}:${window.windowIndex}:${e.midiPitch}:${targetSample}`;
            if (observationIds.has(observationId)) throw new Error('XC4_DUPLICATE_OBSERVATION');
            observationIds.add(observationId);
            if (this.options.resourcePolicy && (typeof e.pitch !== 'string' || e.pitch.length > 8)) throw new Error('XC7_PITCH_LABEL_BOUND');
            return Object.freeze({ observationId, midiPitch: e.midiPitch, pitch: e.pitch, confidence: e.confidence,
              onsetScore: e.onsetScore, frameScore: e.frameScore, performanceTimeMs: e.onsetTime.ms,
              availabilityTimeMs: inferenceEnd, sourceSamplePosition: numerator / 16000,
              sourceSampleNumerator: numerator, sourceSampleDenominator: 16000,
              sourceSampleRateHz: this.options.sourceSampleRateHz });
          });
          const availability = this.clock();
          if (availability < this.lastPublicationClock || availability < inferenceStart) throw new Error('XC4_NONMONOTONIC_AVAILABILITY');
          this.lastPublicationClock = availability;
          // Acoustic publication follows in-worker decoding, IPC and local projection, never a score verdict.
          const published = observations.map(e => Object.freeze({ ...e, availabilityTimeMs: availability }));
          const publication = Object.freeze({ publicationId: `${this.options.sessionId}:${window.windowIndex}`,
            engineeringIdentitySha256: XC4.engineeringIdentitySha256, window,
            analyzedThroughPerformanceMs: previousFloat(window.ownedEndMs), availabilityTimeMs: availability,
            observations: Object.freeze(published) });
          if (this.options.onAcousticPublication) {
            this.counters.publicationDeliveryAttempts++;
            this.delivering = true;
            try {
              const returned: unknown = this.options.onAcousticPublication(publication);
              if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
                Promise.resolve(returned).catch(() => {});
                throw new Error('XC7_PUBLICATION_CALLBACK_MUST_BE_SYNCHRONOUS');
              }
            } catch (error) { throw new Error('ACOUSTIC_PUBLICATION_SINK_FAILED', { cause: error }); }
            finally { this.delivering = false; }
          }
          if (this.failure) return;
          this.counters.totalWindowsPublished++; this.counters.totalObservationsPublished += published.length;
          if (this.options.resourcePolicy) retainDiagnostic(this.publications, publication); else this.publications.push(publication);
          const readySourceEnd = this.sourceBase! + (this.filter
            ? Math.floor(((window.endSample - 1) * 441 + 4410) / 160) + 1 : window.endSample);
          const readyTime = (readySourceEnd - this.performanceSourceOrigin) / this.options.sourceSampleRateHz * 1000;
          const timing = Object.freeze({ windowIndex: window.windowIndex, queuedAtMs: queuedAt,
            inferenceStartMs: inferenceStart, inferenceEndMs: inferenceEnd, acousticPublicationTimeMs: availability,
            captureReadySourceEndSampleIndex: readySourceEnd, captureReadyPerformanceTimeMs: readyTime,
            captureReadyToPublicationMs: availability - readyTime,
            oldestOwnedSourceTimeToPublicationMs: availability - window.ownedStartMs,
            queueDelayMs: inferenceStart - queuedAt, outstandingDepthAtEnqueue: depth,
            workerInferenceMs: result.inferenceMs, workerDecodeMs: result.decodeMs,
            workerActualSessionRunCount: result.actualSessionRunCount ?? 0 });
          if (this.options.resourcePolicy) retainDiagnostic(this.timings, timing); else this.timings.push(timing);
        } catch (error) { this.fail(error); }
        finally { this.outstanding--; }
      });
    }
  }

  private clock(): number {
    const value = this.options.performanceClock.nowMs();
    if (!Number.isFinite(value)) throw new Error('XC4_INVALID_PERFORMANCE_CLOCK');
    return value;
  }
}

function previousFloat(value: number): number {
  const number = new Float64Array([value]), bits = new BigUint64Array(number.buffer);
  bits[0] -= BigInt(1); return number[0];
}

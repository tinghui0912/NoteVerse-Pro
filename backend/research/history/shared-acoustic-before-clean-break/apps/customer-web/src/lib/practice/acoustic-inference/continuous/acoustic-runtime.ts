import type { PcmCaptureBlock } from '../../audio-analysis/capture/performance-pcm-timeline';
import { ACOUSTIC_MODEL as M, AcousticAnalysisError, assertAcousticIdentity, fail, onlyFields, safeIndex } from './model-contract';
import { ContinuousSourceAdapter } from './source-adapter';
import { AcousticPcmRing, planWindow, type AcousticSegment, type AcousticWindow } from './window-planner';
import type { AcousticInferencePort } from './inference-types';
import { acousticPublication, deliverPublication, type AcousticPublicationSink } from './publication';
import { ACOUSTIC_RESOURCES as R, retainCompact, type AcousticWindowDiagnostic } from './resource-policy';

export type AcousticRuntimeOptions = Readonly<{
  sessionDomainId: string; sourceDomainId: string; sourceSampleRateHz: number;
  coefficientBytes: Uint8Array; worker: AcousticInferencePort;
  nowAvailabilityMs(): number; onPublication: AcousticPublicationSink; onFailure?(error: Error): void;
}>;
export type AcousticAnalysisState = 'PREROLL' | 'RUNNING' | 'PAUSED' | 'DRAINING' | 'SEALED' | 'FAILED' | 'DISPOSED';

/** Bounded audio-only scheduler. All transport boundaries are supplied externally. */
export class ContinuousAcousticRuntime {
  private state: AcousticAnalysisState = 'PREROLL';
  private readonly ring = new AcousticPcmRing();
  private readonly pendingSegments: AcousticSegment[] = [];
  private readonly diagnostics: AcousticWindowDiagnostic[] = [];
  private active: AcousticSegment | null = null;
  private sourceBase: number | null = null;
  private nextSource = 0;
  private nextSegment = 0;
  private lastPerformanceEnd = 0;
  private terminalTime: number | null = null;
  private outstanding = 0;
  private chain = Promise.resolve();
  private failure: Error | null = null;
  private delivering = false;
  private cleanup: (() => void) | null = null;
  private detachWorker: (() => void) | undefined;
  private lastClock = -Infinity;
  private lastFrontier = -Infinity;
  private readonly counts = { windowsQueued: 0, windowsStarted: 0, windowsPublished: 0, observationsPublished: 0,
    peakOutstanding: 0, backpressureFailures: 0, segmentsStarted: 0, segmentsDrained: 0, terminalPublications: 0 };
  private constructor(private readonly options: AcousticRuntimeOptions, private readonly adapter: ContinuousSourceAdapter) {
    this.detachWorker = options.worker.onFailure?.(error => this.failAnalysis(error));
  }

  static async create(options: AcousticRuntimeOptions): Promise<ContinuousAcousticRuntime> {
    onlyFields(options, ['sessionDomainId', 'sourceDomainId', 'sourceSampleRateHz', 'coefficientBytes', 'worker', 'nowAvailabilityMs', 'onPublication', 'onFailure']);
    for (const id of [options.sessionDomainId, options.sourceDomainId]) if (!id || id.length > 192) fail('INVALID_ACOUSTIC_DOMAIN');
    await assertAcousticIdentity();
    const adapter = await ContinuousSourceAdapter.create(options.sourceSampleRateHz, options.coefficientBytes);
    return new ContinuousAcousticRuntime(Object.freeze({ ...options, coefficientBytes: new Uint8Array() }), adapter);
  }
  append(block: PcmCaptureBlock): void {
    this.guard();
    try {
      onlyFields(block, ['sourceSampleRateHz', 'sourceStartSampleIndex', 'sourceEndSampleIndex', 'samples']);
      safeIndex(block.sourceStartSampleIndex); safeIndex(block.sourceEndSampleIndex);
      if (block.sourceSampleRateHz !== this.adapter.rate || !(block.samples instanceof Float32Array)
        || block.samples.length > R.maxSourceBlockSamples || block.samples.length !== block.sourceEndSampleIndex - block.sourceStartSampleIndex
        || block.samples.some(v => !Number.isFinite(v))) fail('INVALID_ACOUSTIC_CAPTURE_BLOCK');
      if (this.sourceBase === null) { this.sourceBase = block.sourceStartSampleIndex; this.nextSource = this.sourceBase; }
      if (block.sourceStartSampleIndex !== this.nextSource) fail('NONCHRONOLOGICAL_ACOUSTIC_SOURCE');
      this.nextSource = block.sourceEndSampleIndex;
      this.ring.append(this.adapter.push(block.samples));
      this.planAvailable();
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  /** Called at the exact source boundary after splitting the capture block. */
  beginSegment(performanceStartMs: number): void {
    this.guard();
    try {
      if (!['PREROLL', 'PAUSED'].includes(this.state) || this.active || this.sourceBase === null
        || performanceStartMs !== this.lastPerformanceEnd) fail('INVALID_ACOUSTIC_SEGMENT_START');
      if (this.pendingSegments.length >= R.maxPendingSegments) fail('ACOUSTIC_SEGMENT_LIMIT_EXCEEDED');
      const originTarget = (this.nextSource - this.sourceBase) * 16000 / this.adapter.rate;
      const segment: AcousticSegment = { index: this.nextSegment++, sourceStart: this.nextSource,
        performanceStartMs, originTarget, nextWindow: 0, queuedEndMs: performanceStartMs };
      const first = planWindow(segment, this.counts.windowsQueued)!;
      if (first.startSample < Math.max(10, this.ring.firstRetained)) fail('ACOUSTIC_PREROLL_NOT_READY');
      this.pendingSegments.push(segment); this.active = segment; this.state = 'RUNNING'; this.counts.segmentsStarted++;
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  endSegment(performanceEndMs: number): void {
    this.guard();
    try {
      if (!this.active || this.state !== 'RUNNING') fail('ACOUSTIC_SEGMENT_NOT_RUNNING');
      const actualEnd = this.active.performanceStartMs + (this.nextSource - this.active.sourceStart) / this.adapter.rate * 1000;
      // Clock/sample quantization is bounded to one source sample, never a score tolerance.
      if (!Number.isFinite(performanceEndMs) || Math.abs(actualEnd - performanceEndMs) > 1000 / this.adapter.rate
        || performanceEndMs < this.active.queuedEndMs) fail('ACOUSTIC_SEGMENT_END_MISMATCH');
      this.active.sourceEnd = this.nextSource; this.active.performanceEndMs = performanceEndMs;
      this.lastPerformanceEnd = performanceEndMs; this.active = null; this.state = 'PAUSED'; this.planAvailable();
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  requestTerminal(performanceEndMs: number): void {
    this.guard();
    try {
      if (this.state === 'PREROLL' && performanceEndMs === 0 && this.nextSegment === 0) {
        this.terminalTime = 0; this.state = 'DRAINING'; return;
      }
      if (this.state === 'RUNNING') this.endSegment(performanceEndMs);
      if (this.state !== 'PAUSED' || performanceEndMs !== this.lastPerformanceEnd) fail('INVALID_ACOUSTIC_TERMINAL');
      this.terminalTime = performanceEndMs; this.state = 'DRAINING'; this.planAvailable();
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  get tailReady(): boolean { return this.state === 'DRAINING' && this.pendingSegments.length === 0; }
  /** Read-only readiness; never probe by beginning a semantic segment. */
  get prerollReady(): boolean {
    if (!['PREROLL', 'PAUSED'].includes(this.state) || this.sourceBase === null || this.failure) return false;
    const segment: AcousticSegment = { index: this.nextSegment, sourceStart: this.nextSource,
      performanceStartMs: this.lastPerformanceEnd, originTarget: (this.nextSource - this.sourceBase) * 16000 / this.adapter.rate,
      nextWindow: 0, queuedEndMs: this.lastPerformanceEnd };
    // An immediate Pause/Stop shortens the first ownership region, moving the
    // fixed-size input farther into real past. Readiness covers that whole range.
    const earliestInputStart = segment.originTarget - (M.inputMs - M.futureMs) * 16;
    return earliestInputStart >= Math.max(10, this.ring.firstRetained);
  }
  attachCaptureCleanup(cleanup: () => void): () => void {
    this.guard();
    if (this.cleanup) fail('ACOUSTIC_CAPTURE_ALREADY_ATTACHED');
    this.cleanup = cleanup;
    return () => { this.cleanup = null; };
  }
  async drain(): Promise<void> { await this.chain; this.guard(); }
  async seal(): Promise<void> {
    this.guard();
    if (!this.tailReady) fail('REAL_ACOUSTIC_TAIL_REQUIRED');
    await this.drain();
    try {
      const time = this.terminalTime!;
      this.deliver(Object.freeze({ publicationId: `${this.options.sourceDomainId}:terminal`, sessionDomainId: this.options.sessionDomainId,
        analyzedThroughPerformanceMs: time, availabilityTimeMs: this.clock(), observations: Object.freeze([]) }));
      this.counts.terminalPublications++; this.state = 'SEALED';
    } catch (error) { this.failAnalysis(error); throw error; }
  }
  failAnalysis(error: unknown): void {
    if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY');
    if (this.failure || this.state === 'DISPOSED' || this.state === 'SEALED') return;
    this.failure = error instanceof Error ? error : new AcousticAnalysisError(String(error));
    this.state = 'FAILED'; this.pendingSegments.length = 0; this.active = null;
    try { this.cleanup?.(); } catch { /* Failure remains terminal even if cleanup fails. */ }
    try { this.options.onFailure?.(this.failure); } catch { /* Preserve the causal failure. */ }
  }
  async dispose(): Promise<void> {
    if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY');
    if (this.state === 'DISPOSED') return;
    // Stop queued/active results from becoming evidence before disposing the port.
    this.state = 'DISPOSED'; this.pendingSegments.length = 0; this.active = null;
    this.cleanup?.(); this.cleanup = null; this.detachWorker?.(); this.detachWorker = undefined;
    await this.options.worker.dispose();
    await this.chain;
  }
  snapshot() {
    return Object.freeze({ state: this.state, failureCode: this.failure?.message ?? null,
      acousticCoreIdentitySha256: M.identitySha256, sourceAdapterIdentitySha256: this.adapter.identitySha256,
      sourceRateHz: this.adapter.rate, sourceBase: this.sourceBase, nextSourceSampleIndex: this.nextSource,
      activeSegment: this.active ? Object.freeze({ index: this.active.index, sourceStart: this.active.sourceStart,
        performanceStartMs: this.active.performanceStartMs }) : null,
      pendingSegments: this.pendingSegments.length, outstanding: this.outstanding,
      analyzedThroughPerformanceMs: this.lastFrontier, counts: Object.freeze({ ...this.counts }),
      diagnostics: Object.freeze([...this.diagnostics]), resources: Object.freeze({
        sessionPcmBytes: 0, sourceAdapterBytes: this.adapter.storageBytes(), targetRingBytes: R.targetRingSamples * 4,
        outstandingInputBytes: this.outstanding * R.inputBytes, maximumOutstandingInputBytes: 4 * R.inputBytes,
        retainedPublicationEvents: 0, diagnosticWindowLimit: R.diagnosticWindows,
        // Compact numeric metadata only; conservative planning estimate, not total JS/GPU heap.
        compactDiagnosticsPlanningBytes: R.diagnosticWindows * 512,
      }) });
  }
  private guard(): void {
    if (this.delivering) fail('ACOUSTIC_PUBLICATION_REENTRANCY');
    if (this.failure) throw this.failure;
    if (this.state === 'DISPOSED' || this.state === 'SEALED') fail('ACOUSTIC_RUNTIME_CLOSED');
  }
  private clock(): number {
    const time = this.options.nowAvailabilityMs();
    if (!Number.isFinite(time) || time < this.lastClock) fail('NONMONOTONIC_ACOUSTIC_AVAILABILITY');
    this.lastClock = time; return time;
  }
  private deliver(publication: Parameters<AcousticPublicationSink>[0]): void {
    if (publication.analyzedThroughPerformanceMs < this.lastFrontier || publication.availabilityTimeMs < publication.analyzedThroughPerformanceMs) fail('INVALID_ACOUSTIC_PUBLICATION_TIME');
    this.delivering = true;
    try { deliverPublication(this.options.onPublication, publication); }
    finally { this.delivering = false; }
    this.lastFrontier = publication.analyzedThroughPerformanceMs;
  }
  private planAvailable(): void {
    for (const segment of [...this.pendingSegments]) {
      while (true) {
        const window = planWindow(segment, this.counts.windowsQueued);
        if (!window) { this.pendingSegments.shift(); this.counts.segmentsDrained++; break; }
        if (window.endSample > this.ring.length) return;
        if (this.outstanding === R.maxOutstandingWindows) {
          this.counts.backpressureFailures++; fail('ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED');
        }
        // Guard precedes the immutable model-input allocation.
        const pcm = this.ring.extract(window.startSample, window.endSample);
        segment.nextWindow++; segment.queuedEndMs = window.ownedEndMs;
        this.enqueue(window, Object.freeze({ ...segment }), pcm);
      }
    }
  }
  private enqueue(window: AcousticWindow, segment: AcousticSegment, pcm: Float32Array): void {
    const queued = this.clock(), depth = ++this.outstanding;
    this.counts.windowsQueued++; this.counts.peakOutstanding = Math.max(this.counts.peakOutstanding, depth);
    this.chain = this.chain.then(async () => {
      try {
        if (this.closedForEvidence()) return;
        const started = this.clock(); this.counts.windowsStarted++;
        const result = await this.options.worker.run({ window, pcm });
        if (this.closedForEvidence()) return;
        const available = this.clock();
        const publication = acousticPublication({ sessionDomainId: this.options.sessionDomainId,
          sourceDomainId: this.options.sourceDomainId, sourceBase: this.sourceBase!, rate: this.adapter.rate,
          segment, window, result, availabilityTimeMs: available });
        this.deliver(publication);
        const delivered = this.clock();
        this.counts.windowsPublished++; this.counts.observationsPublished += publication.observations.length;
        retainCompact(this.diagnostics, Object.freeze({ jobIndex: window.jobIndex, segmentIndex: window.segmentIndex,
          ownedStartMs: window.ownedStartMs, ownedEndMs: window.ownedEndMs, inputStartSample: window.startSample,
          inputEndSample: window.endSample, queueDelayMs: started - queued, inferenceMs: result.inferenceMs,
          decodeMs: result.decodeMs, publicationMs: delivered - available, eventCount: publication.observations.length,
          outstandingAtEnqueue: depth, actualSessionRunCount: result.actualSessionRunCount,
          sourceSegmentStartSample: segment.sourceStart, sourceSegmentEndSample: segment.sourceEnd ?? null,
          performanceSegmentStartMs: segment.performanceStartMs, performanceSegmentEndMs: segment.performanceEndMs ?? null }));
      } catch (error) { this.failAnalysis(error); }
      finally { this.outstanding--; }
    });
  }
  private closedForEvidence(): boolean { return this.failure !== null || this.state === 'DISPOSED'; }
}
